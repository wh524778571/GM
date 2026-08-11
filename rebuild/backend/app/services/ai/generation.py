"""四平台生成服务（Epic 2.1 / 2.2）—— 内容闭环的中枢。

一次 `generate()` 串起五个阶段，每个阶段的产物都在结果对象里可见：

    选题 title
      └─1 组装 prompt   system = SYSTEM_PROMPT（原样，唯一入口）
      └─2 调用 Provider  失败即抛（不返回假文章）
      └─3 解析 + 规则强制  platforms.yaml：标题长度、小红书剔图
      └─4 配图建议        复用 ImageMatcherService（不重复实现匹配）
      └─5 四平台预览      复用 RenderService（不重复实现渲染）
      └─6 质检 qa.quality_check（error 阻断，warning 透出）

**风格不漂移的结构性保证**：本文件是全工程唯一调用 `provider.generate()` 的地方，
且第一个实参写死为 `prompts.SYSTEM_PROMPT`，不开放 system 覆盖参数。
结果里还会带上 `system_prompt_fingerprint`，产物层面可追溯人设版本。
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from app.core.platform_rules import PlatformRegistry, load_registry
from app.services import qa
from app.services.ai.errors import AIResponseError
from app.services.ai.prompts import (
    JSON_ARTICLE_TYPES,
    SYSTEM_PROMPT,
    build_user_prompt,
    system_prompt_fingerprint,
)
from app.services.ai.provider import AIProvider, extract_json_object
from app.services.image_matching.matcher import ImageMatcherService
from app.services.rendering import RenderResult, RenderService
from app.services.text_utils import strip_emoji
from app.services.ai.style_rules import PLATFORM_ANGLES

# 进度回调：(stage, percent, message) → None。生成耗时 30–120s，
# 异步任务据此上报真实阶段，前端才能画出不骗人的进度条。
ProgressFn = Callable[[str, int, str], None]


def _noop_progress(stage: str, percent: int, message: str) -> None:
    """默认无进度回调——同步调用方（CLI、测试）零负担。"""


def _make_reporter(fn: ProgressFn | None) -> ProgressFn:
    """包一层：回调自身异常绝不能连累生成主流程。"""
    if fn is None:
        return _noop_progress

    def _safe(stage: str, percent: int, message: str) -> None:
        try:
            fn(stage, percent, message)
        except Exception:  # noqa: BLE001 - 进度上报失败不影响生成
            pass

    return _safe


# 标题超长时优先在这些标点处截断，避免生硬砍字
_TITLE_CUT_CHARS = "：:，,。.！!？?、·—-～~ "

# 模型偶发把 core / 平台值吐成数组，统一 join 成字符串
def _coerce_text(value: Any) -> str:
    if isinstance(value, list):
        return "\n".join(str(x) for x in value)
    return str(value or "")


# 母稿字数区间（深度/资讯）。与 style_rules.STYLE_GUIDE、platforms.yaml 对齐，
# 是「文章内容 2000–3000 字」要求的核心来源：母稿先写足量级，平台改写才有的展开。
CORE_RANGES: dict[str, tuple[int, int]] = {
    "depth": (2000, 3000),
    "info": (1800, 2500),
}


class GenerationError(RuntimeError):
    """生成流程失败（解析失败 / 缺平台 / 质检不通过）。"""

    def __init__(self, message: str, *, stage: str, detail: Any = None) -> None:
        super().__init__(message)
        self.stage = stage
        self.detail = detail

    def to_dict(self) -> dict:
        return {"error": "GenerationError", "stage": self.stage, "message": str(self), "detail": self.detail}


@dataclass
class ImageSuggestion:
    placeholder: str
    index: int
    description: str
    matched: bool
    material_id: int | None = None
    stem: str | None = None
    path: str | None = None
    url: str | None = None
    score: int | None = None
    reason: str = ""

    def to_dict(self) -> dict:
        return self.__dict__.copy()


@dataclass
class GenerationResult:
    topic: str
    article_type: str
    provider: str
    system_prompt_fingerprint: str
    core: str
    titles: dict[str, str]
    contents: dict[str, str]
    image_sources: dict[str, str]
    image_suggestions: list[ImageSuggestion] = field(default_factory=list)
    enforcements: list[str] = field(default_factory=list)
    qa_report: qa.QAReport = field(default_factory=qa.QAReport)
    renders: dict[str, RenderResult] = field(default_factory=dict)
    telemetry: dict = field(default_factory=dict)
    raw_text: str = ""

    @property
    def ok(self) -> bool:
        return self.qa_report.ok

    def to_dict(self, *, include_html: bool = True, include_raw: bool = False) -> dict:
        payload: dict = {
            "topic": self.topic,
            "article_type": self.article_type,
            "provider": self.provider,
            "system_prompt_fingerprint": self.system_prompt_fingerprint,
            "ok": self.ok,
            "core": self.core,
            "titles": self.titles,
            "contents": self.contents,
            "image_sources": self.image_sources,
            "image_suggestions": [s.to_dict() for s in self.image_suggestions],
            "enforcements": self.enforcements,
            "qa": self.qa_report.to_dict(),
            "telemetry": self.telemetry,
        }
        if include_html:
            payload["previews"] = {
                key: {
                    "platform": r.platform,
                    "platform_name": r.platform_name,
                    "html": r.html,
                    "char_count": r.char_count,
                    "image_count": r.image_count,
                    "ok": r.ok,
                    "warnings": r.warnings,
                    "missing_images": [m.__dict__ for m in r.missing_images],
                }
                for key, r in self.renders.items()
            }
        if include_raw:
            payload["raw_text"] = self.raw_text
        return payload


class GenerationService:
    def __init__(
        self,
        provider: AIProvider,
        session: Session | None = None,
        *,
        registry: PlatformRegistry | None = None,
    ) -> None:
        self.provider = provider
        self.session = session
        self.registry = registry or load_registry()

    # ── 主流程 ────────────────────────────────────────────────
    def generate(
        self,
        topic: str,
        *,
        article_type: str = "depth",
        requirement: str = "",
        article_id: str | None = None,
        match_images: bool = True,
        render: bool = True,
        max_tokens: int | None = None,
        temperature: float | None = None,
        strict: bool = False,
        on_progress: ProgressFn | None = None,
    ) -> GenerationResult:
        """topic 为选题（主题句）。strict=True 时质检 error 直接抛 QAError。

        on_progress(stage, percent, message)：可选进度回调，供异步任务上报真实阶段。
        回调异常一律吞掉（见 _report），进度上报绝不能影响生成本身。
        """
        report_progress = _make_reporter(on_progress)
        topic = (topic or "").strip()
        if not topic:
            raise GenerationError("选题不能为空", stage="input")
        if article_type not in JSON_ARTICLE_TYPES:
            raise GenerationError(
                f"文章类型 {article_type!r} 不产出四平台 JSON，四平台生成仅支持："
                f"{list(JSON_ARTICLE_TYPES)}",
                stage="input",
            )

        # 1) 母稿 core（模型最擅长写单篇长文，先拿到完整母稿，再派生成各平台）
        from app.core.settings import settings

        ai_max_tokens = max_tokens if max_tokens is not None else settings.ai_max_tokens
        ai_temperature = temperature if temperature is not None else settings.ai_temperature

        user_prompt = build_user_prompt(topic, article_type, requirement)
        report_progress("core", 8, "正在写母稿（这一步最久，别关页面）…")
        core = self._generate_core(
            user_prompt, ai_max_tokens, ai_temperature, article_type, report_progress
        )

        # 2) 逐平台改写（各自完整正文，保证字数充足且配图内联）
        report_progress("rewrite", 55, f"母稿 {len(core)} 字已就绪，开始改写四平台…")
        contents, rewrite_errors = self._rewrite_all_platforms(
            core, ai_max_tokens, ai_temperature, report_progress
        )
        contents, content_enforcements = self._enforce_content_rules(contents)
        # 配图对齐兜底：allowed 平台补齐被改写丢掉的占位符、去重
        # （解决"只有百家能插图 / 图片堆在一起重复"）
        contents, image_align_enf = self._align_images(contents, core)
        content_enforcements = list(content_enforcements) + list(image_align_enf)

        # 兜底：模型偶发在正文塞 emoji（🔥✨💡 等），即便 prompt 已禁也强制剥离，
        # 用排版（## 小标题、**加粗**、序号、引用）分层，绝不依赖表情符号。
        core = strip_emoji(core)
        contents = {k: strip_emoji(v) for k, v in contents.items()}
        # 单平台改写失败兜底母稿：如实登记，绝不静默假成功
        enforcements = list(content_enforcements)
        enforcements.extend(rewrite_errors)

        # 3) 标题：按平台调性 LLM 生成（失败回退确定性截断）
        report_progress("titles", 86, "生成四平台标题…")
        titles, title_enforcements = self._generate_titles(topic, article_type)
        enforcements.extend(title_enforcements)

        # 4) 配图建议（复用 image_matching，不重复实现）
        report_progress("images", 90, "匹配配图…")
        image_sources, suggestions = self._suggest_images(
            contents, article_id=article_id, enabled=match_images
        )

        # 5) 四平台预览（复用 rendering，不重复实现）
        renders: dict[str, RenderResult] = {}
        if render:
            report_progress("render", 94, "生成四平台预览…")
            renders = self._render(contents, article_id=article_id, match_images=match_images)

        # 6) 质检
        report_progress("qa", 97, "质量检查…")
        report = qa.quality_check(titles, contents, image_sources, self.registry)

        result = GenerationResult(
            topic=topic,
            article_type=article_type,
            provider=self.provider.name,
            system_prompt_fingerprint=system_prompt_fingerprint(),
            core=core,
            titles=titles,
            contents=contents,
            image_sources=image_sources,
            image_suggestions=suggestions,
            enforcements=enforcements,
            qa_report=report,
            renders=renders,
            telemetry=self.provider.telemetry.snapshot(),
            raw_text=core,
        )
        if strict and not report.ok:
            raise qa.QAError(report)
        return result

    # ── 各阶段实现 ────────────────────────────────────────────
    def _call_model(self, user_prompt: str, *, temperature: float, max_tokens: int, extra2: str, system_prompt: str = SYSTEM_PROMPT) -> str:
        """两次尝试：第二次降温度并追加 extra2 强调。失败原样上抛（不兜底假数据）。

        `system_prompt` 默认走文章人设 SYSTEM_PROMPT；选题策划（suggest_topics）可传入
        TOPIC_SYSTEM_PROMPT——所有 provider.generate 调用仍只发生在这里，结构不变。
        """
        last_exc: Exception | None = None
        for attempt in (1, 2):
            up = user_prompt + (extra2 if attempt == 2 else "")
            temp = temperature if attempt == 1 else min(temperature, 0.4)
            try:
                return self.provider.generate(system_prompt, up, max_tokens=max_tokens, temperature=temp)
            except (AIResponseError, GenerationError) as exc:
                last_exc = exc
        assert last_exc is not None
        raise last_exc

    def suggest_topics(
        self,
        today: str,
        count: int,
        *,
        avoid_titles: list[str] | None = None,
        avoid_keys: list[str] | None = None,
        recent_context: str = "",
    ) -> list[dict]:
        """「今日推荐选题」专用：调用模型产出选题草案（不写文章，用独立 TOPIC_SYSTEM_PROMPT）。

        与文章生成严格隔离：只做选题策划，绝不动 SYSTEM_PROMPT / 四平台产出契约。
        解析失败或无有效项时返回空列表（不抛），由 topic_service 决定补轮。
        """
        from app.core.settings import settings
        from app.services.ai.prompts import TOPIC_SYSTEM_PROMPT, build_topic_prompt

        avoid_titles = avoid_titles or []
        avoid_keys = avoid_keys or []
        user = build_topic_prompt(
            today, count, avoid_titles, avoid_keys, recent_context=recent_context
        )
        raw = self._call_model(
            user,
            temperature=0.7,
            max_tokens=settings.ai_max_tokens,
            extra2=(
                "\n\n【再次确认】输出必须是 [ ] 包裹的 JSON 数组（不要漏掉外层方括号）；"
                "标题里禁止书名号《》；不要写具体票房/播放量数字（用定性描述）。"
            ),
            system_prompt=TOPIC_SYSTEM_PROMPT,
        )
        items = _extract_json_list(raw)
        if not isinstance(items, list):
            return []
        out: list[dict] = []
        for it in items:
            if not isinstance(it, dict):
                continue
            title = (it.get("title") or "").strip()
            if not title:
                continue
            atype = (it.get("article_type") or "depth")
            if atype not in ("depth", "info"):
                atype = "depth"
            out.append(
                {
                    "title": title,
                    "type": (it.get("type") or "常青候选"),
                    "summary": (it.get("summary") or "").strip(),
                    "angle": (it.get("angle") or "").strip(),
                    "article_type": atype,
                    "genes": _as_gene_list(it.get("genes")),
                    "why": (it.get("why") or "").strip(),
                }
            )
        return out

    @staticmethod
    def _parse_json(raw: str) -> dict:
        try:
            return extract_json_object(raw)
        except AIResponseError as exc:
            raise GenerationError(str(exc), stage="parse") from exc

    def _generate_core(
        self,
        user_prompt: str,
        max_tokens: int,
        temperature: float,
        article_type: str,
        report: ProgressFn = _noop_progress,
    ) -> str:
        """生成完整母稿 core（模型写单篇长文最稳），不足目标则扩写一轮。

        glm-4-flash 单次输出约 1400 字上限，直接要 2000–3000 往往只给 600–1300 字。
        可靠做法：先拿连贯草稿，再喂回模型扩写到目标区间。
        """
        lo, hi = CORE_RANGES.get(article_type, (2000, 3000))
        # 兜底下限取目标的 0.6：既能挡住垃圾短稿，又给 glm-4-flash 的「惯性偏短」留余量，
        # 避免因模型产出 1200–1500 字（仍属充实长文）而被误判过短、整篇生成失败。
        min_chars = int(lo * 0.6)
        extra2 = (
            f"\n\n【严格要求】只输出一个 JSON 对象，core 字段是 {lo}–{hi} 字的完整母稿正文"
            "（字符串，绝不用反引号 ``` 包裹），四个平台字段留空字符串即可。"
            "core 绝不能是短句或标题。"
            "若文中出现【配图N：...】占位符，须穿插分布在正文不同段落之间"
            "（图与图之间至少隔 2 段），禁止集中在开头或结尾。"
        )
        raw = self._call_model(user_prompt, temperature=temperature, max_tokens=max_tokens, extra2=extra2)
        data = self._parse_json(raw)
        core = _coerce_text(data.get("core") or "").strip()
        if len(core) < lo:
            # 草稿未达目标 → 增量式扩写（拼接累加，突破单 call 输出上限）拉到 2000+
            report("core_expand", 32, f"母稿初稿 {len(core)} 字，扩写到 {lo} 字以上…")
            core = self._expand_text(
                core, lo, hi, keep_placeholders=True, max_tokens=max_tokens, temperature=0.85
            )
        if len(core) < min_chars:
            raise GenerationError(f"母稿过短（{len(core)}字，需≥{min_chars}）", stage="parse")
        return core

    def _expand_text(
        self,
        text: str,
        lo: int,
        hi: int,
        *,
        keep_placeholders: bool,
        max_tokens: int,
        temperature: float = 0.85,
        max_passes: int = 3,
    ) -> str:
        """把短文扩写成 lo–hi 字的长文（应对 glm-4-flash 单 call 约 1400–2000 字上限）。

        **关键设计——只产出增量、拼接累加**：每次只让模型吐出「需要追加的新段落」
        （增量本身 ≤ 模型输出上限，单次必能写完），再把增量接到原文末尾。

        两处质量兜底（根治「重复 / 格式乱」）：
        - 文末互动引导（CTA）单独拆出、扩写内容插在它前面，保证 CTA 永远在文末，
          不被增量挤到正文中间造成格式断层；
        - 增量段落做去重：模型偷懒复述原文 / 重复已有段落时，只保留真正新增的内容。
        """
        if keep_placeholders:
            ph_rule = (
                "保留原文中已有的【配图N：...】占位符不变（N 与描述一字不改）；"
                "本次追加的新段落不要新增任何配图占位符"
            )
        else:
            ph_rule = "纯文字无图，不要出现任何【配图N】占位符"
        body, cta = self._split_cta(text.strip())
        best = body
        for _ in range(max_passes):
            if len(best) >= lo:
                break
            deficit = lo - len(best)
            user = (
                f"下面是一篇国漫解析文章（约 {len(best)} 字）：\n\n{best}\n\n"
                f"请**只输出需要追加的新内容**（不要重复上面任何已有句子），"
                f"把全文补到 {lo}–{hi} 字——本次至少追加 {deficit + 150} 字的新内容，"
                f"至少 4 个有信息量的细节段落（具体画面/分镜描述、与原著或前作的呼应、"
                f"观众真实反应或数据），每段 200–400 字；{ph_rule}；"
                f"正文严格禁止任何 emoji 表情符号（🔥✨💡📌 等一律不要）；用小标题、**加粗**、数字序号、引用（>）制造层次，不要依赖 emoji；全文严格不超过 {hi} 字，数清楚字数再停笔。"
            )
            extra2 = (
                f"\n\n【最高优先级】只输出追加的新内容（绝不要复述原文），"
                f"至少 {deficit + 150} 字；补完后全文须达到 {lo} 字。"
            )
            addition = self._call_model(
                user, temperature=temperature, max_tokens=max_tokens, extra2=extra2
            ).strip()
            if not addition:
                break
            # 去重：模型偶发把原文又吐回来 / 重复已有段落 → 只保留真正新增的段落
            addition = self._dedup_addition(best, addition)
            if not addition:
                break
            candidate = best + "\n\n" + addition
            # 单调不退化：只接受更长的结果
            if len(candidate) > len(best):
                best = candidate
        # 重新把 CTA 接到最末尾（保证互动引导永远在文末，不被扩写挤到中间）
        if cta:
            best = best.rstrip() + "\n\n" + cta
        # 硬上限兜底：按最近段落边界截断到 hi，绝不返回超过天花板的正文
        if len(best) > hi:
            cut = best.rfind("\n\n", 0, hi)
            best = best[: cut if cut > lo else hi]
        return best

    # 互动引导（CTA）常见措辞，用于把 CTA 从正文拆出、固定到文末
    _CTA_HINTS = (
        "评论", "聊聊", "关注", "点赞", "转发", "收藏",
        "你怎么", "你觉得", "说说", "互动", "留言", "催更", "期待", "你们",
    )

    @staticmethod
    def _norm_para(p: str) -> str:
        return re.sub(r"\s+", "", p)

    def _split_cta(self, text: str) -> tuple[str, str]:
        """把文末互动引导段拆出，返回 (正文, CTA)；无 CTA 则返回 (原文, '')。"""
        paras = [p for p in re.split(r"\n\n+", text.strip()) if p.strip()]
        if len(paras) < 2:
            return text, ""
        last = paras[-1]
        if any(h in last for h in self._CTA_HINTS) and len(last) <= 120:
            return "\n\n".join(paras[:-1]), last
        return text, ""

    def _dedup_addition(self, best: str, addition: str) -> str:
        """剔除 addition 中与 best 已有内容重复的段落（模型复述原文 / 重复已有段落）。"""
        best_norm = {self._norm_para(p) for p in re.split(r"\n\n+", best) if p.strip()}
        kept: list[str] = []
        for p in re.split(r"\n\n+", addition):
            p = p.strip()
            if not p:
                continue
            np_ = self._norm_para(p)
            # 整段与 best 某段几乎相同 → 丢弃
            if np_ in best_norm:
                continue
            # 段落前半复述了 best 某段（模型把前文又吐回来）→ 丢弃
            if any(
                np_.startswith(b[:40]) and len(np_) <= len(b) + 10
                for b in best_norm
                if len(b) >= 40
            ):
                continue
            kept.append(p)
            best_norm.add(np_)
        return "\n\n".join(kept)

    def _rewrite_platform(self, core: str, key: str, max_tokens: int, temperature: float) -> str:
        """把母稿改写成单个平台的完整正文（保留/剔除配图占位符按平台规则）。

        长度契约取自 platforms.yaml 的 body.target_chars，避免一刀切 800–1200 字
        把小红书（本就短句分行）误判过短而兜底母稿，丢掉平台风格。
        """
        rule = self.registry.get(key)
        target = rule.body.target_chars
        angle = PLATFORM_ANGLES.get(key, "")
        angle_block = f"\n\n{angle}" if angle else ""
        # 过短阈值：目标的保守比例 + 绝对下限。必须低于指令里的「±30%」上限，
        # 否则模型在目标区间内产出的内容会被误判过短而兜底母稿（小红书曾踩此坑）。
        low = max(80, int(target * 0.5))
        if rule.images.allowed:
            img_instruction = (
                "必须原样保留母稿里的所有【配图N：...】占位符"
                "（N 与描述一字不改地照搬，不要删除、不要改写、也不要新增其它占位符）；"
            )
        else:
            img_instruction = "纯文字无图，把母稿里的所有【配图N：...】占位符全部删除，不要保留；"
        user = (
            f"以下是一篇国漫解析母稿：\n\n{core}\n\n"
            f"请把这篇母稿改写成【{rule.name}】风格的自媒体正文，"
            f'只输出一个 JSON：{{"{key}":"改写后的完整正文"}}。\n'
            f"要求：风格——{rule.style}；不要只是把母稿换个说法，要按本平台读者最关心的角度重新组织内容、"
            f"用平台原生的开头钩子切入（头条用数据/悬念、B站用争议/玩梗、百家用观点/分析、小红书用情感/清单），"
            f"四个平台要有明显不同的侧重点，而不是同一篇换四种语气；{angle_block}这是一篇约 {target} 字（±30%）的完整正文"
            f"（绝不是标题、绝不是一句话）；"
            f"{img_instruction}正文严格禁止任何 emoji 表情符号（🔥✨💡📌 等一律不要）；用小标题、**加粗**、数字序号、引用（>）制造层次，不要依赖 emoji；"
            f"结尾必须有互动引导（如「评论区聊聊」）。"
        )
        extra2 = (
            f"\n\n【严格要求】输出的字段必须是约 {target} 字的完整正文，绝不是标题或一句话；"
            "字符串值绝不能用反引号 ``` 包裹。"
        )
        raw = self._call_model(user, temperature=temperature, max_tokens=max_tokens, extra2=extra2)
        data = self._parse_json(raw)
        text = _coerce_text(data.get(key) or "").strip()
        # 字段整体缺失/空白 → 直接触发兜底母稿（与「偏短但非空」区分开）
        if not text:
            raise GenerationError(f"{rule.name} 改写内容缺失，兜底母稿", stage="parse")
        # glm-4-flash 单 call 约 1400–2000 字上限：未达目标先增量扩写补字，再判是否垃圾短稿
        # 扩写上限取用户「2000–3000 字」的天花板 3000（而非平台 target），让正文稳稳落在诉求区间内
        expand_lo = int(target * 0.9)
        expand_hi = min(target + 500, 3000)
        if len(text) < expand_lo:
            text = self._expand_text(
                text,
                expand_lo,
                expand_hi,
                keep_placeholders=rule.images.allowed,
                max_tokens=max_tokens,
                temperature=0.85,
                max_passes=4,
            )
        if len(text) < low:
            raise GenerationError(f"{rule.name} 改写过短（{len(text)}字，需≥{low}）", stage="parse")
        return text

    def _rewrite_all_platforms(
        self,
        core: str,
        max_tokens: int,
        temperature: float,
        report: ProgressFn = _noop_progress,
    ) -> tuple[dict[str, str], list[str]]:
        """并行把母稿改写成各平台完整正文（相互独立，并发提速）。

        返回 (各平台正文, 失败告警列表)。单平台失败兜底用母稿，
        失败项进告警列表，由 generate() 汇总进 enforcements，绝不静默假成功。

        用 as_completed 收结果：谁先跑完先上报，进度条反映真实完成数而非提交顺序。
        """
        from concurrent.futures import ThreadPoolExecutor, as_completed

        keys = list(self.registry.keys())
        total = len(keys) or 1
        results: dict[str, str] = {}
        errors: list[str] = []
        done_count = 0
        with ThreadPoolExecutor(max_workers=len(keys)) as ex:
            futures = {
                ex.submit(self._rewrite_platform, core, k, max_tokens, temperature): k
                for k in keys
            }
            for fut in as_completed(futures):
                k = futures[fut]
                try:
                    results[k] = fut.result()
                except Exception as exc:
                    results[k] = core  # 兜底母稿，QA 会报 warning，绝不静默假成功
                    errors.append(f"{k} 改写失败，已兜底母稿：{exc}")
                done_count += 1
                rule = self.registry.platforms.get(k)
                label = rule.name if rule else k
                # 改写整体占 55→85%，按完成数均分
                report(
                    "rewrite",
                    55 + int(30 * done_count / total),
                    f"已改写 {done_count}/{total} 个平台（最新：{label}）",
                )
        return results, errors

    def _enforce_content_rules(self, data: dict) -> tuple[dict[str, str], list[str]]:
        """按 platforms.yaml 强制内容级规则。当前唯一硬规则：小红书纯文字无图。"""
        contents: dict[str, str] = {}
        enforcements: list[str] = []
        for key in self.registry.keys():
            rule = self.registry.get(key)
            text = str(data.get(key) or "").strip()
            if not rule.images.allowed:
                text, removed = qa.strip_placeholders(text, self.registry)
                if removed:
                    enforcements.append(
                        f"{rule.name}：规则为纯文字无图，已剔除 {removed} 个配图占位符"
                    )
            # 硬上限兜底（小红书 ≤1000）：超出则截断，绝不假装配、绝不触发 content_too_long 错误
            if rule.body.max_chars is not None and len(text) > rule.body.max_chars:
                before = len(text)
                text = text[: rule.body.max_chars]
                enforcements.append(
                    f"{rule.name}：正文 {before} 字超出硬上限 {rule.body.max_chars} 字，已截断"
                )
            contents[key] = text
        return contents, enforcements

    # 配图占位符正则（与前端 / image_matching 约定一致）
    _PH_RE = re.compile(r"【配图(\d+)\s*[:：]\s*([^】]*)】")

    def _inject_missing(self, text: str, missing: list[tuple[int, str, float]]) -> str:
        """把 missing 里的配图标记按相对位置注入到段落之间（从后往前插，避免错位）。"""
        paras = re.split(r"\n\n+", text)
        if len(paras) <= 1:
            for (_n, desc, _rel) in missing:
                text = f"{text}\n\n【配图{_n}：{desc}】\n\n"
            return text
        P = len(paras)
        inserts: list[tuple[int, str]] = []
        for (n, desc, rel) in missing:
            idx = max(0, min(P - 1, int(rel * P)))
            inserts.append((idx, f"【配图{n}：{desc}】"))
        inserts.sort(key=lambda x: x[0], reverse=True)
        for idx, token in inserts:
            paras.insert(idx + 1, token)
        return "\n\n".join(paras)

    def _align_images(
        self, contents: dict, core: str
    ) -> tuple[dict[str, str], list[str]]:
        """对允许图片的平台，强制配图占位符分散、不重复、与正文语义对齐。

        母稿 core 里的【配图N】是 AI 排好位置的（语义贴合）。模型改写时可能丢标记或
        重复（如 toutiao/bilibili 改写后丢标记、baijia 重复两次），这里用代码兜底：
        1) 从 core 提取配图计划（编号/描述/相对位置 0~1），按编号去重、按位置排序；
        2) 对每个 allowed 平台：同编号只保留首个（解决"堆一起/重复"）；
           缺失的编号按 core 相对位置注入到该平台正文最近段落边界（保持分散）。
        """
        enforcements: list[str] = []
        plan: list[tuple[int, str, float]] = []
        seen: set[int] = set()
        core_len = max(1, len(core))
        for m in self._PH_RE.finditer(core):
            n = int(m.group(1))
            if n in seen:
                continue
            seen.add(n)
            plan.append((n, m.group(2).strip(), m.start() / core_len))
        if not plan:
            return contents, enforcements
        plan.sort(key=lambda x: x[2])

        out = dict(contents)
        for key in self.registry.keys():
            rule = self.registry.get(key)
            if not rule.images.allowed:
                continue
            text = str(contents.get(key) or "").strip()
            if not text:
                continue
            # 1) 去重：同编号只保留首个出现
            occurrences = list(self._PH_RE.finditer(text))
            keep: set[int] = set()
            seen_n: set[int] = set()
            for m in occurrences:
                n = int(m.group(1))
                if n in seen_n:
                    continue
                seen_n.add(n)
                keep.add(m.start())
            # 从后往前删除重复
            for m in sorted(
                (o for o in occurrences if o.start() not in keep),
                key=lambda x: x.start(),
                reverse=True,
            ):
                text = text[: m.start()] + text[m.end():]
            # 2) 补齐缺失
            present_n = {int(m.group(1)) for m in self._PH_RE.finditer(text)}
            missing = [(n, desc, rel) for (n, desc, rel) in plan if n not in present_n]
            if missing:
                text = self._inject_missing(text, missing)
                enforcements.append(
                    f"{rule.name}：补回 {len(missing)} 个被改写丢掉的配图占位符"
                )
            # 3) 分散兜底：改写后图片仍堆一起 / 过度集中在结尾 → 按段落均匀重排。
            #    LLM 常把配图占位符堆在末尾，这里代码兜底，确保「生成即分散」，
            #    不依赖前端加载时机（新建草稿首次生成也可能不经过前端 alignText）。
            reshuffled = self._redistribute(text, plan)
            if reshuffled != text:
                text = reshuffled
                enforcements.append(f"{rule.name}：配图位置已打散均匀重排")
            out[key] = text
        return out, enforcements

    def _need_reshuffle(self, text: str) -> bool:
        """配图是否已堆一起 / 过度集中在结尾（需要重排）。"""
        paras = [p for p in re.split(r"\n\n+", text.strip()) if p.strip()]
        if len(paras) <= 3:
            return False
        P = len(paras)
        idxs = [i for i, p in enumerate(paras) if self._PH_RE.search(p)]
        if len(idxs) < 2:
            return False
        # 相邻两张图间隔 < 2 段 → 堆一起
        for a, b in zip(idxs, idxs[1:]):
            if b - a < 2:
                return True
        # 全部落在最后 30% 段落 → 过度集中
        if idxs[0] >= max(1, int(P * 0.7)):
            return True
        return False

    def _redistribute(self, text: str, plan: list[tuple[int, str, float]]) -> str:
        """把配图占位符按段落均匀重排（保留 plan 里的编号/描述，丢弃 LLM 给的错位位置）。"""
        if not self._need_reshuffle(text) or not plan:
            return text
        cleaned = self._PH_RE.sub("", text)
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
        paras = [p for p in re.split(r"\n\n+", cleaned) if p.strip()]
        P = len(paras)
        if P <= 1:
            return (
                cleaned
                + "\n\n"
                + "\n\n".join(f"【配图{n}：{d}】" for (n, d, _r) in plan)
            )
        inserts: list[tuple[int, str]] = []
        for k, (n, desc, _r) in enumerate(plan):
            idx = min(P - 1, int((k + 1) / (len(plan) + 1) * P))
            inserts.append((idx, f"【配图{n}：{desc}】"))
        inserts.sort(key=lambda x: x[0], reverse=True)
        for idx, tok in inserts:
            paras.insert(idx + 1, tok)
        return "\n\n".join(paras)

    def _generate_titles(self, topic: str, article_type: str) -> tuple[dict[str, str], list[str]]:
        """为四平台各生成一条符合平台调性的标题（LLM），失败时回退确定性截断。

        四平台标题必须明显不同、各有平台味：头条悬念数据钩子、抖音口语有梗、
        哔哩哔哩二次元玩梗、小红书 emoji 清单种草。模型偶发偷懒输出雷同标题，
        此时直接回退 _derive_titles（截断选题），保证不出现"四平台同款"。
        """
        style = {
            "toutiao": "悬念/数据钩子，像朋友在饭桌上安利，别标题党",
            "douyin": "口语化、有梗、短平快，像刷到就停不下来",
            "bilibili": "二次元梗、吐槽感、年轻化，带点玩梗语气",
            "xhs": "清单感、第一人称、种草语气，像安利好物（标题最多 1 个 emoji，绝不堆砌）",
        }
        keys = list(self.registry.keys())
        limits = {k: self.registry.get(k).title.max_chars for k in keys}
        lines = "\n".join(
            f"- {k}（{limits[k]}字内）：{style.get(k, '贴合平台调性')}" for k in keys
        )
        user = (
            f"选题：{topic}\n"
            f"文章类型：{'深度长文' if article_type == 'depth' else '盘点资讯'}\n"
            f"各平台标题要求（含标点，必须≤字数上限）：\n{lines}\n\n"
            "只输出 JSON，键为平台 key，值为该平台标题，四平台要明显不同：\n"
            '{"toutiao":"...","douyin":"...","bilibili":"...","xhs":"..."}'
        )
        try:
            raw = self._call_model(
                user,
                temperature=0.8,
                max_tokens=400,
                extra2="\n务必输出合法 JSON，四平台标题要明显不同、各有平台味。",
            )
            data = extract_json_object(raw)
            titles: dict[str, str] = {}
            notes: list[str] = []
            for k in keys:
                t = _coerce_text(data.get(k)).strip() or topic
                limit = limits[k]
                if len(t) > limit:
                    t = _smart_truncate(t, limit)
                    notes.append(
                        f"{self.registry.get(k).name}：标题 {len(t)} 字超出 {limit} 字上限，已截断"
                    )
                titles[k] = t
            # 模型偷懒输出雷同 → 回退截断选题，保证不出现四平台同款
            if len({v for v in titles.values()}) < 2:
                return self._derive_titles(topic)
            return titles, notes
        except Exception:
            # LLM 失败绝不阻断生成，回退确定性截断
            return self._derive_titles(topic)

    def _derive_titles(self, topic: str) -> tuple[dict[str, str], list[str]]:
        """按各平台标题上限派生标题。

        归档流程里四平台标题是人工在 `gen_*.py` 里手写的，模型只吐正文 JSON
        （见 PROMPTS_BASE 的输出契约）。为了不改动归档 prompt 的字面内容，
        这里用**确定性截断**从选题派生标题，超限一律截断并在 enforcements 里
        如实登记，交由人工在文章管理界面改写——不臆造标题、不静默放行超限。
        """
        titles: dict[str, str] = {}
        notes: list[str] = []
        for key in self.registry.keys():
            rule = self.registry.get(key)
            limit = rule.title.max_chars
            if len(topic) <= limit:
                titles[key] = topic
                continue
            cut = _smart_truncate(topic, limit)
            titles[key] = cut
            notes.append(
                f"{rule.name}：选题 {len(topic)} 字超出标题上限 {limit} 字，已截断为「{cut}」，建议人工改写"
            )
        return titles, notes

    def _suggest_images(
        self, contents: dict[str, str], *, article_id: str | None, enabled: bool
    ) -> tuple[dict[str, str], list[ImageSuggestion]]:
        """扫描占位符 → 用素材库给出建议来源。

        `image_sources` 的键是占位符原文（与归档 gen_base 的约定一致），
        值为素材标识；**没匹配上就留空字符串**，由 qa 报 warning，绝不假装配好了。
        """
        regex = self.registry.placeholder.regex
        image_sources: dict[str, str] = {}
        suggestions: list[ImageSuggestion] = []
        seen: set[str] = set()

        matcher = (
            ImageMatcherService(self.session) if (enabled and self.session is not None) else None
        )

        for key in self.registry.keys():
            if not self.registry.get(key).images.allowed:
                continue
            for match in regex.finditer(contents.get(key) or ""):
                placeholder = match.group(0)
                if placeholder in seen:
                    continue
                seen.add(placeholder)
                index = int(match.group(1))
                description = match.group(2).strip()

                hit = None
                if matcher is not None:
                    hit = matcher.match_placeholder(
                        index, description, cache_key="", article_id=article_id
                    )
                if hit is None:
                    image_sources[placeholder] = ""
                    suggestions.append(
                        ImageSuggestion(
                            placeholder=placeholder,
                            index=index,
                            description=description,
                            matched=False,
                            reason="素材库无匹配" if matcher is not None else "未启用素材匹配",
                        )
                    )
                    continue
                # 存相对 path（与 bind_image 端点一致：_素材库/作品/xxx.jpeg），
                # 编辑器 proxy() 才能解析成可访问的 /images/... 真实出图。
                image_sources[placeholder] = hit.path
                suggestions.append(
                    ImageSuggestion(
                        placeholder=placeholder,
                        index=index,
                        description=description,
                        matched=True,
                        material_id=hit.material_id,
                        stem=hit.stem,
                        path=hit.path,
                        url=hit.url,
                        score=hit.score,
                        reason=hit.reason,
                    )
                )
        return image_sources, suggestions

    def _render(
        self, contents: dict[str, str], *, article_id: str | None, match_images: bool
    ) -> dict[str, RenderResult]:
        resolver = None
        if match_images and self.session is not None:
            resolver = ImageMatcherService(self.session).resolver(article_id=article_id)
        service = RenderService(image_resolver=resolver)
        return service.render_all(contents, cache_key=article_id or "generation")


def _smart_truncate(text: str, limit: int) -> str:
    """在 limit 内尽量截到标点边界；找不到就硬截。"""
    if len(text) <= limit:
        return text
    window = text[:limit]
    best = max((window.rfind(ch) for ch in _TITLE_CUT_CHARS), default=-1)
    if best >= max(4, limit // 2):
        return window[:best].rstrip(_TITLE_CUT_CHARS)
    return window.rstrip()

# 爆款基因合法集合（与 TOPIC_SYSTEM_PROMPT 一致）；模型偶发拼写漂移时只保留合法项
_VALID_GENES = ("情绪钩子", "信息差", "身份标签", "行动触发")


def _as_gene_list(value: Any) -> list[str]:
    """把模型输出的 genes 规范成合法基因列表（最多 3 个）。

    模型可能返回数组或逗号分隔字符串；非法项/超量一律丢弃，避免脏数据落库。
    """
    raw: list[str] = []
    if isinstance(value, list):
        raw = [str(x).strip() for x in value if str(x).strip()]
    elif isinstance(value, str):
        s = value
        for sep in (",", "，", "、"):
            s = s.replace(sep, ",")
        raw = [p.strip() for p in s.split(",") if p.strip()]
    return [g for g in raw if g in _VALID_GENES][:3]


def _extract_json_list(raw: str) -> list[dict]:
    """容忍地把模型输出解析成对象列表。

    模型偶尔不包外层方括号（直接 `{...}, {...}` 输出），或夹杂说明文字。
    依次尝试：① 整体是 JSON 数组；② 截取首个 [ … ] 区间；③ 退化为逐个扫描平衡括号的顶层对象。
    解析失败的对象静默跳过，绝不让单个坏片段拖垮整轮选题生成。
    """
    raw = (raw or "").strip()
    if not raw:
        return []

    # ① 整体就是数组
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [d for d in data if isinstance(d, dict)]
    except Exception:
        pass

    # ② 截取 [ ... ] 包裹的数组
    start = raw.find("[")
    end = raw.rfind("]")
    if start != -1 and end > start:
        try:
            data = json.loads(raw[start : end + 1])
            if isinstance(data, list):
                return [d for d in data if isinstance(d, dict)]
        except Exception:
            pass

    # ③ 退化：扫描所有顶层 {...} 对象，逐个解析收集
    items: list[dict] = []
    i, n = 0, len(raw)
    while i < n:
        if raw[i] == "{":
            depth = 0
            for j in range(i, n):
                if raw[j] == "{":
                    depth += 1
                elif raw[j] == "}":
                    depth -= 1
                    if depth == 0:
                        chunk = raw[i : j + 1]
                        try:
                            obj = json.loads(chunk)
                            if isinstance(obj, dict):
                                items.append(obj)
                        except Exception:
                            pass
                        i = j + 1
                        break
            else:
                break
        else:
            i += 1
    return items

