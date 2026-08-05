"""weekly_plan 表 —— 周计划看板（Phase 2 新增，刻意做薄）。

**为什么必须新建一张表（而不是从 articles 派生）**

设计稿《周计划》7 列里的任务大部分不是文章：
「盘点素材」「标题 A·B 测试」「数据复盘」「排期」都没有对应的 article 行；
「周五=沧元图专属日」这类归属信息也不属于任何一篇文章。
若强行从 articles + tracking 派生，就得把计划语义塞进 articles.status，
反而污染核心闭环表。故新增一张只有 8 个业务列的轻表，
`article_id` 可空——挂上文章即成为写作任务，不挂就是纯运营任务。

不加外键的理由：计划常常先于文章存在（周一就排好周五要写什么），
外键会强制「先建文章再排计划」，与真实工作顺序相反。
`article_id` 用普通索引 + 读取时 LEFT JOIN，取不到即视为尚未落稿。
"""

from __future__ import annotations

import enum
from datetime import date as date_type
from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.article import utcnow


class WeeklyTaskStatus(str, enum.Enum):
    PLANNED = "planned"    # 已排期
    DOING = "doing"        # 进行中
    DONE = "done"          # 已完成
    SKIPPED = "skipped"    # 本周跳过（显式记录，不假装完成）


class WeeklyPlanTask(Base):
    __tablename__ = "weekly_plan"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # 周一日期 YYYY-MM-DD，作为一周的唯一标识
    week_start: Mapped[date_type] = mapped_column(String(10), nullable=False)
    # 0=周一 … 6=周日（与设计稿 7 列一一对应）
    weekday: Mapped[int] = mapped_column(Integer, nullable=False)

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    # 可空：纯运营任务（盘点素材/数据复盘）没有文章
    article_id: Mapped[str | None] = mapped_column(String(200))
    # 可空：平台 key，仅当任务针对特定平台时填
    platform: Mapped[str | None] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=WeeklyTaskStatus.PLANNED.value
    )
    note: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    __table_args__ = (
        Index("ix_weekly_plan_week_start", "week_start"),
        Index("ix_weekly_plan_article_id", "article_id"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<WeeklyPlanTask {self.week_start}+{self.weekday} {self.title} {self.status}>"
