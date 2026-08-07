"""topic_recommendations 仓储。"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select

from app.models.topic_recommendation import TopicRecommendation
from app.repositories.base import BaseRepository


class TopicRepository(BaseRepository[TopicRecommendation]):
    model = TopicRecommendation

    def list_today(self, today: str) -> list[TopicRecommendation]:
        """今日推荐（已过滤黑名单），按 id 倒序（最新在前）。"""
        stmt = (
            select(TopicRecommendation)
            .where(
                TopicRecommendation.date == today,
                TopicRecommendation.blacklisted.is_(False),
            )
            .order_by(TopicRecommendation.id.desc())
        )
        return list(self.session.scalars(stmt))

    def list_recent(self, days: int) -> list[TopicRecommendation]:
        """近 N 天推荐过的选题（含今日），用于去重「今日推了明天尽量不推」。"""
        cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
        stmt = select(TopicRecommendation).where(TopicRecommendation.date >= cutoff)
        return list(self.session.scalars(stmt))

    def list_blacklisted(self) -> list[TopicRecommendation]:
        stmt = select(TopicRecommendation).where(TopicRecommendation.blacklisted.is_(True))
        return list(self.session.scalars(stmt))

    def get_by_key(self, key: str) -> TopicRecommendation | None:
        stmt = select(TopicRecommendation).where(TopicRecommendation.topic_key == key)
        return self.session.scalar(stmt)

    def get(self, pk: int) -> TopicRecommendation | None:
        return self.session.get(TopicRecommendation, pk)

    def set_blacklist(self, pk: int, value: bool) -> TopicRecommendation | None:
        obj = self.get(pk)
        if obj is None:
            return None
        obj.blacklisted = value
        self.session.flush()
        return obj
