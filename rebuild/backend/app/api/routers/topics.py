"""今日推荐选题（Epic：常驻选题功能）。

- GET  /topics/today       今日列表（去重+黑名单过滤），无则 needs_generation=True
- POST /topics/generate    触发生成 5 个选题（LLM），落库返回
- POST /topics/{id}/blacklist   标记「不再推荐」（blacklisted=True）；body 可传 {blacklisted:false} 恢复
- POST /topics/{id}/write  用该选题写四平台草稿，返回 article_id（前端跳转文章详情）
- POST /topics/{id}/write-async  同上但立即返回 job_id，进度查 GET /jobs/{job_id}

错误显式：无 AI 密钥 → 503；文章生成限流/失败 → 502；质检不过 → 422；选题不存在 → 404。
"""

from __future__ import annotations

import json
import re
import threading
from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.schemas import (
    TopicBlacklistResponse,
    TopicGenerateResponse,
    TopicOut,
    TopicTodayResponse,
    TopicUpdate,
    TopicWriteResponse,
)
from app.core.jobs import jobs
from app.core.settings import settings
from app.db.base import get_session, session_scope
from app.models.article import utcnow
from app.models.topic_recommendation import TopicRecommendation
from app.repositories.topic_repository import TopicRepository
from app.services import topic_service
from app.services.ai import AIConfigError, AIProviderError, GenerationError
from app.services.topic_service import _neutralize_numbers, _norm_key

router = APIRouter(tags=["topics"])


class TopicBlacklistRequest(BaseModel):
    blacklisted: bool = True


class TopicImportRequest(BaseModel):
    """从外部源（选题扫描等）导入一个选题到今日选题库。"""

    title: str = Field(..., min_length=1, description="选题标题")
    summary: str = ""
    angle: str = ""
    topic_type: str = "常青候选"
    article_type: str = "depth"
    viral_genes: list[str] = []
    viral_why: str = ""


def _today() -> str:
    return date_type.today().strftime("%Y-%m-%d")


def _to_out(t: TopicRecommendation, today: str) -> TopicOut:
    import json as _json

    genes: list[str] = []
    try:
        parsed = _json.loads(t.viral_genes or "[]")
        if isinstance(parsed, list):
            genes = [str(g) for g in parsed if str(g).strip()]
    except Exception:
        genes = []
    return TopicOut(
        id=t.id,
        date=t.date,
        title=t.title,
        topic_type=t.topic_type,
        summary=t.summary or "",
        angle=t.angle or "",
        article_type=t.article_type,
        blacklisted=t.blacklisted,
        recommend_count=t.recommend_count,
        fresh=(t.date == today),
        viral_genes=genes,
        viral_why=t.viral_why or "",
    )


@router.get("/topics/today", response_model=TopicTodayResponse)
def topics_today(session: Session = Depends(get_session)) -> TopicTodayResponse:
    today = _today()
    repo = TopicRepository(session)
    items = repo.list_today(today)
    blacklisted = repo.list_blacklisted()
    return TopicTodayResponse(
        date=today,
        items=[_to_out(t, today) for t in items],
        needs_generation=len(items) == 0,
        blacklisted_count=len(blacklisted),
    )


@router.post("/topics/generate", response_model=TopicGenerateResponse)
def topics_generate(session: Session = Depends(get_session)) -> TopicGenerateResponse:
    today = _today()
    try:
        result = topic_service.generate_topics(today, session, count=5)
    except AIConfigError as exc:
        raise HTTPException(503, exc.to_dict()) from exc
    return TopicGenerateResponse(
        date=result["date"],
        items=[_to_out(t, today) for t in result["items"]],
        generated=result["generated"],
    )


@router.post("/topics/import", response_model=TopicOut)
def topic_import(
    payload: TopicImportRequest, session: Session = Depends(get_session)
) -> TopicOut:
    """外部选题（如周一扫描的本周 3 选题）导入今日选题库，使今日选题页可见。"""
    today = _today()
    try:
        obj = topic_service.import_topic(today, payload.model_dump(), session)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return _to_out(obj, today)


@router.post("/topics/{topic_id}/blacklist", response_model=TopicBlacklistResponse)
def topic_blacklist(
    topic_id: int,
    payload: TopicBlacklistRequest | None = None,
    session: Session = Depends(get_session),
) -> TopicBlacklistResponse:
    value = payload.blacklisted if payload is not None else True
    repo = TopicRepository(session)
    obj = repo.set_blacklist(topic_id, value)
    if obj is None:
        raise HTTPException(404, f"选题不存在：{topic_id}")
    return TopicBlacklistResponse(id=obj.id, blacklisted=obj.blacklisted)


