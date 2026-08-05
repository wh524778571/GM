"""publish_records 表 —— 逐平台「人工发布」确认台账（Phase 4 / Epic 4.1）。

**存在的唯一理由是防「发布假成功」（坑 3，全项目最高风险）。**

旧系统 `publisher.py` 是一堆 TODO 桩函数，却统一 `return {"success": True}`：
没有登录、没有提交、没有任何证据，界面照样显示「已发布」。本表把「是否真的
发过」变成一条**必须由人显式写入**的记录：

    · 没有行            → pending（待人工发布），这是默认且唯一的初始态
    · state=published   → 只可能来自 PublishService.confirm_publish()，
                          且调用方必须显式 confirmed=True，还会记下确认人/时间/链接
    · state=failed      → 发布失败也要留痕，不允许「悄悄什么都没发生」

系统内**不存在**任何自动把 state 写成 published 的代码路径（见
`app/services/publishing/service.py` 顶部说明与 tests/test_publish.py）。
"""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.article import utcnow


class PublishState(str, enum.Enum):
    PENDING = "pending"      # 待人工发布（默认；没有记录行也视为本态）
    PUBLISHED = "published"  # 人工确认已发布（唯一入口 confirm_publish）
    FAILED = "failed"        # 人工登记发布失败（必须带原因）


class PublishRecord(Base):
    __tablename__ = "publish_records"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    article_id: Mapped[str] = mapped_column(
        String(200),
        ForeignKey("articles.article_id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
    )
    # 平台 key（toutiao/baijia/bilibili/xhs），由 platforms.yaml 归一
    platform: Mapped[str] = mapped_column(String(20), nullable=False)
    state: Mapped[str] = mapped_column(String(20), nullable=False, default=PublishState.PENDING.value)

    # 发布证据：平台上的文章链接。可为空（部分平台后台不给稳定链接），
    # 但为空不影响「必须有人确认」这一硬约束。
    posted_url: Mapped[str | None] = mapped_column(String(500))
    # 谁确认的（人工署名）。默认 "human"，留给多人协作时区分责任人。
    confirmed_by: Mapped[str | None] = mapped_column(String(100))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # failed 时必填的失败原因；pending/published 时可作备注
    note: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    __table_args__ = (
        UniqueConstraint("article_id", "platform", name="uq_publish_article_platform"),
        Index("ix_publish_records_article_id", "article_id"),
        Index("ix_publish_records_state", "state"),
    )

    def __repr__(self) -> str:  # pragma: no cover - 调试用
        return f"<PublishRecord {self.article_id}/{self.platform} state={self.state}>"
