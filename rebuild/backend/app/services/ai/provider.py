"""AIProvider 抽象 + 智谱适配 + 重试/退避/限流/成本埋点（Epic 2.1）。

设计要点
--------
1. **模板方法**：重试、退避、限流、埋点全部收敛在基类 `AIProvider.generate`，
   子类只实现一次「真正发一次请求」的 `_invoke`。因此 `MockProvider` 能在
   **零网络**条件下完整覆盖退避与失败路径的单测。
2. **绝不静默失败**：`_invoke` 失败一律抛 `errors.AIProviderError` 子类；
   重试耗尽后原样抛出最后一次异常（带 attempts），调用方必须显式处理。
3. **成本埋点**：`Telemetry` 累计调用数 / 重试数 / token 数 / 估算成本，
   `provider.telemetry.snapshot()` 可直接塞进 API 响应，便于观测真实开销。
4. **密钥**：只从 `settings.zhipu_api_key`（即环境变量 ZHIPU_API_KEY）读取，
   代码与仓库中不出现任何真实值；缺失时抛 `AIConfigError`。
"""

from __future__ import annotations

import json
import random
import re
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Callable, Iterable, Sequence

from app.core.settings import settings
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

# 智谱开放平台（来源：phase0-archive/prompts/gen_article_from_request.py）
ZHIPU_BASE_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
ZHIPU_MODEL = "glm-4-flash"


# ── 埋点 ─────────────────────────────────────────────────────
@dataclass
class Telemetry:
    """极简成本埋点。单位统一：token 数 + 估算成本（分）。

    glm-4-flash 目前免费，`cost_per_1k_tokens_cents` 默认 0.0；换付费模型时
    只需在构造 Provider 时传入真实单价，无需改调用方。
    """

    calls: int = 0
    attempts: int = 0
    retries: int = 0
    failures: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    latency_ms_total: float = 0.0
    cost_cents: float = 0.0

    def record_attempt(self) -> None:
        self.attempts += 1

    def record_retry(self) -> None:
        self.retries += 1

    def record_failure(self) -> None:
        self.failures += 1

    def record_success(self, usage: dict, latency_ms: float, cost_per_1k_cents: float) -> None:
        self.calls += 1
        prompt = int(usage.get("prompt_tokens") or 0)
        completion = int(usage.get("completion_tokens") or 0)
        total = int(usage.get("total_tokens") or (prompt + completion))
        self.prompt_tokens += prompt
        self.completion_tokens += completion
        self.total_tokens += total
        self.latency_ms_total += latency_ms
        self.cost_cents += total / 1000.0 * cost_per_1k_cents

    def snapshot(self) -> dict:
        return {
            "calls": self.calls,
            "attempts": self.attempts,
            "retries": self.retries,
            "failures": self.failures,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "latency_ms_total": round(self.latency_ms_total, 2),
            "cost_cents": round(self.cost_cents, 4),
        }


# ── 重试策略 ──────────────────────────────────────────────────
@dataclass(frozen=True)
class RetryPolicy:
    """指数退避。delay = min(base * factor**(n-1), max_delay) [+ jitter]。"""

    max_attempts: int = 3
    base_delay: float = 1.0
    factor: float = 2.0
    max_delay: float = 30.0
    jitter: float = 0.0  # 0 表示确定性退避（单测可精确断言）

    def delay_for(self, attempt: int, *, retry_after: float | None = None) -> float:
        """attempt 从 1 开始计。429 带 Retry-After 时以服务端指示为准。"""
        if retry_after is not None and retry_after >= 0:
            return min(retry_after, self.max_delay)
        delay = min(self.base_delay * (self.factor ** (attempt - 1)), self.max_delay)
        if self.jitter:
            delay += random.uniform(0, self.jitter)
        return delay


@dataclass
class RawCompletion:
    """一次成功调用的原始产物。"""

    text: str
    usage: dict = field(default_factory=dict)
    model: str = ""
    finish_reason: str | None = None


