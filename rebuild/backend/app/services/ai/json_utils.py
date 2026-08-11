"""AI 输出 JSON 解析工具——容错提取 + 自动修复。

不依赖 Session / settings / 网络，纯函数。
"""

from __future__ import annotations

import json
import re

from app.services.ai.errors import AIResponseError


def _truncate(text: str, limit: int = 300) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= limit else text[:limit] + "…"


def _unfence_backtick_values(text: str) -> str:
    """把 `` `key`: `...` `` 这种反引号包裹的值还原成合法 JSON 字符串。"""
    pattern = re.compile(r'("(?:[^"\\]|\\.)*")(\s*:\s*)`(.*?)`', re.DOTALL)

    def repl(m: "re.Match[str]") -> str:
        key = m.group(1)
        inner = m.group(3)
        inner = (
            inner.replace("\\", "\\\\")
            .replace('"', '\\"')
            .replace("\r", "\\r")
            .replace("\t", "\\t")
            .replace("\n", "\\n")
        )
        return f'{key}: "{inner}"'

    return pattern.sub(repl, text)


def _repair_json_quotes(s: str) -> str:
    """尽力修复模型在 JSON 字符串值里漏转义的英文双引号。"""
    out: list[str] = []
    i = 0
    n = len(s)
    in_string = False
    escaped = False
    while i < n:
        c = s[i]
        if not in_string:
            out.append(c)
            if c == '"':
                in_string = True
                escaped = False
            i += 1
            continue
        if escaped:
            out.append(c)
            escaped = False
        elif c == "\\":
            out.append(c)
            escaped = True
        elif c == '"':
            j = i + 1
            while j < n and s[j] in " \t\n\r":
                j += 1
            nxt = s[j] if j < n else ""
            if nxt in (":", ",", "}", "]"):
                out.append(c)
                in_string = False
                escaped = False
            else:
                out.append('\\"')
            i += 1
        else:
            out.append(c)
            i += 1
    return "".join(out)


def extract_json_object(raw: str) -> dict:
    """从模型输出里抠出第一个完整 JSON 对象。

    容错链：去 BOM/零宽 → 去 markdown 代码块 → 去反引号值 → 
    去控制字符 → 去尾随逗号 → json.loads → _repair_json_quotes 重试。
    解析失败上抛 AIResponseError，绝不兜底假数据。
    """
    if not raw or not raw.strip():
        raise AIResponseError("模型输出为空，无法解析 JSON")

    text = raw.strip()
    text = text.lstrip("\ufeff").strip()
    text = re.sub(r"[\u200b\u200c\u200d\ufeff]", "", text)
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        text = text.strip()

    start = text.find("{")
    end = text.rfind("}") + 1
    if start < 0 or end <= start:
        raise AIResponseError(f"模型输出中找不到 JSON 对象：{_truncate(text)}")

    candidate = text[start:end]
    if candidate.startswith("```"):
        candidate = re.sub(r"^```(?:json)?\s*", "", candidate)
        candidate = re.sub(r"\s*```$", "", candidate)
        candidate = candidate.strip()
    candidate = _unfence_backtick_values(candidate)
    candidate = re.sub(r"[\x00-\x1f\x7f]", " ", candidate)
    candidate = re.sub(r",(\s*[}\]])", r"\1", candidate)

    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        try:
            data = json.loads(_repair_json_quotes(candidate))
        except json.JSONDecodeError as exc:
            raise AIResponseError(
                f"模型输出 JSON 解析失败：{exc}；原文：{_truncate(candidate)}"
            ) from exc
    if not isinstance(data, dict):
        raise AIResponseError("模型输出的 JSON 顶层不是对象")
    return data
