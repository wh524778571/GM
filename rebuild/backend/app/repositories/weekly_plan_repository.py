"""weekly_plan 仓储。"""

from __future__ import annotations

from sqlalchemy import select

from app.models.weekly_plan import WeeklyPlanTask
from app.repositories.base import BaseRepository

UPDATABLE_FIELDS = ("week_start", "weekday", "title", "article_id", "platform", "status", "note")


class WeeklyPlanRepository(BaseRepository[WeeklyPlanTask]):
    model = WeeklyPlanTask

    def list(
        self,
        *,
        week_start: str | None = None,
        status: str | None = None,
        article_id: str | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> list[WeeklyPlanTask]:
        stmt = select(WeeklyPlanTask)
        if week_start:
            stmt = stmt.where(WeeklyPlanTask.week_start == week_start)
        if status:
            stmt = stmt.where(WeeklyPlanTask.status == status)
        if article_id:
            stmt = stmt.where(WeeklyPlanTask.article_id == article_id)
        stmt = (
            stmt.order_by(
                WeeklyPlanTask.week_start.desc(),
                WeeklyPlanTask.weekday,
                WeeklyPlanTask.id,
            )
            .limit(limit)
            .offset(offset)
        )
        return list(self.session.scalars(stmt))

    def update(self, task: WeeklyPlanTask, **fields) -> WeeklyPlanTask:
        unknown = set(fields) - set(UPDATABLE_FIELDS)
        if unknown:
            raise ValueError(f"weekly_plan 不支持更新字段：{sorted(unknown)}")
        for key, value in fields.items():
            setattr(task, key, value)
        self.session.flush()
        return task
