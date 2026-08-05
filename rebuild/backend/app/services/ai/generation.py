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

        # 1) 组装 prompt —— system 恒为 SYSTEM_PROMPT
        user_prompt = build_user_prompt(topic, article_type, requirement)

        # 2) 调用 AI（失败原样上抛，绝不返回假文章）
        from app.core.settings import settings

        raw = self.provider.generate(
            SYSTEM_PROMPT,
            user_prompt,
            max_tokens=max_tokens if max_tokens is not None else settings.ai_max_tokens,
            temperature=temperature if temperature is not None else settings.ai_temperature,
        )

        # 3) 解析 + 平台规则强制
        data = self._parse(raw)
        contents, enforcements = self._enforce_content_rules(data)
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
            core=str(data.get("core") or "").strip(),
            titles=titles,
            contents=contents,
            image_sources=image_sources,
            image_suggestions=suggestions,
            enforcements=enforcements,
            qa_report=report,
            renders=renders,
            telemetry=self.provider.telemetry.snapshot(),
            raw_text=raw,
        )
        if strict and not report.ok:
            raise qa.QAError(report)
        return result

    # ── 各阶段实现 ────────────────────────────────────────────
    def _parse(self, raw: str) -> dict:
        try:
            data = extract_json_object(raw)
        except AIResponseError as exc:
            raise GenerationError(str(exc), stage="parse") from exc

        missing = [k for k in self.registry.keys() if not str(data.get(k) or "").strip()]
        if missing:
            raise GenerationError(
                f"模型输出缺少平台内容：{missing}（需要 {list(self.registry.keys())}）",
                stage="parse",
                detail={"present": sorted(data.keys())},
            )
        return data

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
