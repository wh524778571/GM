"""发布前质检 —— 移植自 `phase0-archive/prompts/gen_base.py`。

移植的三个函数：`validate_titles` / `validate_image_placeholders` / `quality_check`。

与归档实现的差异（都是有意的修正，不是重写）：

1. **规则不再写死**。归档在 `gen_base.py` 里有 `TITLE_LIMITS`，`quality_check()`
   内部又抄了一份 `limits`/`targets`（两处数字必然漂移，坑 5）。现在全部读
   `config/platforms.yaml`：标题上下限、正文目标字数、短文比例、配图密度、
   小红书「纯文字无图」都只有那一个来源。
2. **不再靠 print 表达结果**。归档把结论打在 stdout，调用方只能看 `return False`。
   现在返回结构化 `QAReport`（issues 分 error/warning），API 与脚本共用；
   `report.ok` 为 False 时调用方必须显式失败（坑 3：禁止静默通过）。
3. **占位符正则来自 platforms.yaml**（全角/半角冒号都认），归档正则只认全角。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.core.platform_rules import PlatformRegistry, load_registry

ERROR = "error"
WARNING = "warning"


@dataclass(frozen=True)
class QAIssue:
    level: str          # error | warning
    code: str           # 机器可读的问题码
    platform: str | None
    message: str

    def to_dict(self) -> dict:
        return {
            "level": self.level,
            "code": self.code,
            "platform": self.platform,
            "message": self.message,
        }


@dataclass
class QAReport:
    issues: list[QAIssue] = field(default_factory=list)

    # ── 组装 ──────────────────────────────────────────────────
    def add(self, level: str, code: str, message: str, platform: str | None = None) -> None:
        self.issues.append(QAIssue(level=level, code=code, platform=platform, message=message))

    def extend(self, other: "QAReport") -> "QAReport":
        self.issues.extend(other.issues)
        return self

    # ── 读取 ──────────────────────────────────────────────────
    @property
    def errors(self) -> list[QAIssue]:
        return [i for i in self.issues if i.level == ERROR]

    @property
    def warnings(self) -> list[QAIssue]:
        return [i for i in self.issues if i.level == WARNING]

    @property
    def ok(self) -> bool:
        """只有 0 个 error 才算通过。warning 不阻断，但必须原样透出。"""
        return not self.errors

    def to_dict(self) -> dict:
        return {
            "ok": self.ok,
            "error_count": len(self.errors),
            "warning_count": len(self.warnings),
            "issues": [i.to_dict() for i in self.issues],
        }

    def to_lines(self) -> list[str]:
        icon = {ERROR: "❌", WARNING: "⚠️"}
        return [f"  {icon.get(i.level, '·')} [{i.code}] {i.message}" for i in self.issues]


class QAError(RuntimeError):
    """质检未通过。带上完整报告，便于 API / 脚本原样透出。"""

    def __init__(self, report: QAReport) -> None:
        super().__init__(
            "内容质检未通过："
            + "；".join(i.message for i in report.errors)
        )
        self.report = report


# ── 1. 标题字数（对应 gen_base.validate_titles）────────────────
def validate_titles(titles: dict[str, str], registry: PlatformRegistry | None = None) -> QAReport:
    reg = registry or load_registry()
    report = QAReport()
    for key in reg.keys():
        rule = reg.get(key)
        title = (titles.get(key) or "").strip()
        length = len(title)
        if not title:
            report.add(ERROR, "title_missing", f"{rule.name} 缺少标题", key)
            continue
        if length > rule.title.max_chars:
            report.add(
                ERROR,
                "title_too_long",
                f"{rule.name} 标题 {length} 字，超出上限 {rule.title.max_chars} 字：{title}",
                key,
            )
        elif length < rule.title.min_chars:
            report.add(
                WARNING,
                "title_too_short",
                f"{rule.name} 标题 {length} 字偏短（建议 ≥{rule.title.min_chars} 字）：{title}",
                key,
            )
    return report


# ── 2. 配图占位符 ↔ image_sources（对应 validate_image_placeholders）──
def find_placeholders(text: str, registry: PlatformRegistry | None = None) -> list[str]:
    """返回文本中出现的完整占位符原文，如 `【配图1：凡人修仙传_韩立】`。"""
    reg = registry or load_registry()
    return [m.group(0) for m in reg.placeholder.regex.finditer(text or "")]


def validate_image_placeholders(
    contents: dict[str, str],
    image_sources: dict[str, str],
    registry: PlatformRegistry | None = None,
) -> QAReport:
    reg = registry or load_registry()
    report = QAReport()

    found: set[str] = set()
    for platform, text in contents.items():
        if platform not in reg.platforms:
            continue
        found.update(find_placeholders(text, reg))

    defined = set(image_sources or {})
    missing = found - defined      # 正文里有、来源表没有 → 硬错误（归档同款判定）
    extra = defined - found        # 来源表有、正文没引用 → 软告警

    for placeholder in sorted(missing):
        report.add(ERROR, "image_source_missing", f"正文出现但 image_sources 缺少来源：{placeholder}")
    for placeholder in sorted(extra):
        report.add(WARNING, "image_source_unused", f"image_sources 定义了但正文未引用：{placeholder}")
    # 键在但值为空 = 已登记待配、素材库暂时没匹配上。
    # 归档实现没有这个状态（它只有"有键/没键"），生成阶段必须能如实表达
    # "这张图还没着落"，否则就退化成静默通过（坑 3）。
    for placeholder in sorted(p for p in found & defined if not (image_sources or {}).get(p)):
        report.add(
            WARNING, "image_source_empty", f"占位符尚未匹配到素材，需人工补图：{placeholder}"
        )

    for platform in reg.keys():
        if platform not in contents:
            continue
        rule = reg.get(platform)
        count = len(find_placeholders(contents.get(platform) or "", reg))
        if not rule.images.allowed and count:
            report.add(
                ERROR,
                "image_not_allowed",
                f"{rule.name} 规则为纯文字无图，正文却有 {count} 个配图占位符",
                platform,
            )
        elif rule.images.required and count == 0:
            report.add(WARNING, "image_absent", f"{rule.name} 没有配图占位符", platform)
    return report


# ── 3. 综合自检（对应 gen_base.quality_check）──────────────────
def quality_check(
    titles: dict[str, str],
    contents: dict[str, str],
    image_sources: dict[str, str] | None = None,
    registry: PlatformRegistry | None = None,
) -> QAReport:
    """标题 + 配图 + 正文字数三合一，全部规则取自 platforms.yaml。"""
    reg = registry or load_registry()
    report = QAReport()
    report.extend(validate_titles(titles, reg))
    report.extend(validate_image_placeholders(contents, image_sources or {}, reg))

    for platform in reg.keys():
        if platform not in contents:
            report.add(ERROR, "content_missing", f"{reg.get(platform).name} 缺少正文", platform)
            continue
        rule = reg.get(platform)
        text = (contents.get(platform) or "").strip()
        chars = len(text)

        if not text:
            report.add(ERROR, "content_empty", f"{rule.name} 正文为空", platform)
            continue
        if rule.body.max_chars is not None and chars > rule.body.max_chars:
            report.add(
                ERROR,
                "content_too_long",
                f"{rule.name} 正文 {chars} 字，超出硬上限 {rule.body.max_chars} 字",
                platform,
            )
        if chars < rule.body.target_chars * rule.body.short_ratio:
            report.add(
                WARNING,
                "content_too_short",
                f"{rule.name} 正文 {chars} 字，低于目标 {rule.body.target_chars} 字",
                platform,
            )

        # 配图密度：约每 chars_per_image 字 1 张（小红书不参与）
        if rule.images.allowed:
            imgs = len(find_placeholders(text, reg))
            expect = max(1, round(chars / reg.placeholder.chars_per_image))
            if imgs and imgs < expect:
                report.add(
                    WARNING,
                    "image_density_low",
                    f"{rule.name} 配图 {imgs} 张/建议 {expect} 张"
                    f"（约每 {reg.placeholder.chars_per_image} 字 1 张）",
                    platform,
                )
    return report


# ── 4. 强制修正：小红书剔图 ───────────────────────────────────
_BLANKS = re.compile(r"\n{3,}")


def strip_placeholders(text: str, registry: PlatformRegistry | None = None) -> tuple[str, int]:
    """剔除全部配图占位符，返回 (新文本, 剔除个数)。用于 xhs 纯文字硬规则。"""
    reg = registry or load_registry()
    count = len(find_placeholders(text, reg))
    if not count:
        return text, 0
    cleaned = reg.placeholder.regex.sub("", text or "")
    cleaned = _BLANKS.sub("\n\n", cleaned).strip()
    return cleaned, count
