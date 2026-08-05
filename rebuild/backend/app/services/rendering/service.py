"""四平台差异化渲染服务 —— 复刻 `phase0-archive/code/md_renderer.py`（最值钱资产）。

平台差异（与归档实现 1:1，差异项全部由 platforms.yaml 驱动，代码内不写死）：

| 平台      | 图片        | 图注 | alt/title | img margin-bottom |
|-----------|-------------|------|-----------|-------------------|
| toutiao   | div 包裹    | 否   | 否        | 20px              |
| baijia    | div 包裹    | 是   | 否        | 4px（给图注留白） |
| bilibili  | div 包裹    | 否   | 是        | 20px              |
| xhs       | 全部剔除    | —    | —         | —                 |

注：归档实现的 docstring 写「bilibili 为裸 img」，但其代码 `wrap_div = True`
    对三平台一律包裹 img-block。此处以**代码实际行为**为准（1:1 复刻），
    差异仅体现在 alt/title 与 margin-bottom。

「禁止静默成功」（坑 3）：渲染结果一律带 warnings / missing_images，
调用方可判断本次渲染是否真的完整，不存在「看起来成功其实缺图」。
"""

from __future__ import annotations

import html as html_lib
import re
from dataclasses import dataclass, field
from typing import Callable

from app.core.platform_rules import PlatformRule, load_registry
from app.services.rendering import styles as S
from app.services.rendering.markdown_renderer import md_to_html
from app.services.text_utils import suggest_filename

# 图片解析器：(序号, 描述, cache_key) -> 图片 URL 或 None（None 视为缺图）
ImageResolver = Callable[[int, str, str], str | None]

_META_MARKERS = (
    r"📷\s*\*\*",
    r"📌\s*发布提醒",
    r"\*.*@Yolo.*\*",
)


@dataclass
class MissingImage:
    index: int
    description: str
    suggested_filename: str


@dataclass
class RenderResult:
    platform: str
    platform_name: str
    html: str
    char_count: int
    image_count: int
    missing_images: list[MissingImage] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        """无缺图且无规则告警才算完整成功。"""
        return not self.missing_images and not self.warnings


def trim_metadata(md_text: str) -> str:
    """截掉文末元数据（签名 / 发布提醒 / 配图清单）。"""
    cut_pos = len(md_text)
    for marker in _META_MARKERS:
        match = re.search(marker, md_text)
        if match and match.start() < cut_pos:
            cut_pos = match.start()

    if cut_pos < len(md_text):
        before = md_text[:cut_pos]
        last_hr = before.rfind("\n---\n")
        md_text = before[:last_hr].rstrip() if last_hr != -1 else before.rstrip()

    return re.sub(r"\n---\s*$", "", md_text)


def _clean_desc(raw: str) -> str:
    """去掉「配图N:」前缀，只留描述文字。"""
    return re.sub(r"^【配图\d+[:：]\s*", "", raw).strip()


def _esc(value: str) -> str:
    """属性/文本转义（坑 7：字符串模板注入）。"""
    return html_lib.escape(value, quote=True)


def missing_image_html(index: int, desc: str) -> str:
    """缺图占位块：显式告诉用户缺了什么、建议文件名是什么（绝不静默跳过）。

    与归档实现的**唯一有意偏差**：不再输出内联 `onclick="openImagePicker(...)"`。
    该写法把用户文本直接拼进 JS 字符串，属坑 7「字符串模板注入」；
    换图交互改由前端读取 data-placeholder / data-filename 绑定（Phase 3）。
    """
    desc = _esc(desc)
    filename = _esc(suggest_filename(desc))
    return (
        f'<div class="missing-img-placeholder" data-placeholder="{desc}" data-filename="{filename}"'
        f' style="background:rgba(251,191,36,0.12);border:2px dashed rgba(251,191,36,0.35);'
        f'cursor:pointer;border-radius:8px;padding:16px 20px;margin:16px 0;text-align:center;">'
        f'<p style="margin:0 0 6px 0;font-size:15px;color:#FFB950;font-weight:bold;">'
        f"📷 缺少配图{index}</p>"
        f'<p style="margin:0;font-size:13px;color:#E0B84C;line-height:1.6;">'
        f'请从素材库选择，或放入 <code style="background:rgba(255,185,80,0.15);color:#FFB950;'
        f'padding:2px 8px;border-radius:4px;font-weight:bold;">配图/</code> 文件夹</p>'
        f'<p style="margin:6px 0 0 0;font-size:12px;color:#E0B84C;">'
        f'建议文件名:<code style="background:rgba(255,185,80,0.15);color:#FFB950;'
        f'padding:2px 8px;border-radius:4px;word-break:break-all;">{filename}</code></p>'
        f"</div>"
    )


