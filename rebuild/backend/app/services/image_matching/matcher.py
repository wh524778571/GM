"""配图模糊匹配服务 —— 复刻 `phase0-archive/code/image_matcher.py`。

匹配优先级（与归档一致）：
    Round 0  精确文件名匹配（含重复占位符 __N 后缀）
    Round 1a 标签匹配（tags）→ 优先本文章目录，否则跨库取最佳
    Round 1b 文件名子串匹配（image_utils.match_file 三轮算法）
    Round 2  跨文章 / 回收站 / 素材库检索，低于 MIN_REUSE_SCORE 判定未命中

评分（复刻 search_cross_article_images）：
    文件名命中 +3 / 3 字子串 +1；字幕命中 +4；索引关键词 +2；标签命中 ×2 加权

与归档的差异：
    - 数据源由「扫盘 + 素材索引.json」改为 materials 表（单一数据源，坑 2/6）
    - 缓存层级保持 内存60s → 磁盘10min → 重建（此处重建=查库）
    - 不做文件拷贝副作用；命中即返回 URL 与素材记录，落库/拷贝交由上层显式执行
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.settings import settings
from app.models.material import Material, MaterialSource
from app.repositories.material_repository import MaterialRepository
from app.services.image_matching.cache import ThreeLevelIndexCache, ResultCache
from app.services.lexicon import LEXICON, register_corpus_terms
from app.services.text_utils import (
    extract_guoman_keywords,
    extract_key,
    extract_keywords,
    match_file,
    score_filename,
)

MIN_REUSE_SCORE = 5  # 跨库复用最低分（同归档实现）
SUBTITLE_HIT_SCORE = 4
INDEX_KEYWORD_HIT_SCORE = 2
TAG_SCORE_MULTIPLIER = 2

_DISK_CACHE_PATH = Path(".cache/material_index.json")

# 进程级缓存（跨请求复用，与旧实现的模块级缓存等价）
_index_cache = ThreeLevelIndexCache(_DISK_CACHE_PATH)
_result_cache = ResultCache()


@dataclass
class MatchHit:
    material_id: int
    path: str
    stem: str
    work: str | None
    episode: str | None
    source: str
    article_id: str | None
    score: int
    url: str
    subtitle: str | None = None
    matched_keywords: list[str] | None = None
    reason: str = ""


def clear_caches(cache_key: str | None = None) -> None:
    """清缓存。cache_key=None 时连素材索引一起失效。"""
    _result_cache.clear(cache_key)
    if cache_key is None:
        _index_cache.invalidate()


def cache_stats() -> dict:
    return {
        "index_last_source": _index_cache.last_source,
        "result_cache_entries": _result_cache.size(),
        "disk_cache_path": str(_DISK_CACHE_PATH),
    }


class ImageMatcherService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.repo = MaterialRepository(session)

    # ── 素材索引（三级缓存） ───────────────────────────────────
    def _index_snapshot(self) -> dict[str, dict]:
        """{path: 轻量元数据}，供文件名/子串匹配快速使用。"""

        def rebuild() -> dict[str, dict]:
            snapshot: dict[str, dict] = {}
            works: set[str] = set()
            tags: set[str] = set()
            for material in self.repo.list(limit=100_000):
                if material.work:
                    works.add(material.work)
                tags.update(material.tags or [])
                snapshot[material.path] = {
                    "id": material.id,
                    "stem": material.stem,
                    "work": material.work,
                    "episode": material.episode,
                    "source": material.source,
                    "article_id": material.article_id,
                    "subtitle": material.subtitle or "",
                    "keywords": material.keywords or [],
                    "tags": material.tags or [],
                    "mtime": material.mtime,
                }
            # 数据驱动词典：语料里真实存在的作品名/标签优先于硬编码词表
            register_corpus_terms(works, tags)
            return snapshot

        snapshot = _index_cache.get(rebuild)
        # 命中缓存时 rebuild() 不会执行，这里补注册一次，保证词典与语料同步
        register_corpus_terms(
            {meta.get("work") for meta in snapshot.values() if meta.get("work")},
            {tag for meta in snapshot.values() for tag in (meta.get("tags") or [])},
        )
        return snapshot

    # ── URL 构造 ──────────────────────────────────────────────
    @staticmethod
    def build_url(material: Material) -> str:
        base = settings.img_base_url.rstrip("/")
        suffix = f"?t={material.mtime}" if material.mtime else ""
        return f"{base}/{material.path}{suffix}"

    # ── 打分 ──────────────────────────────────────────────────
    @staticmethod
    def score_fields(
        stem: str,
        subtitle: str,
        index_keywords: list[str],
        tags: list[str],
        keywords_lower: list[str],
    ) -> tuple[int, list[str]]:
        """纯函数打分，Material 与索引快照 meta 共用，避免两处评分规则漂移。

        与归档实现的差异（均为已定位的缺陷修复，见 lexicon.py）：
        1. 文件名整词命中按领域词典加权（score_filename）。
        2. 标签命中**每个关键词只计一次**。归档写法 `sum(3 for tag ...)` 会把
           `['凡人修仙传','凡人','修仙传']` 这种互为子串的冗余标签重复计 3 次
           （3×3×2=18 分），让「作品名泛指查询」压过「角色名精确命中」。
        """
        stem_lower = stem.lower()
        score = score_filename(stem_lower, keywords_lower)
        matched = [kw for kw in keywords_lower if kw in stem_lower]

        subtitle = (subtitle or "").lower()
        index_keywords = [k.lower() for k in index_keywords]
        tags = [t.lower() for t in tags]

        for kw in keywords_lower:
            if subtitle and kw in subtitle:
                score += SUBTITLE_HIT_SCORE
                matched.append(kw)
            if any(kw == ik or kw in ik or ik in kw for ik in index_keywords):
                score += INDEX_KEYWORD_HIT_SCORE
            if any(kw == tag or kw in tag or tag in kw for tag in tags):
                score += 3 * TAG_SCORE_MULTIPLIER
                matched.append(kw)

        return score, sorted(set(matched))

    def _score(self, material: Material, keywords_lower: list[str]) -> tuple[int, list[str]]:
        return self.score_fields(
            material.stem,
            material.subtitle or "",
            list(material.keywords or []),
            list(material.tags or []),
            keywords_lower,
        )

    def _score_meta(self, meta: dict, keywords_lower: list[str]) -> tuple[int, list[str]]:
        return self.score_fields(
            meta.get("stem", ""),
            meta.get("subtitle", "") or "",
            list(meta.get("keywords") or []),
            list(meta.get("tags") or []),
            keywords_lower,
        )

    # ── 跨库检索（跨文章 / 回收站 / 素材库） ──────────────────
    def search(
        self,
        keywords: list[str],
        *,
        exclude_article_id: str | None = None,
        include_recycle: bool = True,
        limit: int = 5,
    ) -> list[MatchHit]:
        if not keywords:
            return []
        keywords_lower = [kw.lower() for kw in keywords]

        candidates = self.repo.candidates_for_keywords(
            keywords,
            exclude_article_id=exclude_article_id,
            include_recycle=include_recycle,
        )

        hits: list[MatchHit] = []
        for material in candidates:
            score, matched = self._score(material, keywords_lower)
            if score <= 0:
                continue
            source_label = {
                MaterialSource.LIBRARY.value: "素材库",
                MaterialSource.ARTICLE.value: f"文章「{material.article_id}」",
                MaterialSource.RECYCLE.value: "回收站",
            }.get(material.source, material.source)
            hits.append(
                MatchHit(
                    material_id=material.id,
                    path=material.path,
                    stem=material.stem,
                    work=material.work,
                    episode=material.episode,
                    source=material.source,
                    article_id=material.article_id,
                    score=score,
                    url=self.build_url(material),
                    subtitle=material.subtitle,
                    matched_keywords=matched,
                    reason=f"{source_label} | 匹配: {', '.join(matched[:3]) or '子串'}",
                )
            )

        hits.sort(key=lambda h: h.score, reverse=True)

        seen: set[tuple[str | None, str]] = set()
        unique: list[MatchHit] = []
        for hit in hits:
            key = (hit.article_id, hit.stem)
            if key in seen:
                continue
            seen.add(key)
            unique.append(hit)
            if len(unique) >= limit:
                break
        return unique

    def search_by_topic(self, topic: str, limit: int = 3) -> list[MatchHit]:
        """按主题文本（微头条等场景）自动建议配图。"""
        keywords = extract_guoman_keywords(topic)
        if not keywords:
            return []
        return self.search(keywords, limit=limit)

    # ── 单个占位符匹配（渲染服务的 image_resolver） ───────────
    def match_placeholder(
        self, index: int, description: str, cache_key: str = "", *, article_id: str | None = None
    ) -> MatchHit | None:
        cached = _result_cache.get(cache_key, index) if cache_key else None
        if cached:
            snapshot = self._index_snapshot()
            for path, meta in snapshot.items():
                if self.build_url_from_meta(path, meta) == cached:
                    return self._hit_from_meta(path, meta, score=999, reason="缓存命中")

        key = extract_key(description)
        keywords = extract_keywords(description) or ([key] if key else [])
        snapshot = self._index_snapshot()

        # Round 0：精确 stem 匹配（优先本文章素材）
        for path, meta in snapshot.items():
            if meta["stem"] == description and (
                article_id is None or meta["article_id"] in (None, article_id)
            ):
                return self._finalize(path, meta, cache_key, index, 100, "精确文件名匹配")

        # Round 1a：标签匹配，优先同文章目录
        #
        # 只在查询里**没有专指词**时才走标签路径：标签目前只有作品名级别的粒度
        # （如 ['凡人修仙传','凡人','修仙传']），一旦查询里带了角色名，
        # 用标签命中会从几百张同作品素材里随便挑一张，把精确的角色名匹配挤掉。
        has_specific = any(LEXICON.is_specific(kw) for kw in keywords)
        if keywords and not has_specific:
            tag_pool = [
                (path, meta)
                for path, meta in snapshot.items()
                if any(kw in (meta.get("tags") or []) for kw in keywords)
            ]
            same_folder = [(p, m) for p, m in tag_pool if article_id and m["article_id"] == article_id]
            pool = same_folder or tag_pool
            if pool:
                keywords_lower = [kw.lower() for kw in keywords]
                # 原实现取 pool[0]（任意一张）；改为取池内最高分，结果确定且更相关
                path, meta = max(pool, key=lambda item: self._score_meta(item[1], keywords_lower)[0])
                return self._finalize(path, meta, cache_key, index, 90, "标签匹配")

        # Round 1b：文件名子串三轮匹配（限定本文章素材，保持隔离语义）
        if article_id:
            article_items = {
                meta["stem"]: (path, meta)
                for path, meta in snapshot.items()
                if meta["article_id"] == article_id
            }
            if article_items:
                matched_stem = match_file(key, list(article_items), keywords)
                if matched_stem:
                    path, meta = article_items[matched_stem]
                    return self._finalize(path, meta, cache_key, index, 80, "文件名子串匹配")

        # Round 2：跨文章 / 回收站 / 素材库
        results = self.search(
            keywords, exclude_article_id=article_id, include_recycle=True, limit=1
        )
        if not results:
            return None
        best = results[0]
        if best.score < MIN_REUSE_SCORE:
            return None
        if cache_key:
            _result_cache.set(cache_key, index, best.url)
        return best

    def resolver(self, article_id: str | None = None):
        """返回可直接交给 RenderService 的 image_resolver。"""

        def _resolve(index: int, description: str, cache_key: str) -> str | None:
            hit = self.match_placeholder(index, description, cache_key, article_id=article_id)
            return hit.url if hit else None

        return _resolve

    # ── 内部小工具 ────────────────────────────────────────────
    @staticmethod
    def build_url_from_meta(path: str, meta: dict) -> str:
        base = settings.img_base_url.rstrip("/")
        suffix = f"?t={meta['mtime']}" if meta.get("mtime") else ""
        return f"{base}/{path}{suffix}"

    def _hit_from_meta(self, path: str, meta: dict, *, score: int, reason: str) -> MatchHit:
        return MatchHit(
            material_id=meta["id"],
            path=path,
            stem=meta["stem"],
            work=meta.get("work"),
            episode=meta.get("episode"),
            source=meta.get("source", MaterialSource.LIBRARY.value),
            article_id=meta.get("article_id"),
            score=score,
            url=self.build_url_from_meta(path, meta),
            subtitle=meta.get("subtitle") or None,
            reason=reason,
        )

    def _finalize(
        self, path: str, meta: dict, cache_key: str, index: int, score: int, reason: str
    ) -> MatchHit:
        hit = self._hit_from_meta(path, meta, score=score, reason=reason)
        if cache_key:
            _result_cache.set(cache_key, index, hit.url)
        return hit
