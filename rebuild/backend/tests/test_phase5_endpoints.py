"""Phase 5/6 新增端点测试：素材上传、项目文件、周计划删除、润色、导出。

坑 1「入口层断链」：`test_new_paths_registered` 忘挂路由立刻红。
坑 3「静默成功」：
    - MATERIALS_ROOT 未配置时上传必须 503，不能返回 201 假装存好了；
    - 删除只允许命中 uploads/，越界必须 403；
    - 润色在 AI 未配置时必须 503，绝不回一段原文冒充「已润色」。
"""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core.settings import settings
from app.db.base import get_session
from app.main import app
from app.models.article import Article, ArticleStatus
from app.models.weekly_plan import WeeklyPlanTask
from app.services.ai.errors import AIConfigError
from app.services.ai.provider import MockProvider

NEW_PATHS = {
    "/materials",
    "/files",
    "/weekly-plan/{task_id}",
    "/articles/{article_id}/polish",
    "/articles/{article_id}/export",
}


@pytest.fixture()
def client(session):
    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _png_bytes(size=(24, 16)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (255, 92, 58)).save(buf, format="PNG")
    return buf.getvalue()


def test_new_paths_registered() -> None:
    spec = app.openapi()
    missing = NEW_PATHS - set(spec["paths"])
    assert not missing, f"未挂载的新端点：{missing}"
    assert "delete" in spec["paths"]["/weekly-plan/{task_id}"]
    assert "post" in spec["paths"]["/materials"]
    assert {"get", "post", "delete"} <= set(spec["paths"]["/files"])


# ── 素材上传 ──────────────────────────────────────────────────
def test_material_upload_without_root_is_503(client, monkeypatch) -> None:
    monkeypatch.setattr(settings, "materials_root", None)
    res = client.post(
        "/materials",
        files={"file": ("沧元图_打戏.png", _png_bytes(), "image/png")},
    )
    assert res.status_code == 503
    assert res.json()["detail"]["code"] == "MATERIALS_ROOT_NOT_CONFIGURED"


