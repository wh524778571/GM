"""AIProvider 重试 / 指数退避 / 限流 / 失败路径单测（Epic 2.1）。

全程 **零网络**：所有用例都跑在 `MockProvider` 上，退避的 sleep 被替换成
记录器，因此既能断言等待曲线，又不会真的把测试拖慢。

重点守住三条红线：
    坑 3  失败绝不静默 —— 空响应、重试耗尽都必须抛异常，不得回假正文
    坑 3  非重试类错误（鉴权）不许白白重试消耗额度
    Epic 2.1  429 优先遵循服务端 Retry-After
"""

from __future__ import annotations

import pytest

from app.services.ai.errors import (
    AIAuthError,
    AIClientError,
    AIConfigError,
    AIRateLimitError,
    AIResponseError,
    AIServerError,
)
from app.services.ai.provider import (
    MockProvider,
    RetryPolicy,
    ZhipuProvider,
    extract_json_object,
)

POLICY = RetryPolicy(max_attempts=3, base_delay=1.0, factor=2.0, max_delay=30.0, jitter=0.0)


def _provider(script, *, policy: RetryPolicy = POLICY):
    """构造 MockProvider，并把 sleep 换成记录器（不真睡）。"""
    slept: list[float] = []
    provider = MockProvider(script, retry=policy, sleep=slept.append)
    return provider, slept


# ── 正常路径 ──────────────────────────────────────────────────
def test_success_without_retry():
    provider, slept = _provider("正文")
    assert provider.generate("人设", "选题") == "正文"
    assert slept == []
    snap = provider.telemetry.snapshot()
    assert (snap["calls"], snap["attempts"], snap["retries"], snap["failures"]) == (1, 1, 0, 0)


def test_prompt_passthrough_recorded():
    provider, _ = _provider("正文")
    provider.generate("人设", "选题", max_tokens=1234, temperature=0.5)
    assert provider.received[0] == {
        "system": "人设",
        "user": "选题",
        "max_tokens": 1234,
        "temperature": 0.5,
    }


# ── 429 限流：退避后成功 ──────────────────────────────────────
def test_rate_limit_retries_with_exponential_backoff_then_succeeds():
    script = [
        AIRateLimitError("429 #1", status_code=429),
        AIRateLimitError("429 #2", status_code=429),
        "第三次成功",
    ]
    provider, slept = _provider(script)

    assert provider.generate("人设", "选题") == "第三次成功"
    # base=1, factor=2 → 1s、2s；确实调用了 sleep，且曲线可断言
    assert slept == [1.0, 2.0]
    assert provider.backoff_history == [1.0, 2.0]
    snap = provider.telemetry.snapshot()
    assert (snap["attempts"], snap["retries"], snap["calls"], snap["failures"]) == (3, 2, 1, 0)


def test_backoff_is_capped_by_max_delay():
    policy = RetryPolicy(max_attempts=4, base_delay=10.0, factor=10.0, max_delay=15.0, jitter=0.0)
    script = [AIServerError("500", status_code=500)] * 3 + ["成功"]
    provider, slept = _provider(script, policy=policy)

    assert provider.generate("人设", "选题") == "成功"
    assert slept == [10.0, 15.0, 15.0]  # 100s、1000s 都被 max_delay 压到 15s


def test_retry_after_header_wins_over_exponential_curve():
    script = [AIRateLimitError("429", status_code=429, retry_after=7.0), "成功"]
    provider, slept = _provider(script)

    assert provider.generate("人设", "选题") == "成功"
    assert slept == [7.0]  # 不是指数曲线的 1.0，服务端指示优先


# ── 失败路径：绝不静默 ────────────────────────────────────────
def test_retries_exhausted_raises_last_error_not_fake_content():
    provider, slept = _provider([AIRateLimitError("持续限流", status_code=429)])

    with pytest.raises(AIRateLimitError) as exc_info:
        provider.generate("人设", "选题")

    exc = exc_info.value
    assert exc.attempts == 3                       # 用尽 max_attempts
    assert exc.retryable is True
    assert exc.to_dict()["status_code"] == 429     # 结构化错误可直接透出给 API
    assert slept == [1.0, 2.0]                     # 只退避了 attempts-1 次
    snap = provider.telemetry.snapshot()
    assert (snap["attempts"], snap["retries"], snap["failures"], snap["calls"]) == (3, 2, 1, 0)


def test_non_retryable_error_fails_fast():
    provider, slept = _provider([AIAuthError("密钥无效", status_code=401), "本不该被用到"])

    with pytest.raises(AIAuthError) as exc_info:
        provider.generate("人设", "选题")

    assert exc_info.value.attempts == 1
    assert slept == []                              # 鉴权失败重试无意义，不浪费配额
    assert provider.cursor == 1                     # 确实只发了一次
    assert provider.telemetry.snapshot()["failures"] == 1


def test_empty_model_output_is_a_failure():
    """旧实现会把空响应兜底成「# 标题\\n\\n> AI 未连接」当成功返回（坑 3）。"""
    provider, _ = _provider(["   \n  "])
    with pytest.raises(AIResponseError):
        provider.generate("人设", "选题")
    assert provider.telemetry.snapshot()["calls"] == 0


@pytest.mark.parametrize(
    ("system_prompt", "user_prompt"),
    [("", "选题"), ("   ", "选题"), ("人设", ""), ("人设", "  ")],
)
def test_empty_prompt_rejected_before_calling_model(system_prompt, user_prompt):
    provider, _ = _provider("不该被调用")
    with pytest.raises(AIConfigError):
        provider.generate(system_prompt, user_prompt)
    assert provider.received == []


# ── 智谱适配：状态码映射 & 密钥来源 ───────────────────────────
def test_zhipu_requires_api_key_from_env(monkeypatch):
    monkeypatch.setattr("app.core.settings.settings.zhipu_api_key", "")
    with pytest.raises(AIConfigError) as exc_info:
        ZhipuProvider()
    assert "ZHIPU_API_KEY" in str(exc_info.value)


@pytest.mark.parametrize(
    ("status", "expected", "retryable"),
    [
        (429, AIRateLimitError, True),
        (401, AIAuthError, False),
        (403, AIAuthError, False),
        (500, AIServerError, True),
        (503, AIServerError, True),
        (400, AIClientError, False),
    ],
)
def test_zhipu_status_mapping(status, expected, retryable):
    provider = ZhipuProvider(api_key="dummy-key-for-test")  # 纯本地，不发请求
    with pytest.raises(expected) as exc_info:
        provider._raise_for_status(status, {"Retry-After": "3"}, '{"error":"x"}')
    exc = exc_info.value
    assert exc.retryable is retryable
    if status == 429:
        assert exc.retry_after == 3.0


def test_zhipu_never_leaks_key_in_error_payload():
    provider = ZhipuProvider(api_key="super-secret-value")
    with pytest.raises(AIAuthError) as exc_info:
        provider._raise_for_status(401, {}, "unauthorized")
    assert "super-secret-value" not in str(exc_info.value.to_dict())


# ── JSON 抽取 ─────────────────────────────────────────────────
def test_extract_json_object_handles_fenced_and_prefixed_output():
    assert extract_json_object('```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json_object('好的，给你：{"a": "x"} 以上。') == {"a": "x"}


@pytest.mark.parametrize("raw", ["", "   ", "完全没有 JSON", "{坏掉的 json", "[1,2,3]"])
def test_extract_json_object_raises_instead_of_faking(raw):
    with pytest.raises(AIResponseError):
        extract_json_object(raw)
