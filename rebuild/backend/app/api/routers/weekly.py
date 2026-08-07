"""周计划（Epic 2.2）。轻量规划面，不参与内容闭环的核心链路。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.schemas import (
    WeeklyPlanResponse,
    WeeklyTaskIn,
    WeeklyTaskOut,
    WeeklyTaskUpdate,
)
from app.core.platform_rules import PlatformRulesError, load_registry
from app.db.base import get_session
from app.models.weekly_plan import WeeklyPlanTask, WeeklyTaskStatus
from app.repositories.weekly_plan_repository import WeeklyPlanRepository

router = APIRouter(tags=["weekly-plan"])

VALID_STATUS = tuple(s.value for s in WeeklyTaskStatus)


def _to_out(task: WeeklyPlanTask) -> WeeklyTaskOut:
    return WeeklyTaskOut(
        id=task.id,
        week_start=task.week_start,
        weekday=task.weekday,
        title=task.title,
        article_id=task.article_id,
        platform=task.platform,
        status=task.status,
        note=task.note,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


def _validate(status: str | None, platform: str | None) -> str | None:
    if status is not None and status not in VALID_STATUS:
        raise HTTPException(422, f"未知状态 {status!r}，可选：{list(VALID_STATUS)}")
    if not platform:
        return None
    try:
        return load_registry().normalize_platform(platform)
    except PlatformRulesError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/weekly-plan", response_model=WeeklyPlanResponse)
def list_weekly_plan(
    week_start: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    status: str | None = None,
    article_id: str | None = None,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
) -> WeeklyPlanResponse:
    _validate(status, None)
    items = WeeklyPlanRepository(session).list(
        week_start=week_start,
        status=status,
        article_id=article_id,
        limit=limit,
        offset=offset,
    )
    return WeeklyPlanResponse(
        week_start=week_start, returned=len(items), items=[_to_out(t) for t in items]
    )


@router.post("/weekly-plan", response_model=WeeklyTaskOut, status_code=201)
def create_weekly_task(
    payload: WeeklyTaskIn, session: Session = Depends(get_session)
) -> WeeklyTaskOut:
    platform = _validate(payload.status, payload.platform)
    data = payload.model_dump()
    data["platform"] = platform
    return _to_out(WeeklyPlanRepository(session).add(WeeklyPlanTask(**data)))


@router.patch("/weekly-plan/{task_id}", response_model=WeeklyTaskOut)
def update_weekly_task(
    task_id: int, payload: WeeklyTaskUpdate, session: Session = Depends(get_session)
) -> WeeklyTaskOut:
    repo = WeeklyPlanRepository(session)
    task = repo.get(task_id)
    if task is None:
        raise HTTPException(404, f"周计划任务不存在：{task_id}")

    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(422, "没有任何待更新字段")
    platform = _validate(fields.get("status"), fields.get("platform"))
    if "platform" in fields:
        fields["platform"] = platform
    try:
        repo.update(task, **fields)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return _to_out(task)


@router.delete("/weekly-plan/{task_id}")
def delete_weekly_task(task_id: int, session: Session = Depends(get_session)) -> dict:
    """物理删除一条周计划任务。周计划是轻量规划面，不做软删留痕。"""
    repo = WeeklyPlanRepository(session)
    task = repo.get(task_id)
    if task is None:
        raise HTTPException(404, f"周计划任务不存在：{task_id}")
    session.delete(task)
    session.flush()
    return {"deleted": True, "id": task_id}