# ── 抽象基类 ──────────────────────────────────────────────────
class AIProvider(ABC):
    """所有 AI 供应商的统一接口。

    子类只需实现 `_invoke`（发一次请求、成功返回 RawCompletion、失败抛 AIProviderError）。
    """

    name: str = "base"
    cost_per_1k_tokens_cents: float = 0.0

    def __init__(
        self,
        *,
        retry: RetryPolicy | None = None,
        sleep: Callable[[float], None] = time.sleep,
        telemetry: Telemetry | None = None,
    ) -> None:
        self.retry = retry or RetryPolicy()
        self._sleep = sleep
        self.telemetry = telemetry or Telemetry()
        # 记录每次退避实际等待秒数，便于单测断言指数退避曲线
        self.backoff_history: list[float] = []

    # ── 对外主入口（模板方法，含重试/退避/埋点） ───────────────
    def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        max_tokens: int = 4096,
        temperature: float = 0.9,
    ) -> str:
        if not system_prompt.strip():
            raise AIConfigError("system_prompt 为空：账号人设不可缺失", provider=self.name)
        if not user_prompt.strip():
            raise AIConfigError("user_prompt 为空", provider=self.name)

        last_error: AIProviderError | None = None
        for attempt in range(1, self.retry.max_attempts + 1):
            self.telemetry.record_attempt()
            started = time.perf_counter()
            try:
                completion = self._invoke(
                    system_prompt,
                    user_prompt,
                    max_tokens=max_tokens,
                    temperature=temperature,
                )
            except AIProviderError as exc:
                exc.attempts = attempt
                last_error = exc
                if not exc.retryable or attempt >= self.retry.max_attempts:
                    self.telemetry.record_failure()
                    raise
                delay = self.retry.delay_for(attempt, retry_after=exc.retry_after)
                self.backoff_history.append(delay)
                self.telemetry.record_retry()
                self._sleep(delay)
                continue

            latency_ms = (time.perf_counter() - started) * 1000
            if not completion.text.strip():
                # 空内容视为失败，绝不回一段假正文（坑 3）
                self.telemetry.record_failure()
                raise AIResponseError(
                    "模型返回空内容", provider=self.name, attempts=attempt
                )
            self.telemetry.record_success(
                completion.usage, latency_ms, self.cost_per_1k_tokens_cents
            )
            return completion.text

        # 理论不可达：循环内要么 return 要么 raise
        raise last_error or AIProviderError("未知 AI 调用失败", provider=self.name)

    @abstractmethod
    def _invoke(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        max_tokens: int,
        temperature: float,
    ) -> RawCompletion:
        """发一次请求。成功返回 RawCompletion，失败抛 AIProviderError 子类。"""


# ── 智谱实现 ──────────────────────────────────────────────────
class ZhipuProvider(AIProvider):
    """智谱 GLM（默认 glm-4-flash）。密钥仅来自环境变量 ZHIPU_API_KEY。"""

    name = "zhipu"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
        timeout: float | None = None,
        retry: RetryPolicy | None = None,
        sleep: Callable[[float], None] = time.sleep,
        telemetry: Telemetry | None = None,
        cost_per_1k_tokens_cents: float | None = None,
    ) -> None:
        super().__init__(retry=retry, sleep=sleep, telemetry=telemetry)
        # 只从 settings 取（settings 只从 os.getenv 取），不接受任何硬编码默认值
        self.api_key = api_key or settings.zhipu_api_key
        if not self.api_key:
            raise AIConfigError(
                "缺少 ZHIPU_API_KEY：请在 rebuild/backend/.env 中配置后重启服务",
                provider=self.name,
            )
        # 模型/地址允许用环境变量覆盖，缺省即本模块常量（唯一字面量来源）
        self.model = model or settings.zhipu_model or ZHIPU_MODEL
        self.base_url = base_url or settings.zhipu_base_url or ZHIPU_BASE_URL
        self.timeout = timeout if timeout is not None else settings.ai_timeout_seconds
        if cost_per_1k_tokens_cents is not None:
            self.cost_per_1k_tokens_cents = cost_per_1k_tokens_cents

    def _invoke(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        max_tokens: int,
        temperature: float,
    ) -> RawCompletion:
        import httpx  # 局部导入：未配置 AI 时不强依赖

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        try:
            with httpx.Client(timeout=self.timeout) as client:
                response = client.post(self.base_url, json=payload, headers=headers)
        except httpx.TimeoutException as exc:
            raise AITimeoutError(f"智谱接口超时（{self.timeout}s）", provider=self.name) from exc
        except httpx.HTTPError as exc:
            raise AITimeoutError(f"智谱接口连接失败：{exc}", provider=self.name) from exc

        self._raise_for_status(response.status_code, response.headers, response.text)

        try:
            data = response.json()
            message = data["choices"][0]["message"]["content"]
        except Exception as exc:
            raise AIResponseError(
                f"智谱响应结构异常：{_truncate(response.text)}", provider=self.name
            ) from exc

        return RawCompletion(
            text=(message or "").strip(),
            usage=dict(data.get("usage") or {}),
            model=str(data.get("model") or self.model),
            finish_reason=(data.get("choices") or [{}])[0].get("finish_reason"),
        )

    def _raise_for_status(self, status: int, headers, body: str) -> None:
        if status < 400:
            return
        detail = _truncate(body)
        if status == 429:
            raise AIRateLimitError(
                f"智谱限流（429）：{detail}",
                provider=self.name,
                status_code=status,
                retry_after=_parse_retry_after(headers),
            )
        if status in (401, 403):
            raise AIAuthError(
                f"智谱鉴权失败（{status}）：请检查 ZHIPU_API_KEY",
                provider=self.name,
                status_code=status,
            )
        if status >= 500:
            raise AIServerError(
                f"智谱服务端错误（{status}）：{detail}", provider=self.name, status_code=status
            )
        raise AIClientError(
            f"智谱请求被拒（{status}）：{detail}", provider=self.name, status_code=status
        )


