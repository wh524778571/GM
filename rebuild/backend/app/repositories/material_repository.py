"""materials 仓储：素材索引读写 + 检索原语（供配图匹配服务使用）。"""

from __future__ import annotations

from sqlalchemy import Text, cast, func, or_, select

from app.models.material import Material, MaterialSource
from app.repositories.base import BaseRepository


class MaterialRepository(BaseRepository[Material]):
    model = Material

    def get_by_path(self, path: str) -> Material | None:
        return self.session.scalar(select(Material).where(Material.path == path))

    def upsert(self, path: str, **fields) -> tuple[Material, bool]:
        existing = self.get_by_path(path)
        if existing is None:
            obj = Material(path=path, **fields)
            self.add(obj)
            return obj, True
        for key, value in fields.items():
            setattr(existing, key, value)
        self.session.flush()
        return existing, False

    def list(
        self,
        *,
        work: str | None = None,
        source: str | None = None,
        article_id: str | None = None,
        keyword: str | None = None,
        ext: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Material]:
        stmt = select(Material)
        if work:
            stmt = stmt.where(Material.work == work)
        if source:
            stmt = stmt.where(Material.source == source)
        if article_id:
            stmt = stmt.where(Material.article_id == article_id)
        if ext:
            if ext == "static":
                stmt = stmt.where(Material.ext != ".gif")
            else:
                stmt = stmt.where(Material.ext == ext)
        if keyword:
            like = f"%{keyword}%"
            stmt = stmt.where(
                or_(
                    Material.stem.like(like),
                    Material.subtitle.like(like),
                    Material.work.like(like),
                    Material.scene.like(like),
                )
            )
        stmt = stmt.order_by(Material.work, Material.episode, Material.stem).limit(limit).offset(offset)
        return list(self.session.scalars(stmt))

    def candidates_for_keywords(
        self,
        keywords: list[str],
        *,
        exclude_article_id: str | None = None,
        include_recycle: bool = True,
        hard_limit: int = 2000,
    ) -> list[Material]:
        """粗筛：任一关键词命中 文件名/字幕/作品/场景/标签 的素材。

        精排（打分）在服务层完成，避免把评分规则散落到 SQL 里。
        """
        if not keywords:
            return []

        stmt = select(Material)
        clauses = []
        for kw in keywords:
            like = f"%{kw}%"
            clauses.extend(
                [
                    Material.stem.like(like),
                    Material.subtitle.like(like),
                    Material.work.like(like),
                    Material.scene.like(like),
                    func.coalesce(func.lower(cast(Material.tags, Text)), "").like(f"%{kw.lower()}%"),
                ]
            )
        stmt = stmt.where(or_(*clauses))

        if exclude_article_id:
            stmt = stmt.where(
                or_(Material.article_id.is_(None), Material.article_id != exclude_article_id)
            )
        if not include_recycle:
            stmt = stmt.where(Material.source != MaterialSource.RECYCLE.value)

        return list(self.session.scalars(stmt.limit(hard_limit)))

    def works(self) -> list[tuple[str, int]]:
        stmt = (
            select(Material.work, func.count())
            .where(Material.work.is_not(None))
            .group_by(Material.work)
            .order_by(func.count().desc())
        )
        return [(w, int(n)) for w, n in self.session.execute(stmt)]
