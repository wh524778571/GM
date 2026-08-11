"""发布服务（Phase 4 / Epic 4.1 · M4）—— 诚实的「待人工发布」闭环。

════════════════════════════════════════════════════════════════════════════
为什么不做一键自动发布
════════════════════════════════════════════════════════════════════════════
旧工程 `publisher.py` 的每个平台函数都是 `# TODO: 实现` + `return {"success": True}`。
调用方看到 success 就把文章标成「已发布」，实际上一个字都没发出去 ——
这是《技术审计报告》列的**头号风险：发布假成功**。

四个平台都需要真实登录态、都有反爬与风控，在没有凭据的前提下写「自动发布」，
最好的结局也是把风险从「一定假成功」变成「随机假成功」。因此 Phase 4 按
《国漫笔记重启方案》§3.4 的灰度建议，交付**人工发布闭环**：

    系统负责把「发什么、发到哪、怎么发」准备到位（PublishPacket），
    人负责真的去发，并回来按平台逐个确认（confirm_publish）。

════════════════════════════════════════════════════════════════════════════
结构性防假成功（不是靠自觉，是靠没有那条代码路径）
════════════════════════════════════════════════════════════════════════════
1. 本服务**不发起任何对外网络请求**，没有任何「发布动作」可以失败后被吞掉。
2. `state=published` 在全工程只有一个写入点：`confirm_publish()`，
   且必须 `confirmed=True` 显式传入，缺省/False 一律抛 `ConfirmationRequired`。
3. `build_packets()` / `status()` 是纯读操作，永远不写状态。
4. 没有任何记录时默认 `pending`（待人工发布），"不知道" 一律按 "没发" 处理。
5. 该平台没内容 → `NothingToPublish`；登记失败不写原因 → `FailureReasonRequired`。
   任何缺字段都是显式异常，不存在「静默成功」的返回分支。
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.platform_rules import PlatformRule, load_registry
from app.models.article import Article, ArticleStatus
from app.models.publish_record import PublishRecord, PublishState
from app.repositories.article_repository import ArticleRepository
from app.repositories.publish_repository import PublishRepository
from app.services import qa
from app.services.image_matching.matcher import ImageMatcherService
from app.services.publishing.errors import (
    ArticleNotFound,
    ConfirmationRequired,
    FailureReasonRequired,
    InvalidPostedUrl,
    NothingToPublish,
    UnknownPlatform,
)
from app.services.publishing.utils import is_valid_url, markdown_to_copy_text
from app.services.rendering import RenderResult, RenderService, trim_metadata
from app.services.text_utils import suggest_filename

# 「待人工发布」在 UI 上的统一措辞，前后端共用同一份文案，避免各处自造说法
PENDING_LABEL = "待人工发布"
STATE_LABELS = {
    PublishState.PENDING.value: PENDING_LABEL,
    PublishState.PUBLISHED.value: "已发布（人工确认）",
    PublishState.FAILED.value: "发布失败",
}


@dataclass
class ImageTask:
    """配图清单的一项：人工发布时需要手动上传的一张图。"""

    index: int
    description: str
    suggested_filename: str
    matched: bool
    url: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class PublishPacket:
    """一个平台的「发布包」：把内容、规则、步骤、状态一次性交给人。"""

    platform: str
    platform_name: str
    display_color: str
    state: str
    state_label: str

    title: str
    title_char_count: int
    title_max_chars: int

    copy_text: str
    body_char_count: int
    body_max_chars: int | None
    html: str

    images_allowed: bool
    image_tasks: list[ImageTask] = field(default_factory=list)

    console_url: str = ""
    manual_steps: list[str] = field(default_factory=list)
    # 阻断项：非空即「不该现在发」，前端必须显示为红色并劝阻
    blockers: list[str] = field(default_factory=list)
    # 提醒项：不阻断，但要让人看见
    warnings: list[str] = field(default_factory=list)

    posted_url: str | None = None
    confirmed_at: str | None = None
    confirmed_by: str | None = None
    note: str | None = None

    @property
    def ready(self) -> bool:
        """内容层面是否具备发布条件。**ready 只是「可以去发」，不是「已发」。**"""
        return not self.blockers

    def to_dict(self, *, include_html: bool = True) -> dict:
        data = asdict(self)
        data["ready"] = self.ready
        if not include_html:
            data.pop("html", None)
        return data


@dataclass
class PlatformStatus:
    platform: str
    platform_name: str
    state: str
    state_label: str
    posted_url: str | None = None
    confirmed_at: str | None = None
    confirmed_by: str | None = None
    note: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


class PublishService:
    """人工发布闭环的唯一实现。构造只需要一个 Session（沿用全局单数据源）。"""

    def __init__(self, session: Session) -> None:
        self.session = session
        self.registry = load_registry()
        self.articles = ArticleRepository(session)
        self.records = PublishRepository(session)

    # ── 内部工具 ──────────────────────────────────────────────
    def _get_article(self, article_id: str) -> Article:
        article = self.articles.get_by_article_id(article_id)
        if article is None:
            raise ArticleNotFound(f"文章不存在：{article_id}", detail={"article_id": article_id})
        return article

    def _normalize_platform(self, platform: str | None) -> str:
        if not platform or not str(platform).strip():
            raise UnknownPlatform(
                "必须显式指定平台 platform",
                detail={"valid": list(self.registry.keys())},
            )
        try:
            return self.registry.normalize_platform(str(platform).strip())
        except Exception as exc:  # PlatformRulesError
            raise UnknownPlatform(
                f"未知平台：{platform!r}", detail={"valid": list(self.registry.keys())}
            ) from exc

    def _record_map(self, article_id: str) -> dict[str, PublishRecord]:
        return {r.platform: r for r in self.records.list_for_article(article_id)}

    @staticmethod
    def _state_of(record: PublishRecord | None) -> str:
        """没有记录 = pending。「不知道」一律按「没发」处理，绝不乐观假设。"""
        return record.state if record is not None else PublishState.PENDING.value

    # ── 1. 组装发布包（纯读，永不改状态）──────────────────────
    def build_packets(
        self,
        article_id: str,
        *,
        match_images: bool = True,
        include_html: bool = True,
    ) -> list[PublishPacket]:
        """为四个平台各生成一个发布包。

        复用渲染服务（不重复实现四平台差异）与配图匹配服务；
        小红书包按 platforms.yaml 的 `images.allowed=false` 自动变成纯文字无图。
        """
        article = self._get_article(article_id)
        contents = article.contents or {}
        titles = article.titles or {}
        image_sources = article.image_sources or {}

        if not contents:
            raise NothingToPublish(
                f"文章 {article_id} 还没有任何平台正文，请先执行 /articles/{article_id}/generate",
                detail={"article_id": article_id},
            )

        resolver = None
        if match_images:
            resolver = ImageMatcherService(self.session).resolver(article_id=article_id)
        renderer = RenderService(image_resolver=resolver)

        report = qa.quality_check(titles, contents, image_sources, self.registry)
        records = self._record_map(article_id)

        packets: list[PublishPacket] = []
        for key in self.registry.keys():
            packets.append(
                self._build_one(
                    article=article,
                    platform=key,
                    renderer=renderer,
                    qa_report=report,
                    record=records.get(key),
                    include_html=include_html,
                )
            )
        return packets

    def _build_one(
        self,
        *,
        article: Article,
        platform: str,
        renderer: RenderService,
        qa_report: qa.QAReport,
        record: PublishRecord | None,
        include_html: bool,
    ) -> PublishPacket:
        rule = self.registry.get(platform)
        raw_body = (article.contents or {}).get(platform) or ""
        title = ((article.titles or {}).get(platform) or "").strip()

        # 小红书硬规则：纯文字无图，占位符在复制文本里也必须消失
        body_for_copy = trim_metadata(raw_body)
        if not rule.images.allowed:
            body_for_copy, _ = qa.strip_placeholders(body_for_copy, self.registry)
        copy_text = markdown_to_copy_text(body_for_copy)

        render = renderer.render(raw_body, platform, cache_key=article.article_id)
        image_tasks = self._image_tasks(raw_body, rule, render)

        blockers: list[str] = []
        warnings: list[str] = []
        if not raw_body.strip():
            blockers.append(f"{rule.name} 没有正文内容，无法发布")
        if not title:
            blockers.append(f"{rule.name} 没有标题，无法发布")
        for issue in qa_report.issues:
            if not self._issue_applies(issue, platform, rule):
                continue
            (blockers if issue.level == qa.ERROR else warnings).append(issue.message)
        warnings.extend(render.warnings)
        if not rule.images.allowed:
            warnings.append(f"{rule.name} 为纯文字无图平台：正文已剔除全部配图，请勿手动插图")

        # QA 与渲染器可能对同一问题各报一次（例如正文字数不足），此处按原序去重，
        # 并剔除已经出现在 blockers 里的条目，避免发布面板重复刷屏。
        blockers = list(dict.fromkeys(blockers))
        seen = set(blockers)
        warnings = [w for w in dict.fromkeys(warnings) if w not in seen]

        state = self._state_of(record)
        return PublishPacket(
            platform=platform,
            platform_name=rule.name,
            display_color=rule.display_color,
            state=state,
            state_label=STATE_LABELS[state],
            title=title,
            title_char_count=len(title),
            title_max_chars=rule.title.max_chars,
            copy_text=copy_text,
            body_char_count=len(copy_text),
            body_max_chars=rule.body.max_chars,
            html=render.html if include_html else "",
            images_allowed=rule.images.allowed,
            image_tasks=image_tasks,
            console_url=str(rule.publish.get("mp_url") or ""),
            manual_steps=self._manual_steps(rule, title, image_tasks),
            blockers=blockers,
            warnings=warnings,
            posted_url=record.posted_url if record else None,
            confirmed_at=record.confirmed_at.isoformat() if record and record.confirmed_at else None,
            confirmed_by=record.confirmed_by if record else None,
            note=record.note if record else None,
        )

    @staticmethod
    def _issue_applies(issue: qa.QAIssue, platform: str, rule: PlatformRule) -> bool:
        """质检问题是否归属于该平台。

        `platform=None` 的是文章级问题（如 image_sources 缺来源）：
        图片类只挂到「允许配图」的平台上 —— 小红书本就剔图，把缺图判成
        它的阻断项属于误伤；其余文章级问题四个平台都要看到。
        """
        if issue.platform == platform:
            return True
        if issue.platform is not None:
            return False
        if issue.code.startswith("image_"):
            return rule.images.allowed
        return True

    def _image_tasks(self, raw_body: str, rule: PlatformRule, render: RenderResult) -> list[ImageTask]:
        """配图清单：告诉人「这篇要手动传哪几张图、哪几张素材库已经有了」。"""
        if not rule.images.allowed:
            return []
        missing_idx = {m.index for m in render.missing_images}
        tasks: list[ImageTask] = []
        for match in self.registry.placeholder.regex.finditer(raw_body or ""):
            index = int(match.group(1))
            desc = match.group(2).strip()
            tasks.append(
                ImageTask(
                    index=index,
                    description=desc,
                    suggested_filename=suggest_filename(desc),
                    matched=index not in missing_idx,
                )
            )
        return tasks

    @staticmethod
    def _manual_steps(rule: PlatformRule, title: str, image_tasks: list[ImageTask]) -> list[str]:
        """人工发布步骤。所有数字（标题上限/字数上限）都取自 platforms.yaml。"""
        console = rule.publish.get("mp_url") or "平台创作者后台"
        steps = [
            f"登录 {console} 的「Yolo的国漫笔记」账号",
            f"新建图文 → 标题栏粘贴：{title or '（缺标题，请先补齐）'}"
            f"（{rule.name} 标题上限 {rule.title.max_chars} 字）",
            "正文粘贴下方「可复制正文」（想保留排版可改用四平台预览 HTML 富文本粘贴）",
        ]
        if rule.images.allowed:
            steps.append(
                f"按「配图清单」逐张上传 {len(image_tasks)} 张配图到对应占位处，"
                "上传后删掉正文里的【配图N：…】占位文字"
            )
        else:
            limit = f"，正文上限 {rule.body.max_chars} 字" if rule.body.max_chars else ""
            steps.append(f"{rule.name} 为纯文字无图{limit}：不要插入任何图片")
        steps += [
            f"在 {rule.name} 后台点击发布，并复制发布后的作品链接",
            f"回到本页点「我已在{rule.name}发布」并粘贴链接 —— "
            f"在你点之前，系统状态一直是「{PENDING_LABEL}」",
        ]
        return steps

    # ── 2. 人工确认（全工程唯一把 state 写成 published 的地方）──
    def confirm_publish(
        self,
        article_id: str,
        platform: str,
        posted_url: str | None = None,
        *,
        confirmed: bool = False,
        confirmed_by: str | None = None,
        note: str | None = None,
    ) -> PlatformStatus:
        """人工确认「我确实已经在该平台把这篇发出去了」。

        必须满足全部条件，缺一即抛异常（**没有任何一条返回成功的旁路**）：
            · 文章存在
            · platform 合法且明确
            · 该平台确有标题与正文（不能确认一篇不存在的内容）
            · confirmed 显式为 True（人的动作，不接受默认值）
            · posted_url 若填写，必须是 http(s) 链接
        """
        article = self._get_article(article_id)
        key = self._normalize_platform(platform)

        if confirmed is not True:
            raise ConfirmationRequired(
                "未收到显式的人工确认（confirmed 必须为 true）。"
                f"在你确认之前，{self.registry.get(key).name} 状态保持「{PENDING_LABEL}」。",
                detail={"article_id": article_id, "platform": key, "state": PublishState.PENDING.value},
            )

        title = ((article.titles or {}).get(key) or "").strip()
        body = ((article.contents or {}).get(key) or "").strip()
        if not title or not body:
            raise NothingToPublish(
                f"{self.registry.get(key).name} 没有可发布内容"
                f"（标题{'有' if title else '缺'}、正文{'有' if body else '缺'}），"
                "不能确认为已发布。",
                detail={"article_id": article_id, "platform": key,
                        "has_title": bool(title), "has_body": bool(body)},
            )

        url = (posted_url or "").strip() or None
        if url is not None and not is_valid_url(url):
            raise InvalidPostedUrl(
                f"posted_url 不是合法链接：{url!r}（需以 http:// 或 https:// 开头）",
                detail={"posted_url": url},
            )

        record, _ = self.records.upsert(
            article_id,
            key,
            state=PublishState.PUBLISHED.value,
            posted_url=url,
            confirmed_by=(confirmed_by or "human").strip() or "human",
            confirmed_at=datetime.now(timezone.utc),
            note=note,
        )
        self._sync_article_status(article)
        return self._to_status(key, record)

    # ── 3. 人工登记失败（失败也必须留痕）──────────────────────
    def mark_failed(self, article_id: str, platform: str, reason: str) -> PlatformStatus:
        article = self._get_article(article_id)
        key = self._normalize_platform(platform)
        text = (reason or "").strip()
        if not text:
            raise FailureReasonRequired(
                "登记发布失败必须写明原因（reason 不能为空）",
                detail={"article_id": article_id, "platform": key},
            )
        record, _ = self.records.upsert(
            article_id,
            key,
            state=PublishState.FAILED.value,
            note=text,
            confirmed_by=None,
            confirmed_at=None,
            posted_url=None,
        )
        self._sync_article_status(article)
        return self._to_status(key, record)

    # ── 4. 状态查询（纯读）────────────────────────────────────
    def status(self, article_id: str) -> dict:
        article = self._get_article(article_id)
        records = self._record_map(article_id)

        platforms = [self._to_status(key, records.get(key)) for key in self.registry.keys()]
        counts = {s.value: 0 for s in PublishState}
        for item in platforms:
            counts[item.state] += 1

        total = len(platforms)
        return {
            "article_id": article_id,
            "article_status": article.status,
            "total_platforms": total,
            "published_count": counts[PublishState.PUBLISHED.value],
            "pending_count": counts[PublishState.PENDING.value],
            "failed_count": counts[PublishState.FAILED.value],
            "all_published": counts[PublishState.PUBLISHED.value] == total,
            "pending_label": PENDING_LABEL,
            "platforms": {item.platform: item.to_dict() for item in platforms},
        }

    def _to_status(self, platform: str, record: PublishRecord | None) -> PlatformStatus:
        state = self._state_of(record)
        return PlatformStatus(
            platform=platform,
            platform_name=self.registry.get(platform).name,
            state=state,
            state_label=STATE_LABELS[state],
            posted_url=record.posted_url if record else None,
            confirmed_at=record.confirmed_at.isoformat() if record and record.confirmed_at else None,
            confirmed_by=record.confirmed_by if record else None,
            note=record.note if record else None,
        )

    # ── 文章级状态：只有四平台全确认才敢叫「已发布」 ──────────
    def _sync_article_status(self, article: Article) -> None:
        records = self._record_map(article.article_id)
        states = [self._state_of(records.get(key)) for key in self.registry.keys()]
        if all(s == PublishState.PUBLISHED.value for s in states):
            article.status = ArticleStatus.PUBLISHED.value
        elif any(s == PublishState.FAILED.value for s in states):
            article.status = ArticleStatus.FAILED.value
        else:
            # 有平台已发但没发全 → 仍是「待发布」，不许提前庆功
            article.status = ArticleStatus.PENDING.value
        self.session.flush()