def test_material_upload_writes_file_and_index(client, monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(settings, "materials_root", tmp_path)
    res = client.post(
        "/materials",
        files={"file": ("raw.png", _png_bytes(), "image/png")},
        data={"work": "沧元图", "scene": "打戏", "episode": "21"},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    # 命名遵循「作品名_用途」约定
    assert body["stem"] == "沧元图_打戏"
    assert body["work"] == "沧元图"
    assert body["width"] == 24 and body["height"] == 16
    assert (tmp_path / body["path"]).is_file()
    # 列表接口能查到
    assert any(m["id"] == body["id"] for m in client.get("/materials").json()["items"])


def test_material_upload_rejects_bad_ext(client, monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(settings, "materials_root", tmp_path)
    res = client.post("/materials", files={"file": ("x.txt", b"not an image", "text/plain")})
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "UNSUPPORTED_IMAGE_EXT"


def test_material_upload_does_not_overwrite(client, monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(settings, "materials_root", tmp_path)
    payload = {"work": "沧元图", "scene": "打戏"}
    first = client.post("/materials", files={"file": ("a.png", _png_bytes(), "image/png")}, data=payload)
    second = client.post("/materials", files={"file": ("a.png", _png_bytes(), "image/png")}, data=payload)
    assert first.json()["path"] != second.json()["path"]
    assert second.json()["stem"] == "沧元图_打戏_2"


# ── 项目文件 ──────────────────────────────────────────────────
def test_files_list_filters_and_sorts(client, monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(settings, "files_root", tmp_path)
    (tmp_path / "方案.md").write_text("x" * 100, encoding="utf-8")
    (tmp_path / "platforms.yaml").write_text("y", encoding="utf-8")
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "node_modules" / "junk.md").write_text("z", encoding="utf-8")

    body = client.get("/files?sort=name").json()
    names = [i["name"] for i in body["items"]]
    assert names == ["platforms.yaml", "方案.md"]
    assert "junk.md" not in names  # node_modules 被排除
    kinds = {i["name"]: i["kind"] for i in body["items"]}
    assert kinds["platforms.yaml"] == "规则源"
    assert all(i["deletable"] is False for i in body["items"])

    assert client.get("/files?keyword=platform").json()["total"] == 1
    assert client.get("/files?sort=nope").status_code == 422


def test_files_upload_then_delete(client, monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(settings, "files_root", tmp_path)
    res = client.post("/files", files={"file": ("笔记.md", b"# hi", "text/markdown")})
    assert res.status_code == 201, res.text
    rel = res.json()["rel_path"]
    assert rel.startswith("uploads/")
    assert res.json()["deletable"] is True

    assert client.delete(f"/files?rel_path={rel}").json()["deleted"] is True
    assert not (tmp_path / rel).exists()


def test_files_delete_outside_uploads_is_403(client, monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(settings, "files_root", tmp_path)
    victim = tmp_path / "方案.md"
    victim.write_text("重要", encoding="utf-8")

    res = client.delete("/files?rel_path=方案.md")
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "DELETE_OUT_OF_UPLOADS"
    assert victim.is_file(), "项目源文件不允许被接口删掉"

    # 路径穿越同样必须被挡
    assert client.delete("/files?rel_path=uploads/../方案.md").status_code == 403


# ── 周计划删除 ────────────────────────────────────────────────
def test_weekly_delete(client, session) -> None:
    task = WeeklyPlanTask(week_start="2026-08-03", weekday=4, title="沧元图解析", status="planned")
    session.add(task)
    session.flush()

    assert client.delete(f"/weekly-plan/{task.id}").json()["deleted"] is True
    assert client.get("/weekly-plan").json()["items"] == []
    assert client.delete(f"/weekly-plan/{task.id}").status_code == 404


# ── 润色 ──────────────────────────────────────────────────────
def _seed_article(session, **kw) -> Article:
    article = Article(
        article_id=kw.pop("article_id", "TEST-P5-001"),
        title=kw.pop("title", "沧元图 21 集解析"),
        status=ArticleStatus.DRAFT.value,
        **kw,
    )
    session.add(article)
    session.flush()
    return article


def test_polish_without_ai_key_is_503(client, session, monkeypatch) -> None:
    _seed_article(session, content_text="原文" * 20)

    def _boom(*_a, **_k):
        raise AIConfigError("ZHIPU_API_KEY 未配置", provider="zhipu")

    monkeypatch.setattr("app.api.routers.articles.build_provider", _boom)
    res = client.post("/articles/TEST-P5-001/polish", json={})
    assert res.status_code == 503
    # 未配置就绝不能回一段「润色结果」
    assert "polished" not in res.json()


def test_polish_returns_model_text(client, session, monkeypatch) -> None:
    _seed_article(session, content_text="原文原文")
    monkeypatch.setattr(
        "app.api.routers.articles.build_provider",
        lambda *_a, **_k: MockProvider("润色后的正文，更口语一些。"),
    )
    res = client.post("/articles/TEST-P5-001/polish", json={"persist": True})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["polished"] == "润色后的正文，更口语一些。"
    assert body["persisted"] is True
    assert client.get("/articles/TEST-P5-001").json()["content_text"] == body["polished"]


def test_polish_without_text_is_422(client, session, monkeypatch) -> None:
    _seed_article(session, article_id="TEST-P5-EMPTY", content_text=None)
    monkeypatch.setattr(
        "app.api.routers.articles.build_provider", lambda *_a, **_k: MockProvider("x")
    )
    res = client.post("/articles/TEST-P5-EMPTY/polish", json={})
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "NOTHING_TO_POLISH"


# ── 导出 ──────────────────────────────────────────────────────
def test_export_all_platforms(client, session) -> None:
    _seed_article(
        session,
        article_id="TEST-P5-EXPORT",
        titles={"xhs": "小红书标题", "toutiao": "头条标题"},
        contents={"xhs": "小红书正文", "toutiao": "头条正文"},
    )
    body = client.get("/articles/TEST-P5-EXPORT/export").json()
    assert body["filename"] == "TEST-P5-EXPORT.md"
    assert "小红书正文" in body["content"] and "头条正文" in body["content"]
    assert body["char_count"] == len(body["content"])


def test_export_single_platform_and_empty(client, session) -> None:
    _seed_article(
        session,
        article_id="TEST-P5-ONE",
        titles={"xhs": "小红书标题"},
        contents={"xhs": "小红书正文"},
    )
    body = client.get("/articles/TEST-P5-ONE/export?platform=xhs").json()
    assert body["filename"] == "TEST-P5-ONE_xhs.md"
    assert "头条" not in body["content"]

    _seed_article(session, article_id="TEST-P5-NONE")
    res = client.get("/articles/TEST-P5-NONE/export")
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "NOTHING_TO_EXPORT"
