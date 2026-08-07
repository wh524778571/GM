"""ORM 模型集合。导入本包即注册全部表到 Base.metadata（供 Alembic autogenerate）。"""

from app.models.article import Article, ArticleStatus
from app.models.material import Material, MaterialSource
from app.models.publish_record import PublishRecord, PublishState
from app.models.topic_recommendation import TopicRecommendation
from app.models.tracking import Tracking
from app.models.weekly_plan import WeeklyPlanTask, WeeklyTaskStatus

__all__ = [
    "Article",
    "ArticleStatus",
    "Material",
    "MaterialSource",
    "PublishRecord",
    "PublishState",
    "TopicRecommendation",
    "Tracking",
    "WeeklyPlanTask",
    "WeeklyTaskStatus",
]
