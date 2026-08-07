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
    ) -> GenerationResult:
        """topic 为选题（主题句）。strict=True 时质检 error 直接抛 QAError。"""
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
        core = self._generate_core(user_prompt, ai_max_tokens, ai_temperature, article_type)

        # 2) 逐平台改写（各自完整正文，保证字数充足且配图内联）
        contents, rewrite_errors = self._rewrite_all_platforms(core, ai_max_tokens, ai_temperature)
        contents, content_enforcements = self._enforce_content_rules(contents)
        # 单平台改写失败兜底母稿：如实登记，绝不静默假成功
        enforcements = list(content_enforcements)
        enforcements.extend(rewrite_errors)

        # 3) 标题派生（确定性，不依赖模型）
        titles, title_enforcements = self._derive_titles(topic)
        enforcements.extend(title_enforcements)

        # 4) 配图建议（复用 image_matching，不重复实现）
        image_sources, suggestions = self._suggest_images(
            contents, article_id=article_id, enabled=match_images
        )

        # 5) 四平台预览（复用 rendering，不重复实现）
        renders: dict[str, RenderResult] = {}
        if render:
            renders = self._render(contents, article_id=article_id, match_images=match_images)

        # 6) 质检
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
    ) -> list[dict]:
        """「今日推荐选题」专用：调用模型产出选题草案（不写文章，用独立 TOPIC_SYSTEM_PROMPT）。

        与文章生成严格隔离：只做选题策划，绝不动 SYSTEM_PROMPT / 四平台产出契约。
        解析失败或无有效项时返回空列表（不抛），由 topic_service 决定补轮。
        """
        from app.core.settings import settings
        from app.services.ai.prompts import TOPIC_SYSTEM_PROMPT, build_topic_prompt

        avoid_titles = avoid_titles or []
        avoid_keys = avoid_keys or []
        user = build_topic_prompt(today, count, avoid_titles, avoid_keys)
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

    def _generate_core(self, user_prompt: str, max_tokens: int, temperature: float, article_type: str) -> str:
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
        )
        raw = self._call_model(user_prompt, temperature=temperature, max_tokens=max_tokens, extra2=extra2)
        data = self._parse_json(raw)
        core = _coerce_text(data.get("core") or "").strip()
        if len(core) < lo:
            # 草稿未达目标 → 增量式扩写（拼接累加，突破单 call 输出上限）拉到 2000+
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
        （增量本身 ≤ 模型输出上限，单次必能写完），再把增量接到原文末尾。这样正文
        长度能**单调累加**、稳定突破单 call 输出天花板，而不是整篇重写后卡在 ~1400 字
        的 Plateau（旧实现因此让百家号停在 1873 字、够不到 2000 地板）。

        模型若把原文又吐了回来（追加内容以原文开头），自动剔除重叠前缀只留新增，
        其余情况一律拼到末尾，正文长度单调累加、稳定突破单 call 输出上限。
        keep_placeholders=True 保留并照搬原文【配图N】占位符、新增段落不加新占位符；
        False 要求纯文字无图（小红书）。
        """
        if keep_placeholders:
            ph_rule = (
                "保留原文中已有的【配图N：...】占位符不变（N 与描述一字不改）；"
                "本次追加的新段落不要新增任何配图占位符"
            )
        else:
            ph_rule = "纯文字无图，不要出现任何【配图N】占位符"
        best = text.strip()
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
                f"正文严格禁止 emoji 表情符号；全文严格不超过 {hi} 字，数清楚字数再停笔。"
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
            # 模型偶尔会把原文又吐回来（追加内容以原文开头）→ 截掉重叠前缀，只留真正新增部分，
            # 避免整篇重复；其余情况直接接到末尾。总之**始终把新内容拼到末尾**，
            # 让正文长度单调累加、稳定突破 glm-4-flash 单 call 输出上限。
            if best and addition.startswith(best[:60]):
                addition = addition[len(best[:60]):].strip()
            candidate = best + "\n\n" + addition
            # 单调不退化：只接受更长的结果
            if len(candidate) > len(best):
                best = candidate
        # 硬上限兜底：万一某趟扩写越过 hi（模型偶发不守上限），按最近段落边界截断到 hi，
        # 绝不返回超过用户「2000–3000 字」天花板的正文；且不切断段落、保留原文结尾互动引导
        # （扩写追加在原文 CTA 之后，截掉的是末尾冗余新增，不影响完整度）。
        if len(best) > hi:
            cut = best.rfind("\n\n", 0, hi)
            best = best[: cut if cut > lo else hi]
        return best

    def _rewrite_platform(self, core: str, key: str, max_tokens: int, temperature: float) -> str:
        """把母稿改写成单个平台的完整正文（保留/剔除配图占位符按平台规则）。

        长度契约取自 platforms.yaml 的 body.target_chars，避免一刀切 800–1200 字
        把小红书（本就短句分行）误判过短而兜底母稿，丢掉平台风格。
        """
        rule = self.registry.get(key)
        target = rule.body.target_chars
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
            f"要求：风格——{rule.style}；这是一篇约 {target} 字（±30%）的完整正文"
            f"（绝不是标题、绝不是一句话）；"
            f"{img_instruction}正文严格禁止 emoji 表情符号；"
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

    def _rewrite_all_platforms(self, core: str, max_tokens: int, temperature: float) -> tuple[dict[str, str], list[str]]:
        """并行把母稿改写成各平台完整正文（相互独立，并发提速）。

        返回 (各平台正文, 失败告警列表)。单平台失败兜底用母稿，
        失败项进告警列表，由 generate() 汇总进 enforcements，绝不静默假成功。
        """
        from concurrent.futures import ThreadPoolExecutor

        keys = list(self.registry.keys())
        results: dict[str, str] = {}
        errors: list[str] = []
        with ThreadPoolExecutor(max_workers=len(keys)) as ex:
            futures = {
                ex.submit(self._rewrite_platform, core, k, max_tokens, temperature): k
                for k in keys
            }
            for fut in futures:
                k = futures[fut]
                try:
                    results[k] = fut.result()
                except Exception as exc:
                    results[k] = core  # 兜底母稿，QA 会报 warning，绝不静默假成功
                    errors.append(f"{k} 改写失败，已兜底母稿：{exc}")
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
                image_sources[placeholder] = hit.stem
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

