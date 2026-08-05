"""平台数据追踪写入 / 查询（Epic 2.2）。

平台标识按 platforms.yaml 的 tracking_aliases 归一（历史数据用「今日头条」中文名）。
article_id 必须已存在，否则 404 —— 外键错误不留到 flush 阶段才炸。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.schemas import (
    TrackingIn,
    TrackingListResponse,
    TrackingOut,
    TrackingWriteResponse,
)
from app.core.platform_rules import PlatformRulesError, load_registry
from app.db.base import get_session
from app.models.tracking import Tracking
from app.repositories.article_repository import ArticleRepository
from app.repositories.tracking_repository import TrackingRepository

router = APIRouter(tags=["tracking"])


def _platform_name(key: str) -> str:
    registry = load_registry()
    try:
        return registry.get(key).name
    except PlatformRulesError:
        return key


def _to_out(row: Tracking) -> TrackingOut:
    return TrackingOut(
        id=row.id,
        date=row.date,
        article_id=row.article_id,
        platform=row.platform,
        platform_name=_platform_name(row.platform),
        title_used=row.title_used,
        impress=row.impress,
        views=row.views,
        likes=row.likes,
        comments=row.comments,
        bookmarks=row.bookmarks,
        pending=row.pending,
        revenue_cents=row.revenue_cents,
    )


@router.post("/tracking", response_model=TrackingWriteResponse)
def write_tracking(
    payload: TrackingIn, session: Session = Depends(get_session)
) -> TrackingWriteResponse:
    """按 (date, article_id, platform) upsert。返回 created 明确是新增还是覆盖。"""
    registry = load_registry()
    try:
        platform = registry.normalize_platform(payload.platform)
    except PlatformRulesError as exc:
        raise HTTPException(422, str(exc)) from exc

    if ArticleRepository(session).get_by_article_id(payload.article_id) is None:
        raise HTTPException(404, f"文章不存在，无法记录追踪数据：{payload.article_id}")

    repo = TrackingRepository(session)
    row, created = repo.upsert(
        date=payload.date,
        article_id=payload.article_id,
        platform=platform,
        title_used=payload.title_used,
        impress=payload.impress,
        views=payload.views,
        likes=payload.likes,
        comments=payload.comments,
        bookmarks=payload.bookmarks,
        pending=payload.pending,
        revenue_cents=payload.revenue_cents,
    )
    return TrackingWriteResponse(created=created, item=_to_out(row))


@router.get("/tracking", response_model=TrackingListResponse)
def list_tracking(
    article_id: str | None = None,
    platform: str | None = None,
    date_from: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
) -> TrackingListResponse:
    if platform:
        try:
            platform = load_registry().normalize_platform(platform)
        except PlatformRulesError as exc:
            raise HTTPException(422, str(exc)) from exc

    rows = TrackingRepository(session).list(
        article_id=article_id,
        platform=platform,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
    )
    return TrackingListResponse(returned=len(rows), items=[_to_out(r) for r in rows])
