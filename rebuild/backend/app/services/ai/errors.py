"""AI 层异常体系。

坑 3「静默成功」防护：
    旧实现 `_call_ai` 用裸 `except: return None`，上层再把 None 兜成
    `"# 标题\n\n> AI 未连接"` 当成正常文章返回 —— 调用方完全看不出这是一次失败。
    新实现**任何**失败都抛出本模块的异常，异常自带 `retryable` / `status_code` /
    `provider` / `attempts`，由路由层翻译成明确的 HTTP 错误码，绝不伪造成功。
"""

from __future__ import annotations


class AIProviderError(RuntimeError):
    """AI 调用失败的基类。retryable=True 表示可由退避重试挽救。"""

    retryable: bool = False

    def __init__(
        self,
        message: str,
        *,
        provider: str = "",
        status_code: int | None = None,
        attempts: int = 0,
        retry_after: float | None = None,
    ) -> None:
        super().__init__(message)
        self.provider = provider
        self.status_code = status_code
        self.attempts = attempts
        self.retry_after = retry_after

    def to_dict(self) -> dict:
        """结构化错误对象，供 API 层原样透出（不含任何密钥）。"""
        return {
            "error": type(self).__name__,
            "message": str(self),
            "provider": self.provider,
            "status_code": self.status_code,
            "attempts": self.attempts,
            "retryable": self.retryable,
            "retry_after": self.retry_after,
        }


class AIConfigError(AIProviderError):
    """密钥/模型等配置缺失。不可重试，必须让用户去配 .env。"""


class AIAuthError(AIProviderError):
    """401/403：密钥无效或无权限。不可重试。"""


class AIClientError(AIProviderError):
    """4xx（非 429）：请求本身有问题。不可重试。"""


class AIRateLimitError(AIProviderError):
    """429：触发限流。可重试，优先遵循 Retry-After。"""

    retryable = True


class AIServerError(AIProviderError):
    """5xx：服务端异常。可重试。"""

    retryable = True


class AITimeoutError(AIProviderError):
    """网络超时 / 连接失败。可重试。"""

    retryable = True


class AIResponseError(AIProviderError):
    """HTTP 200 但响应体不是预期结构。不可重试（重试也是同样的坏响应）。"""
