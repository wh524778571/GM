"""四平台生成：SYSTEM_PROMPT 继承 + platforms.yaml 规则强制（Epic 2.2）。

M2 最大的风险是「AI 风格漂移」和「规则三处打架」。本文件用 mock 固定响应
把两件事钉死：

1. 送进模型的 system 参数**逐字**等于 `prompts.SYSTEM_PROMPT`（人设不丢、不被覆盖）；
2. 产物必须满足 `config/platforms.yaml`：四平台齐全、标题不超限、
   小红书 0 个配图占位符。

外加失败路径：解析不出 JSON / 缺平台，一律抛 `GenerationError`，
绝不返回一篇「看起来正常」的假文章（坑 3）。
"""

from __future__ import annotations

import json

import pytest

from app.core.platform_rules import load_registry
from app.services import qa
from app.services.ai.generation import GenerationError, GenerationService
from app.services.ai.prompts import (
    PROMPTS_BASE,
    SYSTEM_PROMPT,
    build_user_prompt,
    system_prompt_fingerprint,
)
from app.services.ai.provider import MockProvider

REGISTRY = load_registry()
PLATFORMS = tuple(REGISTRY.keys())

# 26 字，超出小红书 20 字上限 → 必须被截断后仍合规
TOPIC = "《凡人修仙传》韩立破境这一集：五个细节二刷才发现"


def _fixture_payload() -> dict:
    """模拟模型输出：故意给小红书塞了 2 个配图占位符，看服务是否强制剔除。"""
    body = (
        "## 开场钩子\n这一集我是真的坐直了，分镜、配乐、节奏全在线。\n\n"
        "【配图1：凡人修仙传_韩立破境场景】\n\n"
        "## 细节拆解\n**元婴初成**那段，画面里藏了三处呼应前作的伏笔。\n\n"
        "【配图2：凡人修仙传_元婴特写】\n\n"
        "## 我的看法\n这波制作组是真的下功夫了，你们二刷发现了吗？\n"
    )
    return {
        "core": "核心解析：韩立破境这一集的分镜与伏笔梳理。",
        "toutiao": body,
        "baijia": body + "\n从播放数据看，这一集的完播率明显高于上一集。\n",
        "bilibili": body + "\n所以问题来了：这波是燃还是水？评论区聊聊。\n",
        "xhs": (
            "韩立破境这一集\n·\n真的坐直了\n·\n"
            "【配图1：凡人修仙传_韩立破境场景】\n"
            "分镜配乐节奏全在线\n·\n"
            "【配图2：凡人修仙传_元婴特写】\n"
            "你们二刷发现了吗\n"
        ),
    }


def _provider(payload: dict | str | None = None) -> MockProvider:
    raw = payload if isinstance(payload, str) else json.dumps(
        payload if payload is not None else _fixture_payload(), ensure_ascii=False
    )
    return MockProvider(raw)


# ── 1. 人设继承 ───────────────────────────────────────────────
def test_system_prompt_is_passed_verbatim():
    provider = _provider()
    GenerationService(provider).generate(TOPIC, render=False, match_images=False)

    assert len(provider.received) == 1
    sent = provider.received[0]
    # 逐字相等：没有被包装、拼接、截断或"润色"
    assert sent["system"] == SYSTEM_PROMPT
    # user prompt 走归档模板，主题被正确注入
    assert sent["user"] == build_user_prompt(TOPIC, "depth", "")
    assert TOPIC in sent["user"]
    assert "输出JSON" in PROMPTS_BASE["depth"]


def test_result_carries_system_prompt_fingerprint():
    result = GenerationService(_provider()).generate(TOPIC, render=False, match_images=False)
    assert result.system_prompt_fingerprint == system_prompt_fingerprint()
    assert len(result.system_prompt_fingerprint) == 12


def test_generation_service_has_no_system_override_hook():
    """结构性保证：generate() 不提供 system 参数，漂移无从下手。"""
    import inspect

    params = inspect.signature(GenerationService.generate).parameters
    assert "system" not in params and "system_prompt" not in params


