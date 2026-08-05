"""publish_records 仓储（Phase 4）。

只提供「查」和「写入一条由人确认的记录」两类操作，不含任何批量置为
published 的便捷方法 —— 越少的写入口，越难出现假成功。
"""

from __future__ import annotations

from sqlalchemy import select

from app.models.publish_record import PublishRecord
from app.repositories.base import BaseRepository


class PublishRepository(BaseRepository[PublishRecord]):
    model = PublishRecord

    def get(self, article_id: str, platform: str) -> PublishRecord | None:  # type: ignore[override]
        stmt = select(PublishRecord).where(
            PublishRecord.article_id == article_id,
            PublishRecord.platform == platform,
        )
        return self.session.scalar(stmt)

    def list_for_article(self, article_id: str) -> list[PublishRecord]:
        stmt = select(PublishRecord).where(PublishRecord.article_id == article_id)
        return list(self.session.scalars(stmt))

    def upsert(self, article_id: str, platform: str, **fields) -> tuple[PublishRecord, bool]:
        """按 (article_id, platform) upsert。返回 (对象, 是否新建)。"""
        existing = self.get(article_id, platform)
        if existing is None:
            obj = PublishRecord(article_id=article_id, platform=platform, **fields)
            self.add(obj)
            return obj, True
        for key, value in fields.items():
            setattr(existing, key, value)
        self.session.flush()
        return existing, False
