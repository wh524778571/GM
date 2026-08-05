"""人工发布闭环端点（Phase 4 / Epic 4.1 · M4）。

    GET  /articles/{id}/publish/packets  组装四平台发布包（纯读，绝不改状态）
    GET  /articles/{id}/publish/status   四平台状态（默认 pending = 待人工发布）
    POST /articles/{id}/publish/confirm  人工确认某平台已发布（必须 confirmed=true）
    POST /articles/{id}/publish/fail     人工登记某平台发布失败（必须写原因）

**这里没有「一键发布」端点，这是刻意的。** 系统不持有任何平台登录态，
写一个自动发布就必然出现「以为发了实际没发」（审计头号风险）。
所有异常都由 `PublishError.http_status` 决定状态码并原样透出 detail，
不存在把失败包装成 200 的分支。
"""

from __future__ import annotations

from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.schemas import (
    PublishConfirmRequest,
    PublishConfirmResponse,
    PublishFailRequest,
    PublishPacketsResponse,
    PublishStatusResponse,
)
from app.db.base import get_session
from app.services.publishing import PublishError, PublishService

router = APIRouter(tags=["publish"])


def _service(session: Session) -> PublishService:
    return PublishService(session)


def _raise(exc: PublishError) -> NoReturn:
    raise HTTPException(exc.http_status, exc.to_dict()) from exc


@router.get("/articles/{article_id}/publish/packets", response_model=PublishPacketsResponse)
def publish_packets(
    article_id: str,
    match_images: bool = Query(True, description="是否用素材库解析配图（影响配图清单的 matched）"),
    include_html: bool = Query(True, description="是否附带四平台预览 HTML（体积较大）"),
    session: Session = Depends(get_session),
) -> PublishPacketsResponse:
    """四平台发布包：可复制正文 + 配图清单 + 人工步骤 + 当前状态。

    调用它**不会**改变任何发布状态 —— 看过发布包不等于发过。
    """
    service = _service(session)
    try:
        packets = service.build_packets(
            article_id, match_images=match_images, include_html=include_html
        )
        status = service.status(article_id)
    except PublishError as exc:
        _raise(exc)

    return PublishPacketsResponse(
        article_id=article_id,
        article_status=status["article_status"],
        pending_label=status["pending_label"],
        all_published=status["all_published"],
        published_count=status["published_count"],
        total_platforms=status["total_platforms"],
        packets=[p.to_dict(include_html=include_html) for p in packets],
    )


@router.get("/articles/{article_id}/publish/status", response_model=PublishStatusResponse)
def publish_status(
    article_id: str, session: Session = Depends(get_session)
) -> PublishStatusResponse:
    try:
        return PublishStatusResponse(**_service(session).status(article_id))
    except PublishError as exc:
        _raise(exc)


@router.post("/articles/{article_id}/publish/confirm", response_model=PublishConfirmResponse)
def publish_confirm(
    article_id: str, payload: PublishConfirmRequest, session: Session = Depends(get_session)
) -> PublishConfirmResponse:
    """人工确认：**全工程唯一**能把某平台标成 published 的入口。

    `confirmed` 不为 true → 422 `confirmation_required`，状态保持 pending。
    该平台没有标题/正文 → 422 `nothing_to_publish`。
    """
    service = _service(session)
    try:
        platform_status = service.confirm_publish(
            article_id,
            payload.platform,
            payload.posted_url,
            confirmed=payload.confirmed,
            confirmed_by=payload.confirmed_by,
            note=payload.note,
        )
        overall = service.status(article_id)
    except PublishError as exc:
        _raise(exc)

    return PublishConfirmResponse(
        article_id=article_id,
        platform=platform_status.to_dict(),
        status=PublishStatusResponse(**overall),
    )


@router.post("/articles/{article_id}/publish/fail", response_model=PublishConfirmResponse)
def publish_fail(
    article_id: str, payload: PublishFailRequest, session: Session = Depends(get_session)
) -> PublishConfirmResponse:
    """人工登记发布失败（平台风控 / 审核不过 / 登录失败…），原因必填。"""
    service = _service(session)
    try:
        platform_status = service.mark_failed(article_id, payload.platform, payload.reason)
        overall = service.status(article_id)
    except PublishError as exc:
        _raise(exc)

    return PublishConfirmResponse(
        article_id=article_id,
        platform=platform_status.to_dict(),
        status=PublishStatusResponse(**overall),
    )
