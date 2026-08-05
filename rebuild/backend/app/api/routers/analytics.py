"""数据看板（Epic 2.2）。全部指标由 articles + tracking 派生。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.base import get_session
from app.services.analytics import AnalyticsService

router = APIRouter(tags=["analytics"])


@router.get("/analytics")
def analytics_kpi(session: Session = Depends(get_session)) -> dict:
    """KPI 看板：总阅读、平均互动率、小红书粉丝代理值、收益（实收 + 预估）。"""
    return AnalyticsService(session).kpi()


@router.get("/analytics/summary")
def analytics_summary(
    top_articles: int = Query(20, ge=1, le=100),
    days: int = Query(30, ge=1, le=365),
    session: Session = Depends(get_session),
) -> dict:
    """明细汇总：总量 / 分平台 / TopN 文章 / 按日趋势。"""
    return AnalyticsService(session).summary(top_articles=top_articles, days=days)
