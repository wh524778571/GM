"""人工发布闭环（Phase 4 / Epic 4.1 · M4）—— 反「发布假成功」回归测试。

审计头号风险是旧 `publisher.py` 的 `return {"success": True}`：没发也说发了。
本文件把「不可能假成功」变成可执行的断言：

    1. 四平台发布包能组装（内容 + 步骤 + 配图清单 + xhs 纯文字无图）
    2. 组装发布包 **不会** 改变任何状态 —— 看过 ≠ 发过
    3. 人工确认前，全部平台恒为 pending（待人工发布）
    4. confirm 只翻转被确认的那一个平台，其余三个仍是 pending
    5. 缺字段 / 未显式确认 / 没内容 / 链接非法 → 一律显式报错，
       且状态**保持 pending**（关键：失败后不能留下半个「已发布」）
    6. 四平台全部确认后，文章级状态才升为 published
    7. 全工程只有 confirm_publish 一处能写出 published（源码级断言）
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.platform_rules import load_registry
from app.db.base import get_session
from app.main import app
from app.models.article import Article, ArticleStatus
from app.models.publish_record import PublishState
from app.repositories.article_repository import ArticleRepository
from app.services.publishing import (
    ArticleNotFound,
    ConfirmationRequired,
    FailureReasonRequired,
    InvalidPostedUrl,
    NothingToPublish,
    PublishService,
    UnknownPlatform,
)

REGISTRY = load_registry()
PLATFORMS = tuple(REGISTRY.keys())
ARTICLE_ID = "TEST-PUBLISH-001"

_BODY = (
    "## 开场\n这一集的分镜是真的顶，节奏一点没拖。\n\n"
    "【配图1：凡人修仙传_韩立破境场景】\n\n"
    "## 细节\n**元婴初成**那段藏了三处伏笔。\n\n"
    "【配图2：凡人修仙传_元婴特写】\n\n"
    "## 收尾\n你们二刷发现了吗？\n"
)
_XHS_BODY = "韩立破境这一集\n·\n真的坐直了\n·\n分镜配乐节奏全在线\n·\n你们二刷发现了吗\n"

TITLES = {
    "toutiao": "凡人修仙传韩立破境：五个细节二刷才发现",
    "baijia": "凡人修仙传第 177 集深度拆解：韩立破境背后的三处伏笔与制作升级",
    "bilibili": "韩立破境这一集，是燃还是水？五个细节聊聊",
    "xhs": "韩立破境这一集",
}
CONTENTS = {"toutiao": _BODY, "baijia": _BODY, "bilibili": _BODY, "xhs": _XHS_BODY}
IMAGE_SOURCES = {
    "【配图1：凡人修仙传_韩立破境场景】": "第177集/12分00秒",
    "【配图2：凡人修仙传_元婴特写】": "第177集/13分00秒",
}


# ── 夹具 ──────────────────────────────────────────────────────
@pytest.fixture()
def article(session) -> Article:
    return ArticleRepository(session).add(
        Article(
            article_id=ARTICLE_ID,
            title=TITLES["toutiao"],
            status=ArticleStatus.DRAFT.value,
            content_text=_BODY,
            titles=dict(TITLES),
            contents=dict(CONTENTS),
            image_sources=dict(IMAGE_SOURCES),
        )
    )


@pytest.fixture()
def service(session) -> PublishService:
    return PublishService(session)


@pytest.fixture()
def client(session):
    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ── 1. 发布包 ─────────────────────────────────────────────────
def test_build_packets_covers_four_platforms(service, article):
    packets = service.build_packets(ARTICLE_ID, match_images=False)

    assert [p.platform for p in packets] == list(PLATFORMS)
    for packet in packets:
        rule = REGISTRY.get(packet.platform)
        assert packet.platform_name == rule.name
        assert packet.title == TITLES[packet.platform]
        assert packet.copy_text.strip(), f"{packet.platform} 复制文本不能为空"
        assert packet.manual_steps, f"{packet.platform} 必须给出人工步骤"
        # 步骤里必须出现平台后台地址，人才知道去哪发
        assert any(rule.publish["mp_url"] in s for s in packet.manual_steps)
        assert packet.console_url == rule.publish["mp_url"]


def test_packet_copy_text_is_paste_ready(service, article):
    packets = {p.platform: p for p in service.build_packets(ARTICLE_ID, match_images=False)}
    toutiao = packets["toutiao"]
    # Markdown 语法符号已去掉，正文字仍在
    assert "##" not in toutiao.copy_text
    assert "**" not in toutiao.copy_text
    assert "开场" in toutiao.copy_text and "元婴初成" in toutiao.copy_text
    # 配图占位符保留，作为「这里要插图」的人工锚点
    assert "【配图1：凡人修仙传_韩立破境场景】" in toutiao.copy_text


def test_xhs_packet_is_text_only(service, article):
    xhs = next(p for p in service.build_packets(ARTICLE_ID, match_images=False) if p.platform == "xhs")
    assert xhs.images_allowed is False
    assert xhs.image_tasks == []
    assert "【配图" not in xhs.copy_text
    assert "<img" not in xhs.html
    assert any("纯文字无图" in w for w in xhs.warnings)
    assert xhs.body_char_count <= REGISTRY.get("xhs").body.max_chars


def test_packet_lists_images_to_upload_manually(service, article):
    toutiao = next(
        p for p in service.build_packets(ARTICLE_ID, match_images=False) if p.platform == "toutiao"
    )
    assert [t.index for t in toutiao.image_tasks] == [1, 2]
    # 空素材库 → 一张都没匹配上，必须如实标 matched=False（不谎报已备好）
    assert all(t.matched is False for t in toutiao.image_tasks)
    assert all(t.suggested_filename for t in toutiao.image_tasks)


def test_building_packets_never_marks_published(service, article):
    """看发布包 ≠ 发过。组装是纯读操作。"""
    service.build_packets(ARTICLE_ID, match_images=False)
    service.build_packets(ARTICLE_ID, match_images=False)

    status = service.status(ARTICLE_ID)
    assert status["published_count"] == 0
    assert status["all_published"] is False
    assert all(p["state"] == PublishState.PENDING.value for p in status["platforms"].values())
    assert article.status == ArticleStatus.DRAFT.value


# ── 2. 确认前一律 pending ─────────────────────────────────────
def test_status_is_pending_before_any_confirm(service, article):
    status = service.status(ARTICLE_ID)
    assert status["pending_count"] == len(PLATFORMS)
    assert status["pending_label"] == "待人工发布"
    for key in PLATFORMS:
        assert status["platforms"][key]["state"] == PublishState.PENDING.value
        assert status["platforms"][key]["state_label"] == "待人工发布"
        assert status["platforms"][key]["confirmed_at"] is None


# ── 3. 确认只翻转被确认的那个平台 ─────────────────────────────
def test_confirm_flips_only_that_platform(service, article):
    result = service.confirm_publish(
        ARTICLE_ID, "toutiao", "https://www.toutiao.com/article/123", confirmed=True
    )
    assert result.state == PublishState.PUBLISHED.value
    assert result.posted_url == "https://www.toutiao.com/article/123"
    assert result.confirmed_at is not None

    status = service.status(ARTICLE_ID)
    assert status["published_count"] == 1
    assert status["platforms"]["toutiao"]["state"] == PublishState.PUBLISHED.value
    for other in ("baijia", "bilibili", "xhs"):
        assert status["platforms"][other]["state"] == PublishState.PENDING.value

    # 只发了 1/4，文章级状态仍是「待发布」，不许提前算已发布
    assert status["all_published"] is False
    assert article.status == ArticleStatus.PENDING.value


def test_article_published_only_after_all_four_confirmed(service, article):
    for key in PLATFORMS[:-1]:
        service.confirm_publish(ARTICLE_ID, key, confirmed=True)
        assert article.status == ArticleStatus.PENDING.value

    service.confirm_publish(ARTICLE_ID, PLATFORMS[-1], confirmed=True)
    status = service.status(ARTICLE_ID)
    assert status["all_published"] is True
    assert status["published_count"] == len(PLATFORMS)
    assert article.status == ArticleStatus.PUBLISHED.value


def test_confirm_accepts_chinese_platform_alias(service, article):
    service.confirm_publish(ARTICLE_ID, "今日头条", confirmed=True)
    assert service.status(ARTICLE_ID)["platforms"]["toutiao"]["state"] == PublishState.PUBLISHED.value


# ── 4. 缺字段一律显式失败，绝不静默成功 ───────────────────────
def test_confirm_without_explicit_confirmation_fails_loudly(service, article):
    with pytest.raises(ConfirmationRequired) as exc:
        service.confirm_publish(ARTICLE_ID, "toutiao")  # confirmed 默认 False

    assert "待人工发布" in str(exc.value)
    # 关键：失败后状态没有被偷偷改动
    assert service.status(ARTICLE_ID)["platforms"]["toutiao"]["state"] == PublishState.PENDING.value


def test_confirm_with_confirmed_false_fails_loudly(service, article):
    with pytest.raises(ConfirmationRequired):
        service.confirm_publish(ARTICLE_ID, "toutiao", confirmed=False)
    assert service.status(ARTICLE_ID)["published_count"] == 0


@pytest.mark.parametrize("platform", ["", "   ", None])
def test_confirm_without_platform_fails_loudly(service, article, platform):
    with pytest.raises(UnknownPlatform):
        service.confirm_publish(ARTICLE_ID, platform, confirmed=True)
    assert service.status(ARTICLE_ID)["published_count"] == 0


def test_confirm_unknown_platform_fails_loudly(service, article):
    with pytest.raises(UnknownPlatform):
        service.confirm_publish(ARTICLE_ID, "wechat", confirmed=True)


def test_confirm_missing_article_fails_loudly(service):
    with pytest.raises(ArticleNotFound):
        service.confirm_publish("NOT-EXIST", "toutiao", confirmed=True)


def test_confirm_without_content_fails_loudly(session):
    """内容都没有却确认已发布 —— 这正是假成功的典型形态，必须拒绝。"""
    ArticleRepository(session).add(
        Article(article_id="EMPTY-001", title="空壳", status=ArticleStatus.DRAFT.value)
    )
    service = PublishService(session)

    with pytest.raises(NothingToPublish):
        service.confirm_publish("EMPTY-001", "toutiao", confirmed=True)
    assert service.status("EMPTY-001")["published_count"] == 0

    # 连发布包都建不出来（没有任何平台正文）
    with pytest.raises(NothingToPublish):
        service.build_packets("EMPTY-001", match_images=False)


def test_confirm_with_invalid_url_fails_loudly(service, article):
    with pytest.raises(InvalidPostedUrl):
        service.confirm_publish(ARTICLE_ID, "toutiao", "不是链接", confirmed=True)
    assert service.status(ARTICLE_ID)["platforms"]["toutiao"]["state"] == PublishState.PENDING.value


# ── 5. 失败登记也要留痕 ───────────────────────────────────────
def test_mark_failed_requires_reason(service, article):
    with pytest.raises(FailureReasonRequired):
        service.mark_failed(ARTICLE_ID, "baijia", "   ")
    assert service.status(ARTICLE_ID)["failed_count"] == 0


def test_mark_failed_records_state_and_reason(service, article):
    result = service.mark_failed(ARTICLE_ID, "baijia", "百家号审核未通过：疑似搬运")
    assert result.state == PublishState.FAILED.value
    assert "审核未通过" in result.note

    status = service.status(ARTICLE_ID)
    assert status["failed_count"] == 1
    assert status["platforms"]["baijia"]["state"] == PublishState.FAILED.value
    assert article.status == ArticleStatus.FAILED.value


# ── 6. HTTP 端点 ──────────────────────────────────────────────
PUBLISH_PATHS = {
    "/articles/{article_id}/publish/packets",
    "/articles/{article_id}/publish/status",
    "/articles/{article_id}/publish/confirm",
    "/articles/{article_id}/publish/fail",
}


def test_publish_paths_registered():
    assert PUBLISH_PATHS <= set(app.openapi()["paths"])


def test_publish_endpoints_roundtrip(client, article):
    packets = client.get(f"/articles/{ARTICLE_ID}/publish/packets", params={"match_images": False})
    assert packets.status_code == 200, packets.text
    body = packets.json()
    assert len(body["packets"]) == len(PLATFORMS)
    assert body["pending_label"] == "待人工发布"
    assert body["all_published"] is False
    assert all(p["state"] == "pending" for p in body["packets"])

    before = client.get(f"/articles/{ARTICLE_ID}/publish/status").json()
    assert before["published_count"] == 0

    ok = client.post(
        f"/articles/{ARTICLE_ID}/publish/confirm",
        json={"platform": "toutiao", "confirmed": True, "posted_url": "https://x.test/a/1"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["platform"]["state"] == "published"
    assert ok.json()["status"]["published_count"] == 1
    assert ok.json()["status"]["platforms"]["xhs"]["state"] == "pending"


def test_publish_confirm_endpoint_rejects_missing_confirmation(client, article):
    resp = client.post(
        f"/articles/{ARTICLE_ID}/publish/confirm", json={"platform": "toutiao"}
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "confirmation_required"
    # 响应体里不存在任何 success 字段，前端拿不到「假绿灯」
    assert "success" not in resp.text
    assert client.get(f"/articles/{ARTICLE_ID}/publish/status").json()["published_count"] == 0


def test_publish_confirm_endpoint_rejects_missing_platform(client, article):
    resp = client.post(f"/articles/{ARTICLE_ID}/publish/confirm", json={"confirmed": True})
    assert resp.status_code == 422  # Pydantic 层就挡住了
    assert client.get(f"/articles/{ARTICLE_ID}/publish/status").json()["published_count"] == 0


def test_publish_packets_404_for_unknown_article(client):
    resp = client.get("/articles/NOPE/publish/packets")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "article_not_found"


def test_publish_fail_endpoint_requires_reason(client, article):
    resp = client.post(
        f"/articles/{ARTICLE_ID}/publish/fail", json={"platform": "baijia", "reason": ""}
    )
    assert resp.status_code == 422
    assert client.get(f"/articles/{ARTICLE_ID}/publish/status").json()["failed_count"] == 0


# ── 7. 源码级红线：published 只能有一个写入点 ─────────────────
def test_published_state_has_exactly_one_write_site():
    """静态扫描 app/：把 state 写成 published 的地方只允许存在于 confirm_publish。

    有人日后加一条「批量标记已发布」的捷径，这条测试会立刻变红。
    """
    app_dir = Path(__file__).resolve().parents[1] / "app"
    pattern = re.compile(r"state\s*=\s*PublishState\.PUBLISHED\.value")

    hits: list[str] = []
    for path in app_dir.rglob("*.py"):
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if pattern.search(line):
                hits.append(f"{path.relative_to(app_dir)}:{lineno}")

    assert len(hits) == 1, f"把 state 置为 published 的位置必须唯一，实际命中：{hits}"
    assert hits[0].startswith("services/publishing/service.py"), hits


def test_no_auto_publish_network_call_in_publishing_package():
    """发布包内不得出现任何对外请求 —— 没有网络调用，就没有「调用失败被吞掉」。"""
    pkg = Path(__file__).resolve().parents[1] / "app" / "services" / "publishing"
    forbidden = ("httpx", "requests", "urllib.request", "selenium", "playwright")
    for path in pkg.rglob("*.py"):
        source = path.read_text(encoding="utf-8")
        for name in forbidden:
            assert f"import {name}" not in source, f"{path.name} 不应引入网络/自动化库 {name}"
