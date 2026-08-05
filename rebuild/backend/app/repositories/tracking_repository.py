"""tracking 仓储：保留旧库 UNIQUE(date, article, platform) 的 upsert 语义。"""

from __future__ import annotations

from sqlalchemy import func, select

from app.models.tracking import Tracking
from app.repositories.base import BaseRepository

METRIC_FIELDS = (
    "impress",
    "views",
    "likes",
    "comments",
    "bookmarks",
    "pending",
    "revenue_cents",
)


class TrackingRepository(BaseRepository[Tracking]):
    model = Tracking

    def find(self, date: str, article_id: str, platform: str) -> Tracking | None:
        stmt = select(Tracking).where(
            Tracking.date == date,
            Tracking.article_id == article_id,
            Tracking.platform == platform,
        )
        return self.session.scalar(stmt)

    def upsert(
        self,
        *,
        date: str,
        article_id: str,
        platform: str,
        title_used: str | None = None,
        **metrics,
    ) -> tuple[Tracking, bool]:
        unknown = set(metrics) - set(METRIC_FIELDS)
        if unknown:
            raise ValueError(f"未知追踪指标字段：{sorted(unknown)}")

        existing = self.find(date, article_id, platform)
        if existing is None:
            obj = Tracking(
                date=date,
                article_id=article_id,
                platform=platform,
                title_used=title_used,
                **metrics,
            )
            self.add(obj)
            return obj, True

        if title_used is not None:
            existing.title_used = title_used
        for key, value in metrics.items():
            setattr(existing, key, value)
        self.session.flush()
        return existing, False

    def list_by_article(self, article_id: str) -> list[Tracking]:
        stmt = (
            select(Tracking)
            .where(Tracking.article_id == article_id)
            .order_by(Tracking.date.desc(), Tracking.platform)
        )
        return list(self.session.scalars(stmt))

    def list(
        self,
        *,
        article_id: str | None = None,
        platform: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[Tracking]:
        stmt = select(Tracking)
        if article_id:
            stmt = stmt.where(Tracking.article_id == article_id)
        if platform:
            stmt = stmt.where(Tracking.platform == platform)
        if date_from:
            stmt = stmt.where(Tracking.date >= date_from)
        if date_to:
            stmt = stmt.where(Tracking.date <= date_to)
        stmt = (
            stmt.order_by(Tracking.date.desc(), Tracking.platform).limit(limit).offset(offset)
        )
        return list(self.session.scalars(stmt))

    def daily_series(self, *, limit_days: int = 30) -> list[dict]:
        """按日汇总，供看板趋势图。返回最近 limit_days 天，日期升序。"""
        stmt = (
            select(
                Tracking.date,
                func.sum(Tracking.views),
                func.sum(Tracking.likes),
                func.sum(Tracking.comments),
                func.sum(Tracking.bookmarks),
                func.sum(Tracking.revenue_cents),
            )
            .group_by(Tracking.date)
            .order_by(Tracking.date.desc())
            .limit(limit_days)
        )
        rows = [
            {
                "date": date,
                "views": int(views or 0),
                "likes": int(likes or 0),
                "comments": int(comments or 0),
                "bookmarks": int(bookmarks or 0),
                "revenue_cents": int(revenue or 0),
            }
            for date, views, likes, comments, bookmarks, revenue in self.session.execute(stmt)
        ]
        return list(reversed(rows))

    def platform_totals(self) -> dict[str, dict[str, int]]:
        """按平台汇总（复合索引 (platform, date) 支撑）。"""
        stmt = select(
            Tracking.platform,
            func.sum(Tracking.views),
            func.sum(Tracking.likes),
            func.sum(Tracking.comments),
            func.count(),
            func.sum(Tracking.impress),
            func.sum(Tracking.bookmarks),
            func.sum(Tracking.revenue_cents),
        ).group_by(Tracking.platform)
        return {
            platform: {
                "views": int(views or 0),
                "likes": int(likes or 0),
                "comments": int(comments or 0),
                "rows": int(rows or 0),
                "impress": int(impress or 0),
                "bookmarks": int(bookmarks or 0),
                "revenue_cents": int(revenue or 0),
            }
            for platform, views, likes, comments, rows, impress, bookmarks, revenue in (
                self.session.execute(stmt)
            )
        }
