"""topic_recommendations 表 —— 今日推荐选题（国漫自媒体选题池）。

设计要点：
- `topic_key`：选题归一化去重键（unique），用于「今日推了明天尽量不推」与黑名单。
- `date`：推荐当日 YYYY-MM-DD；生成时只推荐近 2 天未出现、且未拉黑的选题。
- `blacklisted`：用户点「不再推荐」即置 True，永久不推。
- `recommend_count`：历史累计推荐次数，便于后续做多样性权重。
- 与 articles 解耦：点选题写文章时才落 articles 表（见 topic_service.write_topic_article）。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.article import utcnow


class TopicRecommendation(Base):
    __tablename__ = "topic_recommendations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # 归一化去重键（标题去标点小写），unique 防止同选题重复入库
    topic_key: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    # 推荐当日 YYYY-MM-DD
    date: Mapped[str] = mapped_column(String(10), nullable=False)

    title: Mapped[str] = mapped_column(String(300), nullable=False)
    # 一线资讯 / 小众剧情 / 趣事 / 人物生日 / 大事记 / 常青候选
    topic_type: Mapped[str] = mapped_column(String(20), nullable=False, default="常青候选")
    # 一句话钩子
    summary: Mapped[str] = mapped_column(Text, default="")
    # 为什么现在值得写
    angle: Mapped[str] = mapped_column(Text, default="")
    # 写文章时用的类型：depth / info
    article_type: Mapped[str] = mapped_column(String(20), nullable=False, default="depth")

    # 用户「不再推荐」→ True，永久不推
    blacklisted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 历史累计推荐次数
    recommend_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    __table_args__ = (
        Index("ix_topic_recommendations_date", "date"),
        Index("ix_topic_recommendations_blacklisted", "blacklisted"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<TopicRecommendation {self.id} {self.topic_type} {self.title!r}>"
