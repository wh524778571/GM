"""数据看板聚合 —— 全部从 articles + tracking 派生，不引入第二份统计表。

诚实原则（坑 3 的数据版）：
    看板上每一个数字都要能说清它是「实测」还是「代理指标/估算」。
    - 阅读量 / 互动 / 已登记收益 → 实测（tracking 原始列求和）
    - 预估收益                   → 估算，系数取自 platforms.yaml；
                                   未配置 RPM 时返回 0 并置 `configured=false`
    - 小红书粉丝                 → **平台不提供**，只给互动累计代理值，
                                   `real_follower_count` 恒为 null 并附说明，
                                   绝不把代理值当粉丝数展示。
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.platform_rules import PlatformRegistry, load_registry
from app.models.article import Article, ArticleStatus
from app.models.tracking import Tracking
from app.repositories.article_repository import ArticleRepository
from app.repositories.tracking_repository import TrackingRepository

XHS_FOLLOWER_PROXY_NOTE = (
    "小红书粉丝数无法从内容数据推导，此处为「点赞+收藏」累计代理值，仅用于观察趋势，"
    "不是真实粉丝数；真实值需人工从创作者后台录入。"
)


@dataclass
class Totals:
    impress: int = 0
    views: int = 0
    likes: int = 0
    comments: int = 0
    bookmarks: int = 0
    revenue_cents: int = 0
    rows: int = 0

    @property
    def engagement(self) -> int:
        return self.likes + self.comments + self.bookmarks

    @property
    def engagement_rate(self) -> float | None:
        """互动率 = 互动数 / 阅读量。无阅读量时返回 None（不返回 0，那是撒谎）。"""
        if self.views <= 0:
            return None
        return round(self.engagement / self.views, 4)

    def to_dict(self) -> dict:
        return {
            "impress": self.impress,
            "views": self.views,
            "likes": self.likes,
            "comments": self.comments,
            "bookmarks": self.bookmarks,
            "engagement": self.engagement,
            "engagement_rate": self.engagement_rate,
            "revenue_cents": self.revenue_cents,
            "rows": self.rows,
        }


class AnalyticsService:
    def __init__(self, session: Session, *, registry: PlatformRegistry | None = None) -> None:
        self.session = session
        self.registry = registry or load_registry()
        self.tracking = TrackingRepository(session)
        self.articles = ArticleRepository(session)

    # ── 汇总 ──────────────────────────────────────────────────
    def totals(self) -> Totals:
        row = self.session.execute(
            select(
                func.coalesce(func.sum(Tracking.impress), 0),
                func.coalesce(func.sum(Tracking.views), 0),
                func.coalesce(func.sum(Tracking.likes), 0),
                func.coalesce(func.sum(Tracking.comments), 0),
                func.coalesce(func.sum(Tracking.bookmarks), 0),
                func.coalesce(func.sum(Tracking.revenue_cents), 0),
                func.count(),
            )
        ).one()
        return Totals(*(int(v or 0) for v in row))

    def by_platform(self) -> dict[str, dict]:
        raw = self.tracking.platform_totals()
        out: dict[str, dict] = {}
        for key in self.registry.keys():
            data = raw.get(key, {})
            totals = Totals(
                impress=int(data.get("impress", 0)),
                views=int(data.get("views", 0)),
                likes=int(data.get("likes", 0)),
                comments=int(data.get("comments", 0)),
                bookmarks=int(data.get("bookmarks", 0)),
                revenue_cents=int(data.get("revenue_cents", 0)),
                rows=int(data.get("rows", 0)),
            )
            rpm = self.registry.revenue_rpm_cents(key)
            payload = totals.to_dict()
            payload.update(
                {
                    "platform": key,
                    "platform_name": self.registry.get(key).name,
                    "revenue_rpm_cents": rpm,
                    "estimated_revenue_cents": int(totals.views / 1000 * rpm),
                }
            )
            out[key] = payload

        # tracking 里如果混进了 platforms.yaml 未定义的 key，必须暴露而不是丢弃
        for key, data in raw.items():
            if key not in out:
                out[key] = {
                    "platform": key,
                    "platform_name": key,
                    "unknown_platform": True,
                    **data,
                }
        return out

    def by_article(self, limit: int = 20) -> list[dict]:
        stmt = (
            select(
                Tracking.article_id,
                func.coalesce(func.sum(Tracking.views), 0),
                func.coalesce(func.sum(Tracking.likes), 0),
                func.coalesce(func.sum(Tracking.comments), 0),
                func.coalesce(func.sum(Tracking.bookmarks), 0),
                func.coalesce(func.sum(Tracking.revenue_cents), 0),
            )
            .group_by(Tracking.article_id)
            .order_by(func.sum(Tracking.views).desc())
            .limit(limit)
        )
        rows = list(self.session.execute(stmt))
        titles = {
            a.article_id: a.title
            for a in self.session.scalars(
                select(Article).where(
                    Article.article_id.in_([r[0] for r in rows] or [""])
                )
            )
        }
        return [
            {
                "article_id": article_id,
                "title": titles.get(article_id),
                "views": int(views),
                "likes": int(likes),
                "comments": int(comments),
                "bookmarks": int(bookmarks),
                "revenue_cents": int(revenue),
            }
            for article_id, views, likes, comments, bookmarks, revenue in rows
        ]

    # ── KPI 看板 ──────────────────────────────────────────────
    def kpi(self) -> dict:
        totals = self.totals()
        platforms = self.by_platform()
        status_counts = self.articles.count_by_status()

        estimated = sum(p.get("estimated_revenue_cents", 0) for p in platforms.values())
        rpm_configured = any(
            self.registry.revenue_rpm_cents(k) > 0 for k in self.registry.keys()
        )

        xhs = platforms.get("xhs", {})
        xhs_proxy = int(xhs.get("likes", 0)) + int(xhs.get("bookmarks", 0))

        return {
            "articles": {
                "total": sum(
                    v for k, v in status_counts.items() if k != ArticleStatus.DELETED.value
                ),
                "by_status": status_counts,
            },
            "reads": {
                "total_views": totals.views,
                "total_impress": totals.impress,
                "tracking_rows": totals.rows,
            },
            "engagement": {
                "likes": totals.likes,
                "comments": totals.comments,
                "bookmarks": totals.bookmarks,
                "total": totals.engagement,
                # 无追踪数据时为 null，前端应显示「暂无数据」而不是 0%
                "avg_rate": totals.engagement_rate,
            },
            "xhs_follower_proxy": {
                "value": xhs_proxy,
                "basis": "xhs likes + bookmarks",
                "real_follower_count": None,
                "note": XHS_FOLLOWER_PROXY_NOTE,
            },
            "revenue": {
                "recorded_cents": totals.revenue_cents,
                "estimated_cents": estimated,
                "rpm_configured": rpm_configured,
                "source": str(self.registry.source_path),
                "note": (
                    "预估收益按 platforms.yaml 的 revenue_rpm_cents 换算"
                    if rpm_configured
                    else "revenue_rpm_cents 尚未配置（头条原创/百家分成待开通），预估收益按 0 计"
                ),
            },
            "platforms": platforms,
        }

    def summary(self, *, top_articles: int = 20, days: int = 30) -> dict:
        totals = self.totals()
        return {
            "totals": totals.to_dict(),
            "platforms": self.by_platform(),
            "top_articles": self.by_article(limit=top_articles),
            "daily": self.tracking.daily_series(limit_days=days),
        }
