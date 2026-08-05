"""Provider 工厂：按名字/配置构造 Provider。

刻意**不做**「密钥缺失就悄悄退化成 mock」这种事——那正是坑 3。
未配置密钥时 `build_provider("zhipu")` 会抛 `AIConfigError`，
调用方（API 层）必须把它翻译成明确的 503，让用户看到真实状态。
想用假数据必须显式传 `name="mock"`。
"""

from __future__ import annotations

from app.core.settings import settings
from app.services.ai.errors import AIConfigError
from app.services.ai.provider import AIProvider, MockProvider, RetryPolicy, ZhipuProvider

MOCK_NOTICE = "mock provider：返回固定假文本，仅用于离线联调/测试，产物不可发布"


def default_retry_policy() -> RetryPolicy:
    return RetryPolicy(
        max_attempts=settings.ai_max_attempts,
        base_delay=settings.ai_base_delay_seconds,
        factor=2.0,
        max_delay=30.0,
        jitter=0.25,  # 生产带抖动，避免同刻重试撞在一起；单测里显式关掉
    )


def build_provider(name: str | None = None, **kwargs) -> AIProvider:
    """name 缺省取 settings.ai_provider（环境变量 AI_PROVIDER）。"""
    key = (name or settings.ai_provider or "zhipu").strip().lower()
    if key == "zhipu":
        return ZhipuProvider(retry=default_retry_policy(), **kwargs)
    if key == "mock":
        return MockProvider(retry=default_retry_policy(), **kwargs)
    raise AIConfigError(f"未知 AI provider：{key!r}，可选：zhipu / mock", provider=key)
