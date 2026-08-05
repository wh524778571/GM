"""articles 表 —— 四平台 content 真相源。

schema 参考自归档库 `phase0-archive/db/articles.db`（只读勘察，未导入数据）：
    旧列 titles_json / original_json / image_sources_json / publish_schedule_json
    在新表中改为 JSON 类型列，语义不变但不再需要业务侧手工 json.loads。
"""

from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ArticleStatus(str, enum.Enum):
    DRAFT = "draft"          # 草稿
    PENDING = "pending"      # 待发布
    PUBLISHED = "published"  # 已发布
    FAILED = "failed"        # 发布失败（绝不允许静默成功 → 必须显式落 failed）
    DELETED = "deleted"      # 软删除


class Article(Base):
    __tablename__ = "articles"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # 业务唯一键（旧库同名列），如 "沧元图动画小说对比"
    article_id: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=ArticleStatus.DRAFT.value)
    folder_name: Mapped[str | None] = mapped_column(String(200))

    # 核心 Markdown（未分平台）
    content_text: Mapped[str | None] = mapped_column(Text)
    # 四平台标题 {"toutiao": "...", "baijia": "...", "bilibili": "...", "xhs": "..."}
    titles: Mapped[dict | None] = mapped_column(JSON)
    # 四平台正文真相源（旧库 original_json）
    contents: Mapped[dict | None] = mapped_column(JSON)
    # 配图占位符 → 素材来源 {"【配图1：xxx】": "第N集/时间戳"}
    image_sources: Mapped[dict | None] = mapped_column(JSON)
    # 排期 {"toutiao": "2026-08-05 09:00", ...}
    publish_schedule: Mapped[dict | None] = mapped_column(JSON)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    tracking_rows: Mapped[list["Tracking"]] = relationship(  # noqa: F821
        back_populates="article",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        Index("ix_articles_updated_at", "updated_at"),
        Index("ix_articles_status", "status"),
        Index("ix_articles_title", "title"),
    )

    def __repr__(self) -> str:  # pragma: no cover - 调试用
        return f"<Article {self.article_id} status={self.status}>"
