"""中文关键词/文件名匹配工具 —— 复刻旧工程 `工具/image_utils.py`。

渲染服务与配图匹配服务共用，避免旧系统那样在多处复制同一套正则（坑 4）。

2026-08 修复：原实现只有「单字分隔符 + 停用词」切分，`飞/看/望/冲` 等常用字
被当作分隔符，把 `择日飞升` 劈成 `择日`；且整词命中文件名只得 3 分，低于
`MIN_REUSE_SCORE=5`，导致 `南宫婉`/`孟川`/`韩立` 等完整角色名查询全部漏配。
现改为 **词典最大正向匹配优先、残片再走原逻辑**，并按词的专指程度加权。
详见 `app/services/lexicon.py`。
"""

from __future__ import annotations

import hashlib
import re
import unicodedata

from app.services.lexicon import LEXICON

# 移除 emoji / 装饰性符号（🔥✨💡📌 等），强迫用排版（## 小标题、**加粗**、序号、引用）分层。
# 覆盖：emoji & pictographs(1F000–1FAFF)、区域指示符(1F1E6–1F1FF)、dingbats(2700–27BF)、
# 杂项符号(2600–26FF)、杂项符号与箭头(2B00–2BFF)、变体选择符(FE00–FE0F)、零宽连字(200D)。
# 刻意不覆盖：·(00B7) …(2026) —(2014) →(2192) 等中文/排版标点（属正常排版字符）。
_EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U0001F1E6-\U0001F1FF"
    "\U00002600-\U000027BF\U00002B00-\U00002BFF"
    "\U0000FE00-\U0000FE0F\U0000200D]"
)


def strip_emoji(text: str) -> str:
    """去掉正文里的 emoji / 装饰符号，保留中文、标点与排版字符（· … — → 等）。

    即使模型无视 prompt 塞了 🔥🔥🔥，生成/润色产物也强制干净。
    """
    if not text:
        return text
    return _EMOJI_RE.sub("", text)

_SUFFIXES = (
    "场景截图", "截图", "名场面合集截图", "场景合图", "台词",
    "数据截图", "开启场景截图", "名场面", "对决",
)

_STOPWORDS = {
    "的", "了", "在", "是", "有", "和", "与", "对", "从", "到",
    "被", "把", "让", "给", "用", "上", "下", "里", "中", "不",
    "以", "而", "打", "报", "众人", "叙旧", "名号", "满屏",
    "出场", "特写", "镜头", "画面", "场景", "身", "复杂",
    "看", "望", "盯", "站", "坐", "跑", "飞", "冲",
}

_DELIMITERS = (
    "打在", "报上", "满屏", "众人", "叙旧", "特写", "出场", "身上",
    "眼神", "复杂", "从", "到", "被", "把", "让", "给", "用", "以", "而",
    "满", "看", "望", "盯", "站", "坐", "跑", "飞", "冲",
)

# 国漫作品/角色关键词库 —— 真相源已收敛到 lexicon.py（避免两处词表漂移）
GUOMAN_TERMS = LEXICON.terms()

# 词典命中加权：基础整词命中 3 分 + 下列加成，用于越过 MIN_REUSE_SCORE=5
SPECIFIC_TERM_BONUS = 4  # 角色名 / 法宝地名等专指词 → 3+4=7
GENERIC_TERM_BONUS = 2  # 作品名等泛指词 → 3+2=5（刚好达标）
PARTIAL_TERM_BONUS = 2  # 专指词的部分匹配（如「南宫」→ 南宫婉/南宫阙）→ 3+2=5


def normalize(text: str) -> str:
    """标准化文件名比对：去分隔符，留中文+字母+数字。"""
    return re.sub(r"[/:｜|\-_\s]+", "", text)


def _strip_suffix(text: str) -> str:
    for suffix in _SUFFIXES:
        if text.endswith(suffix):
            return text[: -len(suffix)]
    return text


def extract_key(text: str) -> str:
    """从【配图X：描述】提取匹配主键（去编号前缀、括号内容与语义后缀）。"""
    text = re.sub(r"^配图\d[：:]", "", text)
    text = re.sub(r"[（(].*?[）)]", "", text)
    text = _strip_suffix(text)
    return normalize(text)


def _split_residual(text: str) -> list[str]:
    """词典切不动的残片，沿用原「分隔符 + 停用词」逻辑切分。"""
    parts = [text]
    for delimiter in _DELIMITERS:
        expanded: list[str] = []
        for part in parts:
            expanded.extend(part.split(delimiter))
        parts = expanded

    keywords: list[str] = []
    for part in parts:
        part = part.strip()
        if not part or len(part) < 2:
            continue
        for sw in ("上", "下", "里", "中", "的", "了", "身"):
            while part.startswith(sw) and len(part) > 2:
                part = part[1:]
            while part.endswith(sw) and len(part) > 2:
                part = part[:-1]
        if len(part) < 2:
            continue
        match = re.search(r"[\u4e00-\u9fa5\d]+", part)
        if match:
            kw = match.group()
            if kw not in _STOPWORDS and len(kw) >= 2:
                keywords.append(kw)
    return keywords


