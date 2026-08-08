"""articles 仓储。"""

from __future__ import annotations

from sqlalchemy import select

from app.models.article import Article, ArticleStatus
from app.repositories.base import BaseRepository


class ArticleRepository(BaseRepository[Article]):
    model = Article

    def get_by_article_id(self, article_id: str) -> Article | None:
        stmt = select(Article).where(Article.article_id == article_id)
        return self.session.scalar(stmt)

    def list(
        self,
        *,
        status: str | None = None,
        keyword: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Article]:
        stmt = select(Article)
        if status:
            stmt = stmt.where(Article.status == status)
        else:
            stmt = stmt.where(Article.status != ArticleStatus.DELETED.value)
        if keyword:
            like = f"%{keyword}%"
            stmt = stmt.where(Article.title.like(like) | Article.article_id.like(like))
        stmt = stmt.order_by(Article.updated_at.desc()).limit(limit).offset(offset)
        return list(self.session.scalars(stmt))

    def upsert(self, article_id: str, **fields) -> tuple[Article, bool]:
        """按 article_id upsert。返回 (对象, 是否新建)——调用方据此如实上报状态。"""
        existing = self.get_by_article_id(article_id)
        if existing is None:
            obj = Article(article_id=article_id, **fields)
            self.add(obj)
            return obj, True
        for key, value in fields.items():
            setattr(existing, key, value)
        self.session.flush()
        return existing, False

    def count_by_status(self) -> dict[str, int]:
        from sqlalchemy import func

        stmt = select(Article.status, func.count()).group_by(Article.status)
        return {status: int(n) for status, n in self.session.execute(stmt)}

    def soft_delete_many(self, ids: list[str]) -> tuple[int, list[str]]:
        """批量软删（置为 deleted）。返回 (已删数量, 不存在的 id 列表)。"""
        if not ids:
            return 0, []
        stmt = select(Article).where(Article.article_id.in_(ids))
        rows = list(self.session.scalars(stmt))
        found_ids = {a.article_id for a in rows}
        for a in rows:
            a.status = ArticleStatus.DELETED.value
        self.session.flush()
        not_found = [i for i in ids if i not in found_ids]
        return len(rows), not_found
