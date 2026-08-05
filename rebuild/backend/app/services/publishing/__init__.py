"""发布服务包（Phase 4 / Epic 4.1）：诚实的「待人工发布」闭环。

对外只暴露 `PublishService` 与异常类型；包内不存在任何自动发布实现，
也不存在任何把状态置为 published 的旁路（详见 service.py 顶部说明）。
"""

from app.services.publishing.errors import (
    ArticleNotFound,
    ConfirmationRequired,
    FailureReasonRequired,
    InvalidPostedUrl,
    NothingToPublish,
    PublishError,
    UnknownPlatform,
)
from app.services.publishing.service import (
    PENDING_LABEL,
    STATE_LABELS,
    ImageTask,
    PlatformStatus,
    PublishPacket,
    PublishService,
    markdown_to_copy_text,
)

__all__ = [
    "PENDING_LABEL",
    "STATE_LABELS",
    "ArticleNotFound",
    "ConfirmationRequired",
    "FailureReasonRequired",
    "ImageTask",
    "InvalidPostedUrl",
    "NothingToPublish",
    "PlatformStatus",
    "PublishError",
    "PublishPacket",
    "PublishService",
    "UnknownPlatform",
    "markdown_to_copy_text",
]
