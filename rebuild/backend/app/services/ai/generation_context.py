"""国漫文章生成 · 真实社媒数据上下文注入。

从 cn-last30days 的扫描产物读取近30天小红书/抖音/公众号讨论，
作为"真实数据与舆情"素材注入生成 prompt，让文章带真实国漫热度。
"""

from __future__ import annotations

import glob
import json
import os
import re


def load_real_data_context(topic: str, max_items: int = 8) -> str:
    """读取 cn-last30days 近30天真实社媒讨论，作为「真实数据/舆情」素材注入 prompt。

    选题关键词命中的讨论优先保留；再按全局互动量补足到 max_items，
    保证文章至少带真实国漫热度感。无扫描数据则返回空串（优雅降级，不影响生成）。
    全程按 (标题,作者,摘要) 稳定去重，避免同一条讨论重复占用名额。
    """
    try:
        base = os.path.expanduser("~/Documents/CnLast30Days")
        files = sorted(glob.glob(os.path.join(base, "*.json")))
    except Exception:
        return ""
    if not files:
        return ""
    raw_items: list[dict] = []
    keyword_hint = ""
    for fp in files:
        try:
            data = json.load(open(fp, encoding="utf-8"))
        except Exception:
            continue
        keyword_hint = data.get("keyword", "") or keyword_hint
        for pname, pval in (data.get("platforms") or {}).items():
            if not isinstance(pval, dict):
                continue
            for it in (pval.get("items") or []):
                if not isinstance(it, dict):
                    continue
                it = dict(it)
                it["_platform"] = it.get("platform") or pname
                raw_items.append(it)
    if not raw_items:
        return ""
    # 稳定去重：同一讨论（标题+作者+摘要相同）只留一条
    def _ukey(it: dict) -> tuple:
        return (it.get("title", ""), it.get("author", ""), it.get("desc", ""))

    seen: set[tuple] = set()
    items: list[dict] = []
    for it in raw_items:
        k = _ukey(it)
        if k in seen:
            continue
        seen.add(k)
        items.append(it)

    def _score(it: dict) -> int:
        eng = it.get("engagement") or {}
        for key in ("interactions", "likes", "reads"):
            v = eng.get(key) if isinstance(eng, dict) else None
            if isinstance(v, (int, float)):
                return int(v)
        return 0

    items.sort(key=_score, reverse=True)

    def _extract_terms(title: str) -> list[str]:
        # 剥离「解析/盘点/分析」等写作类后缀，提取选题核心实体词，
        # 否则中文选题无空格、整串匹配会导致几乎命中不到真实讨论。
        STOP = [
            "最新一集解析", "深度解析", "深度分析", "全解析", "解析", "分析",
            "盘点", "推荐", "评测", "解读", "怎么样", "为什么",
        ]
        raw = [t.strip() for t in re.split(r"[\s：:，,、/]+", title or "") if len(t.strip()) >= 2]
        out: list[str] = []
        for t in raw:
            for suf in STOP:
                if t.endswith(suf):
                    t = t[: -len(suf)]
                    break
            if len(t) >= 2:
                out.append(t)
        seen_terms: set[str] = set()
        res: list[str] = []
        for t in out:
            if t not in seen_terms:
                seen_terms.add(t)
                res.append(t)
        return res

    terms = _extract_terms(topic)

    def _matched(it: dict) -> bool:
        txt = f"{it.get('title', '')} {it.get('desc', '')}"
        return any(t in txt for t in terms)

    matched = [it for it in items if _matched(it)]
    # 精确命中优先保留，再按互动量补足到 max_items（去重）
    picked: list[dict] = list(matched)
    picked_keys = set(_ukey(x) for x in picked)
    for it in items:
        if len(picked) >= max_items:
            break
        k = _ukey(it)
        if k not in picked_keys:
            picked.append(it)
            picked_keys.add(k)

    lines: list[str] = []
    for it in picked[:max_items]:
        eng = it.get("engagement") or {}
        eng_parts = []
        for label, key in (("赞", "likes"), ("评", "comments"), ("藏", "collects"), ("转", "shares"), ("读", "reads")):
            v = eng.get(key) if isinstance(eng, dict) else None
            if isinstance(v, (int, float)) and v:
                eng_parts.append(f"{label}{v:,}")
        eng_txt = " ".join(eng_parts)
        fans = it.get("author_fans") or ""
        fans_txt = f"（粉丝{fans}）" if fans and fans != "--" else ""
        head = f"· {it.get('_platform', '')} · {it.get('author', '')}{fans_txt}"
        if eng_txt:
            head += f"：{eng_txt}"
        title = (it.get("title") or "").strip()
        desc = (it.get("desc") or "").strip().replace("\n", " ")[:80]
        body = title if not desc or desc == title else f"{title}——{desc}"
        lines.append(f"{head}：{body}")

    if not lines:
        return ""
    return (
        "【真实社媒数据与舆情参考 · 近30天（来自小红书/抖音/公众号真实讨论，"
        "可作数据支撑与案例素材；只引用下面列出的真实信息，禁止编造未列出的具体数字）】\n"
        + "\n".join(lines)
    )
