"""Phase 2 路由集合。

坑 1「入口层断链」防护：所有路由都在这里集中注册，`app/main.py` 只做
`for r in ROUTERS: app.include_router(r)`，不存在「写了函数忘了挂上去」的可能。
"""

from fastapi import APIRouter

from app.api.routers.analytics import router as analytics_router
from app.api.routers.articles import router as articles_router
from app.api.routers.publish import router as publish_router
from app.api.routers.tracking import router as tracking_router
from app.api.routers.weekly import router as weekly_router

ROUTERS: tuple[APIRouter, ...] = (
    articles_router,
    publish_router,
    tracking_router,
    analytics_router,
    weekly_router,
)

__all__ = ["ROUTERS"]
