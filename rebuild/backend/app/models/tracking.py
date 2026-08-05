"""tracking 表 —— 平台数据追踪（旧库 tracking_data，121 条历史基线）。

相对旧表的改进（Epic 1.1）：
    1. article 由裸文本改为 **外键** → articles.article_id（ON DELETE CASCADE）
    2. 新增复合索引 (platform, date)
    3. 保留 upsert 语义：UNIQUE(date, article_id, platform)
"""

from __future__ import annotations

from datetime import date as date_type
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.article import utcnow


class Tracking(Base):
    __tablename__ = "tracking"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    date: Mapped[date_type] = mapped_column(String(10), nullable=False)  # YYYY-MM-DD
    article_id: Mapped[str] = mapped_column(
        String(200),
        ForeignKey("articles.article_id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
    )
    # 平台 key（toutiao/baijia/bilibili/xhs），中文名由 platforms.yaml tracking_aliases 归一
    platform: Mapped[str] = mapped_column(String(20), nullable=False)
    # 该条数据实际使用的标题（旧库 title_used）
    title_used: Mapped[str | None] = mapped_column(String(300))

    impress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    views: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    likes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    comments: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    bookmarks: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    pending: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Phase 2 新增：当日该平台实收收益，单位「分」。
    # 用整数分而非浮点元，避免看板求和出现 0.1+0.2 这类精度漂移。
    # 旧库没有这一列，历史 121 条追踪迁入后一律为 0（= 未登记，不等于没收益）。
    revenue_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    article: Mapped["Article"] = relationship(back_populates="tracking_rows")  # noqa: F821

    __table_args__ = (
        UniqueConstraint("date", "article_id", "platform", name="uq_tracking_date_article_platform"),
        Index("ix_tracking_platform_date", "platform", "date"),
        Index("ix_tracking_article_id", "article_id"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Tracking {self.date} {self.article_id}/{self.platform} views={self.views}>"