# ── 测试用假 Provider ─────────────────────────────────────────
class MockProvider(AIProvider):
    """离线可测的假 Provider。

    `script` 中的元素：
        str                → 本次调用成功，返回该文本
        AIProviderError    → 本次调用抛出该异常（用于覆盖 429 / 5xx / 鉴权失败）
    脚本耗尽后循环使用最后一个元素，方便「先 429 两次再成功」这类用例。
    """

    name = "mock"

    def __init__(
        self,
        script: Sequence[str | AIProviderError] | str | None = None,
        *,
        usage: dict | None = None,
        retry: RetryPolicy | None = None,
        sleep: Callable[[float], None] | None = None,
        telemetry: Telemetry | None = None,
    ) -> None:
        super().__init__(
            retry=retry or RetryPolicy(max_attempts=3, base_delay=1.0, jitter=0.0),
            sleep=sleep or (lambda _seconds: None),  # 单测默认不真的睡
            telemetry=telemetry,
        )
        if script is None:
            script = ["MOCK_EMPTY"]
        if isinstance(script, str):
            script = [script]
        self.script: list[str | AIProviderError] = list(script)
        self.usage = usage or {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        self.cursor = 0
        # 完整记录收到的 (system, user)，供「SYSTEM_PROMPT 是否被原样继承」断言
        self.received: list[dict] = []

    def _invoke(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        max_tokens: int,
        temperature: float,
    ) -> RawCompletion:
        self.received.append(
            {
                "system": system_prompt,
                "user": user_prompt,
                "max_tokens": max_tokens,
                "temperature": temperature,
            }
        )
        item = self.script[min(self.cursor, len(self.script) - 1)]
        self.cursor += 1
        if isinstance(item, AIProviderError):
            raise item
        return RawCompletion(text=item, usage=dict(self.usage), model="mock-1")


# ── 小工具 ────────────────────────────────────────────────────
def _truncate(text: str, limit: int = 300) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= limit else text[:limit] + "…"


def _parse_retry_after(headers: Iterable | None) -> float | None:
    if not headers:
        return None
    try:
        raw = headers.get("Retry-After")  # type: ignore[union-attr]
    except AttributeError:
        return None
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def extract_json_object(raw: str) -> dict:
    """从模型输出里抠出第一个完整 JSON 对象。

    复刻归档实现的容错（截取首个 `{` 到末个 `}`、剔除控制字符），
    但**解析失败时抛异常**而不是像旧代码那样兜底成一段假 Markdown。
    """
    if not raw or not raw.strip():
        raise AIResponseError("模型输出为空，无法解析 JSON")

    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    start = text.find("{")
    end = text.rfind("}") + 1
    if start < 0 or end <= start:
        raise AIResponseError(f"模型输出中找不到 JSON 对象：{_truncate(text)}")

    candidate = re.sub(r"[\x00-\x1f\x7f]", " ", text[start:end])
    try:
        data = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise AIResponseError(f"模型输出 JSON 解析失败：{exc}；原文：{_truncate(candidate)}") from exc
    if not isinstance(data, dict):
        raise AIResponseError("模型输出的 JSON 顶层不是对象")
    return data