def xhs_text_optimize(html_body: str) -> str:
    """小红书纯文字优化：字号/行距下调，分隔线换成「· · ·」。"""
    html_body = html_body.replace(f'<h1 style="{S.H1_STYLE}">', f'<h1 style="{S.XHS_H1_STYLE}">')
    html_body = html_body.replace(
        f'<hr style="{S.HR_STYLE}">', f'<p style="{S.XHS_HR_STYLE}">· · ·</p>'
    )
    html_body = html_body.replace("margin:18px 0 6px 0;color:#222;\"", f'{S.XHS_EMOJI_STYLE}"')
    html_body = html_body.replace(
        'font-size:15px;line-height:1.8;margin:0 0 12px 0;color:#333;"',
        'font-size:14px;line-height:1.85;margin:0 0 10px 0;color:#333;"',
    )
    html_body = html_body.replace(
        "font-size:13px;color:#4a90d9;line-height:2;margin:16px 0 0 0;",
        "font-size:13px;color:#4a90d9;line-height:2.2;margin:20px 0 0 0;",
    )
    return html_body


def fix_p_div_nesting(html: str) -> str:
    """把误落在 <p> 内的 img-block <div> 提到 <p> 外（HTML 规范不允许 p 包 div）。"""

    def _move_out(match: re.Match[str]) -> str:
        pre = match.group(1).rstrip()
        div_block = f'<div class="img-block"{match.group(2)}</div>'
        post = match.group(3).lstrip()
        parts: list[str] = []
        if pre:
            parts.append(f"<p>{pre}</p>")
        parts.append(div_block)
        if post:
            parts.append(f"<p>{post}</p>")
        return "".join(parts)

    return re.sub(
        r'<p[^>]*>(.*?)<div class="img-block"(.*?)</div>(.*?)</p>',
        _move_out,
        html,
        flags=re.DOTALL,
    )