# ── 2. JSON 解析出四平台 ──────────────────────────────────────
def test_output_parses_into_four_platforms():
    result = GenerationService(_provider()).generate(TOPIC, render=False, match_images=False)

    assert tuple(result.contents.keys()) == PLATFORMS
    assert len(PLATFORMS) == 4
    assert all(result.contents[p].strip() for p in PLATFORMS)
    assert result.core.startswith("核心解析")


# ── 3. platforms.yaml 规则强制 ────────────────────────────────
def test_titles_within_platform_limits():
    result = GenerationService(_provider()).generate(TOPIC, render=False, match_images=False)

    for platform in PLATFORMS:
        rule = REGISTRY.get(platform)
        title = result.titles[platform]
        assert title, f"{platform} 缺标题"
        assert len(title) <= rule.title.max_chars, (
            f"{rule.name} 标题 {len(title)} 字 > 上限 {rule.title.max_chars}"
        )
    # 超限截断必须如实登记，不能悄悄改标题
    assert any("小红书" in note for note in result.enforcements)
    assert not qa.validate_titles(result.titles, REGISTRY).errors


def test_xhs_has_zero_image_placeholders():
    result = GenerationService(_provider()).generate(TOPIC, render=False, match_images=False)

    assert qa.find_placeholders(result.contents["xhs"], REGISTRY) == []
    assert "【配图" not in result.contents["xhs"]
    assert any("小红书" in note and "剔除 2 个" in note for note in result.enforcements)
    # 其他平台的配图必须原样保留，不能被误伤
    for platform in ("toutiao", "baijia", "bilibili"):
        assert len(qa.find_placeholders(result.contents[platform], REGISTRY)) == 2


def test_quality_check_passes_without_errors():
    result = GenerationService(_provider()).generate(TOPIC, render=False, match_images=False)
    assert result.ok, result.qa_report.to_lines()
    assert not result.qa_report.errors
    # 没匹配到素材要如实报 warning，而不是假装配好了
    assert any(i.code == "image_source_empty" for i in result.qa_report.warnings)


# ── 4. 复用 rendering / image_matching ────────────────────────
def test_renders_four_platform_previews():
    result = GenerationService(_provider()).generate(TOPIC, render=True, match_images=False)

    assert tuple(result.renders.keys()) == PLATFORMS
    for platform in PLATFORMS:
        assert result.renders[platform].html.strip()
    assert result.renders["xhs"].image_count == 0


def test_image_suggestions_report_unmatched_honestly(session):
    """素材库为空时，建议必须显式标 matched=False，来源留空。"""
    result = GenerationService(_provider(), session).generate(
        TOPIC, article_id="TEST-001", render=False, match_images=True
    )

    assert len(result.image_suggestions) == 2
    assert all(s.matched is False for s in result.image_suggestions)
    assert all(s.reason == "素材库无匹配" for s in result.image_suggestions)
    assert set(result.image_sources.values()) == {""}


# ── 5. 失败路径：绝不返回假文章 ───────────────────────────────
def test_unparseable_output_raises():
    with pytest.raises(GenerationError) as exc_info:
        GenerationService(_provider("对不起，我今天不太想写。")).generate(TOPIC, render=False)
    assert exc_info.value.stage == "parse"


def test_missing_platform_raises():
    payload = _fixture_payload()
    payload.pop("bilibili")
    with pytest.raises(GenerationError) as exc_info:
        GenerationService(_provider(payload)).generate(TOPIC, render=False)
    assert exc_info.value.stage == "parse"
    assert "bilibili" in str(exc_info.value)


def test_blank_platform_content_raises():
    payload = _fixture_payload()
    payload["xhs"] = "   "
    with pytest.raises(GenerationError):
        GenerationService(_provider(payload)).generate(TOPIC, render=False)


@pytest.mark.parametrize("article_type", ["weitoutiao", "unknown"])
def test_non_json_article_type_rejected(article_type):
    with pytest.raises(GenerationError) as exc_info:
        GenerationService(_provider()).generate(TOPIC, article_type=article_type, render=False)
    assert exc_info.value.stage == "input"


def test_empty_topic_rejected():
    with pytest.raises(GenerationError):
        GenerationService(_provider()).generate("   ", render=False)
