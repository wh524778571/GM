"""发布相关异常。

设计原则：**发布链路上任何「不确定」都必须抛异常，不得返回 success=True。**
每个异常都自带 `code` 与 `to_dict()`，路由层原样透出给前端，前端据此
显示红色错误而不是绿色成功。
"""

from __future__ import annotations

from typing import Any


class PublishError(RuntimeError):
    """发布链路基类异常。"""

    code = "publish_error"
    http_status = 422

    def __init__(self, message: str, *, detail: Any = None) -> None:
        super().__init__(message)
        self.detail = detail

    def to_dict(self) -> dict:
        return {
            "error": type(self).__name__,
            "code": self.code,
            "message": str(self),
            "detail": self.detail,
        }


class ArticleNotFound(PublishError):
    code = "article_not_found"
    http_status = 404


class UnknownPlatform(PublishError):
    code = "unknown_platform"
    http_status = 422


class NothingToPublish(PublishError):
    """文章在该平台没有可发布的内容（没标题 / 没正文）。

    这是最容易演变成假成功的场景：内容压根没生成，却把状态点成「已发布」。
    """

    code = "nothing_to_publish"
    http_status = 422


class ConfirmationRequired(PublishError):
    """调用方没有显式确认「我真的已经在该平台发布了」。

    `confirmed` 不是 True 一律拒绝 —— 确认动作必须由人做出，
    不接受默认值、不接受省略。
    """

    code = "confirmation_required"
    http_status = 422


class InvalidPostedUrl(PublishError):
    code = "invalid_posted_url"
    http_status = 422


class FailureReasonRequired(PublishError):
    """登记发布失败时必须写明原因，禁止「失败了但不知道为什么」。"""

    code = "failure_reason_required"
    http_status = 422