class RenderService:
    """content（Markdown 或预渲染 HTML）→ 指定平台 HTML。"""

    def __init__(
        self,
        image_resolver: ImageResolver | None = None,
        *,
        fix_p_nesting: bool = False,
    ) -> None:
        """
        Args:
            image_resolver: 配图解析器，返回 URL；None 或返回空即判定缺图。
            fix_p_nesting: 是否修复 <p> 内嵌 <div>。归档实现中该函数为**死代码**
                （gen_body 未调用），故默认 False 以保持输出与旧产物 1:1；
                需要合法 HTML 时显式开启。
        """
        self.registry = load_registry()
        self.image_resolver = image_resolver
        self.fix_p_nesting = fix_p_nesting

    # ── 对外主入口 ────────────────────────────────────────────
    def render(self, content: str, platform: str, *, cache_key: str = "") -> RenderResult:
        key = self.registry.normalize_platform(platform)
        rule = self.registry.get(key)

        missing: list[MissingImage] = []
        stripped = content.strip()

        if stripped.startswith("<"):
            # 已是预渲染 HTML：xhs 仍需剔除图片，其余原样透传
            body = self._strip_images_from_html(stripped) if not rule.images.allowed else stripped
        elif not rule.images.allowed:
            body = md_to_html(trim_metadata(content), drop_images=True)
            body = xhs_text_optimize(body)
            missing = []  # 该平台本就不配图，不算缺图
        else:
            body = md_to_html(trim_metadata(content))
            body, missing = self._replace_placeholders(body, rule, cache_key)
            if self.fix_p_nesting:
                body = fix_p_div_nesting(body)

        return self._build_result(key, rule, body, missing)

    def render_all(self, content: str | dict[str, str], *, cache_key: str = "") -> dict[str, RenderResult]:
        """一份内容 → 四平台 HTML。content 为 dict 时按平台取各自版本。"""
        results: dict[str, RenderResult] = {}
        for key in self.registry.keys():
            text = content.get(key, "") if isinstance(content, dict) else content
            results[key] = self.render(text, key, cache_key=cache_key)
        return results

    # ── 内部实现 ──────────────────────────────────────────────
    def _replace_placeholders(
        self, body_html: str, rule: PlatformRule, cache_key: str
    ) -> tuple[str, list[MissingImage]]:
        missing: list[MissingImage] = []
        occurrences: dict[str, int] = {}
        img_rule = rule.images

        def _replacer(match: re.Match[str]) -> str:
            index = int(match.group(1))
            desc_raw = match.group(2).strip()

            occurrences[desc_raw] = occurrences.get(desc_raw, 0) + 1
            occ = occurrences[desc_raw]
            if occ > 1:
                effective_desc = f"{desc_raw}__{occ}"
                occ_cache_key = f"{cache_key}:occ{occ}"
            else:
                effective_desc = desc_raw
                occ_cache_key = cache_key

            url = None
            if self.image_resolver is not None:
                url = self.image_resolver(index, effective_desc, occ_cache_key)

            if not url:
                missing.append(MissingImage(index, desc_raw, suggest_filename(desc_raw)))
                return missing_image_html(index, desc_raw)

            data_ph = _esc(effective_desc if occ > 1 else desc_raw)
            clean = _esc(_clean_desc(desc_raw))
            alt_attr = f' alt="{clean}" title="{clean}"' if img_rule.alt_text else ""
            img_tag = (
                f'<img src="{_esc(url)}" '
                f"style=\"max-width:100%;display:block;"
                f'margin:20px auto {img_rule.img_margin_bottom} auto;border-radius:4px;"'
                f"{alt_attr} />"
            )

            if not img_rule.wrap_div:
                return img_tag
            if img_rule.caption:
                return (
                    f'<div class="img-block" data-placeholder="{data_ph}">'
                    f'{img_tag}<p class="img-caption">{clean}</p></div>'
                )
            return f'<div class="img-block" data-placeholder="{data_ph}">{img_tag}</div>'

        html = self.registry.placeholder.regex.sub(_replacer, body_html)
        return html, missing

    @staticmethod
    def _strip_images_from_html(html: str) -> str:
        """小红书：预渲染 HTML 中的图片块整体剔除，确保纯文字。"""
        html = re.sub(r'<div class="img-block".*?</div>\s*', "", html, flags=re.DOTALL)
        html = re.sub(r"<img\b[^>]*>\s*", "", html)
        html = re.sub(r'<div class="missing-img-placeholder".*?</div>\s*', "", html, flags=re.DOTALL)
        return html

    def _build_result(
        self, key: str, rule: PlatformRule, body: str, missing: list[MissingImage]
    ) -> RenderResult:
        text_only = re.sub(r"<[^>]+>", "", body)
        char_count = len(re.sub(r"\s+", "", text_only))
        image_count = len(re.findall(r"<img\b", body))

        warnings: list[str] = []
        if not rule.images.allowed and image_count:
            warnings.append(f"{rule.name} 规则为纯文字无图，但渲染结果仍含 {image_count} 张图片")
        if rule.images.required and image_count == 0 and not missing:
            warnings.append(f"{rule.name} 建议配图，当前 0 张")
        if rule.body.max_chars is not None and char_count > rule.body.max_chars:
            warnings.append(
                f"{rule.name} 正文 {char_count} 字，超出上限 {rule.body.max_chars} 字"
            )
        if char_count < rule.body.target_chars * rule.body.short_ratio:
            warnings.append(
                f"{rule.name} 正文 {char_count} 字，低于目标 {rule.body.target_chars} 字"
            )
        if missing:
            warnings.append(f"{rule.name} 缺少 {len(missing)} 张配图，已插入占位块")

        return RenderResult(
            platform=key,
            platform_name=rule.name,
            html=body,
            char_count=char_count,
            image_count=image_count,
            missing_images=missing,
            warnings=warnings,
        )
