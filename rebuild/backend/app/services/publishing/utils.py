"""发布服务 · 文案处理工具（纯函数，不依赖 Session）。"""

import re

# Markdown → 可直接粘贴的纯文本
_MD_HEADING = re.compile(r"^\s{0,3}#{1,6}\s*", re.M)
_MD_QUOTE = re.compile(r"^\s{0,3}>\s?", re.M)
_MD_HR = re.compile(r"^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$", re.M)
_MD_BOLD = re.compile(r"\*\*(.+?)\*\*", re.S)
_MD_INLINE_CODE = re.compile(r"`([^`]+)`")
_MD_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_BLANKS = re.compile(r"\n{3,}")
_URL_RE = re.compile(r"^https?://\S+$", re.I)


def markdown_to_copy_text(md: str) -> str:
    """把平台正文 Markdown 转成可直接粘进后台编辑器的纯文本。"""
    text = _MD_HR.sub("", md or "")
    text = _MD_HEADING.sub("", text)
    text = _MD_QUOTE.sub("", text)
    text = _MD_BOLD.sub(r"\1", text)
    text = _MD_INLINE_CODE.sub(r"\1", text)
    text = _MD_LINK.sub(r"\1", text)
    return _BLANKS.sub("\n\n", text).strip()


def is_valid_url(value: str | None) -> bool:
    return bool(value and _URL_RE.match(value.strip()))
