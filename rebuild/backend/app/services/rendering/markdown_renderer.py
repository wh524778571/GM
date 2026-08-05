"""Markdown → HTML（mistune 3.x），复刻 md_renderer._MistuneRenderer。

与归档实现的差异：仅做模块化整理，输出 HTML 字节级一致。
"""

from __future__ import annotations

import re

import mistune

from app.services.rendering import styles as S

# 图片占位符保护标记（渲染前后包裹，避免 mistune 拆散占位符）
_PH_MARKER = "\x00PLACEHOLDER_"

_PLACEHOLDER_RE = re.compile(r"【配图\d+[：:].*?】")
_RESOURCE_HINT_RE = re.compile(r"（资源定位：.*?）")


class InlineStyleRenderer(mistune.HTMLRenderer):
    """带内联样式的 HTML 渲染器（自媒体平台编辑器不吃外链 CSS）。"""

    def heading(self, text, level, **attrs):
        if level == 1:
            return f'<h1 style="{S.H1_STYLE}">{text}</h1>\n'
        return f'<h2 style="{S.H2_STYLE}">{text}</h2>\n'

    def paragraph(self, text):
        return f'<p style="{S.P_STYLE}">{text}</p>\n'

    def list(self, body, **attrs):
        ordered = attrs.get("ordered", False)
        tag = "ol" if ordered else "ul"
        return f'<{tag} style="padding-left:20px;margin:6px 0 14px 0;">\n{body}</{tag}>\n'

    def list_item(self, text):
        return f'<li style="{S.LI_STYLE}">{text}</li>\n'

    def block_quote(self, text):
        return f'<blockquote style="{S.QUOTE_STYLE}">{text}</blockquote>\n'

    def block_code(self, code, info=None):
        return (
            f'<pre style="background:#f5f5f5;padding:12px 16px;border-radius:6px;'
            f"overflow-x:auto;font-size:13px;line-height:1.5;margin:12px 0;\">"
            f"<code>{code}</code></pre>\n"
        )

    def inline_code(self, text):
        return (
            f'<code style="background:#f5f5f5;padding:2px 6px;border-radius:3px;'
            f'font-size:13px;">{text}</code>'
        )

    def link(self, text, url, title=None):
        title_attr = f' title="{title}"' if title else ""
        return f'<a href="{url}"{title_attr} style="color:#1a73e8;text-decoration:underline;">{text}</a>'

    def image(self, alt, url, title=None):
        title_attr = f' title="{title}"' if title else ""
        return (
            f'<img src="{url}" alt="{alt}"{title_attr} '
            f'style="max-width:100%;display:block;margin:16px auto;border-radius:4px;" />'
        )

    def emphasis(self, text):
        return f"<em>{text}</em>"

    def strong(self, text):
        return f"<strong>{text}</strong>"

    def strikethrough(self, text):
        return f"<del>{text}</del>"

    def thematic_break(self):
        return f'<hr style="{S.HR_STYLE}">\n'

    def table(self, header, body):
        return (
            f'<table style="width:100%;border-collapse:collapse;margin:16px 0;">'
            f"<thead>{header}</thead><tbody>{body}</tbody></table>\n"
        )

    def table_row(self, text):
        return f"<tr>{text}</tr>\n"

    def table_cell(self, text, align=None, **attrs):
        tag = "th" if attrs.get("head") else "td"
        style = f'style="padding:8px 12px;border:1px solid #ddd;text-align:{align or "left"};"'
        return f"<{tag} {style}>{text}</{tag}>"


def _restore_placeholders(html: str, placeholders: dict[str, str], drop_images: bool) -> str:
    for key, placeholder in placeholders.items():
        if drop_images:
            html = re.sub(rf"<p>{re.escape(key)}</p>\s*", "", html)
            html = html.replace(key, "")
        else:
            html = html.replace(key, placeholder)
    return html


def md_to_html(md_text: str, *, drop_images: bool = False) -> str:
    """Markdown → HTML。drop_images=True 时（小红书）直接抹掉配图占位符。"""
    placeholders: dict[str, str] = {}
    counter = 0

    def _preserve(match: re.Match[str]) -> str:
        nonlocal counter
        key = f"{_PH_MARKER}{counter}\x00"
        placeholders[key] = match.group(0)
        counter += 1
        return key

    md_text = _PLACEHOLDER_RE.sub(_preserve, md_text)
    md_text = _RESOURCE_HINT_RE.sub(_preserve, md_text)

    markdown = mistune.create_markdown(renderer=InlineStyleRenderer())
    html = markdown(md_text)

    html = _restore_placeholders(html, placeholders, drop_images)
    # 资源定位提示行不进正文
    html = re.sub(r"<p[^>]*>（资源定位：.*?）</p>\s*", "", html)
    return html