def extract_keywords(text: str, max_keywords: int = 3) -> list[str]:
    """从描述提取多关键词，用于 OR 匹配。

    词典最大正向匹配优先，残片再走分隔符切分；保持原文顺序，
    超出 `max_keywords` 时**先丢残片、保留词典词**（专指词最后丢）。

    >>> extract_keywords("拘灵术打在韩立身上")
    ['拘灵术', '韩立']
    >>> extract_keywords("择日飞升")      # 修复前是 ['择日']
    ['择日飞升']
    """
    text = re.sub(r"^配图\d[：:]", "", text)
    text = _strip_suffix(text)
    text = normalize(text)
    if not text:
        return []

    # (关键词, 原文顺序, 优先级) —— 优先级 0=专指词 1=泛指词 2=残片
    scored: list[tuple[str, int, int]] = []
    order = 0
    for segment, is_term in LEXICON.segment(text):
        if is_term:
            scored.append((segment, order, 0 if LEXICON.is_specific(segment) else 1))
            order += 1
            continue
        for kw in _split_residual(segment):
            scored.append((kw, order, 2))
            order += 1

    # 整段既没词典词也没残片时（如纯 2 字未登录词），退回整段本身
    if not scored and len(text) >= 2 and text not in _STOPWORDS:
        scored.append((text, 0, 2))

    seen: set[str] = set()
    unique: list[tuple[str, int, int]] = []
    for kw, pos, prio in scored:
        if kw in seen:
            continue
        seen.add(kw)
        unique.append((kw, pos, prio))

    kept = sorted(unique, key=lambda item: (item[2], item[1]))[:max_keywords]
    return [kw for kw, _, _ in sorted(kept, key=lambda item: item[1])]


def extract_guoman_keywords(text: str, max_kw: int = 10) -> list[str]:
    """按国漫词库精确匹配（作品名/角色名/通用标签），专指词排在前面。"""
    return LEXICON.find_terms(text)[:max_kw]


def match_file(key: str, file_stems: list[str], keywords: list[str] | None = None) -> str | None:
    """三轮匹配：多关键词 OR → 4 字子串唯一 → 自适应子串唯一。未命中返回 None。"""
    stems = list(file_stems)
    normalized = [normalize(s) for s in stems]

    # 第 1 轮：多关键词 OR（仅唯一命中才认，防重名误配）
    for kw in keywords or [key]:
        hits = [i for i, name in enumerate(normalized) if kw in name or name in kw]
        if len(hits) == 1:
            return stems[hits[0]]

    # 反向索引：3 字子串 → 文件索引集合
    sub_index: dict[str, set[int]] = {}
    for i, name in enumerate(normalized):
        for j in range(max(0, len(name) - 2)):
            sub_index.setdefault(name[j : j + 3], set()).add(i)

    # 第 2 轮：4 字子串唯一匹配
    for j in range(len(key) - 3):
        sub = key[j : j + 4]
        left = sub_index.get(sub[:3], set())
        right = sub_index.get(sub[1:4], set())
        hits = left & right if left and right else set()
        if len(hits) == 1:
            return stems[hits.pop()]

    # 第 3 轮：自适应子串（key ≤4 字用 2 字，否则 3 字）
    sub_len = 2 if len(key) <= 4 else 3
    for j in range(len(key) - sub_len + 1):
        hits = sub_index.get(key[j : j + sub_len], set())
        if len(hits) == 1:
            return stems[hits.pop()]

    return None


def suggest_filename(description: str) -> str:
    """由配图描述生成建议文件名（缺图占位提示用）。"""
    key = re.sub(r"^【配图\d+[：:]", "", description).replace("】", "").strip()
    if not key:
        key = re.sub(r"\s+", "_", description.strip())
    safe = re.sub(r'[<>:"/\\|?*]', "", key)[:40]
    if not safe:
        safe = hashlib.md5(description.encode()).hexdigest()[:8]
    return f"{safe}.jpeg"


def term_bonus(keyword: str) -> int:
    """词典命中加成：专指词 +4 / 泛指词 +2 / 专指词的部分匹配 +2 / 未登录词 0。"""
    if LEXICON.is_specific(keyword):
        return SPECIFIC_TERM_BONUS
    if LEXICON.is_generic(keyword):
        return GENERIC_TERM_BONUS
    if LEXICON.is_partial_specific(keyword):
        return PARTIAL_TERM_BONUS
    return 0


def score_filename(stem_lower: str, keywords_lower: list[str]) -> int:
    """文件名关键词评分（复刻 image_matcher._score_filename + 词典加权）。

    基础规则不变：整词命中 +3、≥3 字词的 3 字子串命中 +1。
    新增：整词命中且该词在领域词典里时追加 `term_bonus`，
    使「完整角色名」得 7 分、「作品名」得 5 分，越过 MIN_REUSE_SCORE=5；
    未登录词维持 3 分，不会凭空产生误配。
    """
    score = 0
    for kw in keywords_lower:
        if kw in stem_lower:
            score += 3 + term_bonus(kw)
        elif len(kw) >= 3:
            for i in range(len(kw) - 2):
                if kw[i : i + 3] in stem_lower:
                    score += 1
                    break
        elif len(kw) == 2 and kw in stem_lower:
            score += 1
    return score
