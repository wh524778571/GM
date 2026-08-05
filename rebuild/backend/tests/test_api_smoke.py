"""Phase 2 端点冒烟测试：路由挂载 + 正常响应 + 错误不伪装成功。

坑 1「入口层断链」：`test_phase2_paths_registered` 会在忘记挂路由时立刻红。
坑 3「静默成功」：AI 未配置 → 503，模型输出不合法 → 422，都断言在案。
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.db.base import get_session
from app.main import app
from app.services.ai.provider import MockProvider

from tests.test_generation_style import _fixture_payload

ARTICLE_ID = "TEST-API-001"
TOPIC = "《仙逆》第147集：王林道心未与雷融，这一集藏了5个细节"

PHASE2_PATHS = {
    "/articles",
    "/articles/{article_id}",
    "/articles/{article_id}/generate",
    "/articles/{article_id}/qa",
    "/tracking",
    "/analytics",
    "/analytics/summary",
    "/weekly-plan",
    "/weekly-plan/{task_id}",
}


@pytest.fixture()
def client(session):
    """用临时库替换真实 Session，避免冒烟测试写脏 app.db。"""
    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def mock_ai(monkeypatch):
    """把生成路由用的工厂换成带固定 payload 的 mock（不发网络请求）。"""
    raw = json.dumps(_fixture_payload(), ensure_ascii=False)
    monkeypatch.setattr(
        "app.api.routers.articles.build_provider", lambda *_a, **_k: MockProvider(raw)
    )


# ── 路由挂载 ──────────────────────────────────────────────────
def test_phase2_paths_registered():
    assert PHASE2_PATHS <= set(app.openapi()["paths"])


def test_health_exposes_ai_status(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["platforms"] == ["toutiao", "baijia", "bilibili", "xhs"]
    assert len(body["system_prompt_fingerprint"]) == 12
    assert isinstance(body["zhipu_api_key_configured"], bool)
    assert "zhipu_api_key" not in body  # 只暴露「是否配置」，永不回显密钥


# ── 文章 CRUD ─────────────────────────────────────────────────
def test_article_crud_roundtrip(client):
    created = client.post("/articles", json={"article_id": ARTICLE_ID, "title": TOPIC})
    assert created.status_code == 201

    assert client.post("/articles", json={"article_id": ARTICLE_ID, "title": TOPIC}).status_code == 409
    assert client.get(f"/articles/{ARTICLE_ID}").json()["title"] == TOPIC
    assert client.get("/articles/NOPE").status_code == 404

    patched = client.patch(f"/articles/{ARTICLE_ID}", json={"status": "pending"})
    assert patched.json()["status"] == "pending"
    assert client.patch(f"/articles/{ARTICLE_ID}", json={"status": "不存在"}).status_code == 422

    listed = client.get("/articles").json()
    assert listed["total"] == 1 and listed["items"][0]["article_id"] == ARTICLE_ID


# ── 生成闭环 ──────────────────────────────────────────────────
def test_generate_returns_four_platforms_and_persists(client, mock_ai):
    client.post("/articles", json={"article_id": ARTICLE_ID, "title": TOPIC})

    response = client.post(
        f"/articles/{ARTICLE_ID}/generate",
        json={"topic": TOPIC, "persist": True, "match_images": False},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["persisted"] is True

    result = body["result"]
    assert sorted(result["contents"]) == ["baijia", "bilibili", "toutiao", "xhs"]
    assert sorted(result["previews"]) == ["baijia", "bilibili", "toutiao", "xhs"]
    assert "【配图" not in result["contents"]["xhs"]
    assert len(result["titles"]["xhs"]) <= 20
    assert result["ok"] is True

    stored = client.get(f"/articles/{ARTICLE_ID}").json()
    assert sorted(stored["contents"]) == ["baijia", "bilibili", "toutiao", "xhs"]

    qa_body = client.post(f"/articles/{ARTICLE_ID}/qa").json()
    assert qa_body["ok"] is True


def test_generate_reports_bad_model_output_as_422(client):
    """默认 mock 返回的不是 JSON —— 必须 422，而不是回一篇假文章。"""
    client.post("/articles", json={"article_id": ARTICLE_ID, "title": TOPIC})
    response = client.post(
        f"/articles/{ARTICLE_ID}/generate",
        json={"topic": TOPIC, "provider": "mock", "persist": True},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["stage"] == "parse"
    assert client.get(f"/articles/{ARTICLE_ID}").json()["contents"] is None  # 未落脏数据


def test_generate_without_api_key_returns_503(client, monkeypatch):
    monkeypatch.setattr("app.core.settings.settings.zhipu_api_key", "")
    client.post("/articles", json={"article_id": ARTICLE_ID, "title": TOPIC})
    response = client.post(
        f"/articles/{ARTICLE_ID}/generate", json={"topic": TOPIC, "provider": "zhipu"}
    )
    assert response.status_code == 503
    assert "ZHIPU_API_KEY" in response.json()["detail"]["message"]


# ── 追踪 + 看板 ───────────────────────────────────────────────
def test_tracking_write_and_analytics(client):
    client.post("/articles", json={"article_id": ARTICLE_ID, "title": TOPIC})

    payload = {
        "date": "2026-08-01",
        "article_id": ARTICLE_ID,
        "platform": "今日头条",  # 中文名走 platforms.yaml 的 tracking_aliases
        "impress": 1000,
        "views": 120,
        "likes": 8,
        "comments": 2,
        "bookmarks": 1,
    }
    first = client.post("/tracking", json=payload)
    assert first.status_code == 200 and first.json()["created"] is True
    assert first.json()["item"]["platform"] == "toutiao"

    payload["views"] = 200
    assert client.post("/tracking", json=payload).json()["created"] is False  # upsert 不重复建行

    assert client.post("/tracking", json={**payload, "article_id": "NOPE"}).status_code == 404
    assert client.get("/tracking").json()["returned"] == 1

    kpi = client.get("/analytics").json()
    assert kpi["reads"]["total_views"] == 200
    assert kpi["revenue"]["rpm_configured"] is False          # 未配置就如实说未配置
    assert kpi["xhs_follower_proxy"]["real_follower_count"] is None  # 不冒充真实粉丝数

    summary = client.get("/analytics/summary").json()
    assert summary["totals"]["views"] == 200
    assert summary["daily"][-1]["date"] == "2026-08-01"


def test_analytics_reports_no_data_instead_of_zero(client):
    """空库时互动率必须是 null（前端显示「暂无数据」），不是 0%。"""
    kpi = client.get("/analytics").json()
    assert kpi["reads"]["tracking_rows"] == 0
    assert kpi["engagement"]["avg_rate"] is None


# ── 周计划 ────────────────────────────────────────────────────
def test_weekly_plan_crud(client):
    created = client.post(
        "/weekly-plan",
        json={"week_start": "2026-08-03", "weekday": 0, "title": "盘点仙逆本周素材"},
    )
    assert created.status_code == 201
    task_id = created.json()["id"]

    assert client.get("/weekly-plan", params={"week_start": "2026-08-03"}).json()["returned"] == 1
    assert client.patch(f"/weekly-plan/{task_id}", json={"status": "done"}).json()["status"] == "done"
    assert client.patch("/weekly-plan/999999", json={"status": "done"}).status_code == 404