@router.patch("/topics/{topic_id}", response_model=TopicOut)
def topic_update(
    topic_id: int, payload: TopicUpdate, session: Session = Depends(get_session)
) -> TopicOut:
    """编辑选题。标题变更会重算去重键；若与别的选题冲突返回 409。"""
    repo = TopicRepository(session)
    obj = repo.get(topic_id)
    if obj is None:
        raise HTTPException(404, f"选题不存在：{topic_id}")
    today = _today()

    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(422, "没有任何待更新字段")

    # 标题变更 → 重算去重键，冲突则 409
    if "title" in data:
        clean = re.sub(r"[《》]", "", (data["title"] or "")).strip()
        if not clean:
            raise HTTPException(422, "title 不能为空")
        new_key = _norm_key(clean)
        if new_key != obj.topic_key:
            collision = repo.get_by_key(new_key)
            if collision is not None and collision.id != obj.id:
                raise HTTPException(409, f"选题已存在（去重键冲突）：{collision.title}")
        obj.topic_key = new_key
        obj.title = _neutralize_numbers(clean)
        data.pop("title")

    if "viral_genes" in data:
        genes = data["viral_genes"] or []
        obj.viral_genes = json.dumps(genes, ensure_ascii=False)
        data.pop("viral_genes")

    if data.get("article_type") is not None and data["article_type"] not in ("depth", "info"):
        raise HTTPException(422, "article_type 仅支持 depth | info")

    for key, value in data.items():
        if value is not None:
            setattr(obj, key, value)

    obj.updated_at = utcnow()
    session.flush()
    return _to_out(obj, today)


@router.delete("/topics/{topic_id}", status_code=204)
def topic_delete(topic_id: int, session: Session = Depends(get_session)) -> None:
    """删除选题（硬删）。选题可重新生成，故不做软删；不存在返回 404。"""
    repo = TopicRepository(session)
    obj = repo.get(topic_id)
    if obj is None:
        raise HTTPException(404, f"选题不存在：{topic_id}")
    session.delete(obj)
    session.flush()


@router.post("/topics/{topic_id}/write", response_model=TopicWriteResponse)
def topic_write(topic_id: int, session: Session = Depends(get_session)) -> TopicWriteResponse:
    try:
        result = topic_service.write_topic_article(topic_id, session)
    except LookupError:
        raise HTTPException(404, f"选题不存在：{topic_id}") from None
    except AIConfigError as exc:
        raise HTTPException(503, exc.to_dict()) from exc
    except GenerationError as exc:
        raise HTTPException(422, exc.to_dict()) from exc
    except AIProviderError as exc:
        raise HTTPException(502, exc.to_dict()) from exc
    return TopicWriteResponse(**result)


def _run_write_job(job_id: str, topic_id: int) -> None:
    """后台线程体：独立 session 跑生成，全程往 jobs 表上报进度。

    绝不吞异常——失败写进 job.error，前端照原样显示，不假装成功。
    """

    def report(stage: str, percent: int, message: str) -> None:
        jobs.update(job_id, stage=stage, percent=percent, message=message)

    try:
        # 后台线程不能复用请求的 session（SQLAlchemy Session 非线程安全），自建事务边界
        with session_scope() as session:
            result = topic_service.write_topic_article(topic_id, session, on_progress=report)
        jobs.finish(job_id, result)
    except LookupError:
        jobs.fail(job_id, {"code": "not_found", "message": f"选题不存在：{topic_id}"})
    except AIConfigError as exc:
        jobs.fail(job_id, {"code": "ai_config", **exc.to_dict()})
    except GenerationError as exc:
        jobs.fail(job_id, {"code": "generation", **exc.to_dict()})
    except AIProviderError as exc:
        jobs.fail(job_id, {"code": "ai_provider", **exc.to_dict()})
    except Exception as exc:  # noqa: BLE001 - 兜底：任何意外都要让前端看见
        jobs.fail(job_id, {"code": "internal", "message": str(exc)})


@router.post("/topics/{topic_id}/write-async", status_code=202)
def topic_write_async(topic_id: int, session: Session = Depends(get_session)) -> dict:
    """异步版四平台写作：立即返回 job_id，进度轮询 GET /jobs/{job_id}。

    生成要 5 次 LLM 调用（30–120s），同步等待会让前端像卡死。
    这里先校验选题存在（快速失败给 404），再把耗时活交给后台线程。
    """
    repo = TopicRepository(session)
    if repo.get(topic_id) is None:
        raise HTTPException(404, f"选题不存在：{topic_id}")

    job = jobs.create("topic_write", message="排队中…")
    thread = threading.Thread(
        target=_run_write_job, args=(job.id, topic_id), name=f"write-{topic_id}", daemon=True
    )
    thread.start()
    return {"job_id": job.id, "status": job.status}
