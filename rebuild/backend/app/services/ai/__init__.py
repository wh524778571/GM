"""AI 层：Provider 抽象 + 账号人设 Prompt + 四平台生成服务。

对外只暴露稳定入口，业务代码不要直接 import 内部模块细节。
"""

from app.services.ai.errors import (
    AIAuthError,
    AIClientError,
    AIConfigError,
    AIProviderError,
    AIRateLimitError,
    AIResponseError,
    AIServerError,
    AITimeoutError,
)
from app.services.ai.factory import build_provider
from app.services.ai.generation import (
    GenerationError,
    GenerationResult,
    GenerationService,
)
from app.services.ai.prompts import (
    ARTICLE_TYPES,
    PROMPTS_BASE,
    SYSTEM_PROMPT,
    build_user_prompt,
    system_prompt_fingerprint,
)
from app.services.ai.provider import (
    AIProvider,
    MockProvider,
    RawCompletion,
    RetryPolicy,
    Telemetry,
    ZhipuProvider,
)

__all__ = [
    "AIAuthError",
    "AIClientError",
    "AIConfigError",
    "AIProvider",
    "AIProviderError",
    "AIRateLimitError",
    "AIResponseError",
    "AIServerError",
    "AITimeoutError",
    "ARTICLE_TYPES",
    "GenerationError",
    "GenerationResult",
    "GenerationService",
    "MockProvider",
    "PROMPTS_BASE",
    "RawCompletion",
    "RetryPolicy",
    "SYSTEM_PROMPT",
    "Telemetry",
    "ZhipuProvider",
    "build_provider",
    "build_user_prompt",
    "system_prompt_fingerprint",
]
