"""API 出入参模型（Pydantic）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    app_env: str
    database: str
    database_ok: bool
    platforms: list[str]
    material_count: int
    zhipu_api_key_configured: bool
    ai_provider: str = "zhipu"
    system_prompt_fingerprint: str = ""


class MissingImageOut(BaseModel):
    index: int
    description: str
    suggested_filename: str


class RenderOut(BaseModel):
    platform: str
    platform_name: str
    html: str
    char_count: int
    image_count: int
    ok: bool
    missing_images: list[MissingImageOut] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class RenderRequest(BaseModel):
    content: str = Field(..., description="Markdown 正文（含【配图N：描述】占位符）")
    article_id: str | None = Field(None, description="用于配图隔离与缓存的文章 ID")
    cache_key: str | None = Field(None, description="配图结果缓存键，默认取 article_id")
    match_images: bool = Field(True, description="是否用素材库自动匹配配图")


class RenderAllResponse(BaseModel):
    cache_key: str
    all_ok: bool
    distinct_html: int
    results: dict[str, RenderOut]


class MaterialOut(BaseModel):
    id: int
    path: str
    filename: str
    stem: str
    source: str
    work: str | None = None
    episode: str | None = None
    scene: str | None = None
    kind: str | None = None
    article_id: str | None = None
    tags: list[str] | None = None
    width: int | None = None
    height: int | None = None
    size_bytes: int | None = None
    url: str


class MaterialListResponse(BaseModel):
    total_indexed: int
    returned: int
    items: list[MaterialOut]


class MaterialSearchHit(BaseModel):
    material_id: int
    path: str
    stem: str
    work: str | None = None
    episode: str | None = None
    source: str
    article_id: str | None = None
    score: int
    url: str
    reason: str
    matched_keywords: list[str] | None = None


class MaterialSearchResponse(BaseModel):
    query: str
    keywords: list[str]
    hits: list[MaterialSearchHit]


# ══════════════════════════════════════════════════════════════
# Phase 2 —— 内容闭环
# ══════════════════════════════════════════════════════════════


# ── 文章 ─────────────────────────────────────────────────────
class ArticleCreate(BaseModel):
    article_id: str = Field(..., min_length=1, max_length=200, description="业务唯一键")
    title: str = Field(..., min_length=1, max_length=300)
    status: str = Field("draft", description="draft/pending/published/failed/deleted")
    folder_name: str | None = None
    content_text: str | None = Field(None, description="核心 Markdown（未分平台）")
    titles: dict[str, str] | None = None
    contents: dict[str, str] | None = None
    image_sources: dict[str, str] | None = None
    publish_schedule: dict[str, str] | None = None


class ArticleUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=300)
    status: str | None = None
    folder_name: str | None = None
    content_text: str | None = None
    titles: dict[str, str] | None = None
    contents: dict[str, str] | None = None
    image_sources: dict[str, str] | None = None
    publish_schedule: dict[str, str] | None = None


class ArticleOut(BaseModel):
    id: int
    article_id: str
    title: str
    status: str
    folder_name: str | None = None
    content_text: str | None = None
    titles: dict[str, Any] | None = None
    contents: dict[str, Any] | None = None
    image_sources: dict[str, Any] | None = None
    publish_schedule: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime


class ArticleListResponse(BaseModel):
    total: int
    returned: int
    by_status: dict[str, int]
    items: list[ArticleOut]


class ImageBindRequest(BaseModel):
    """手动把某张素材绑定到文章里的配图占位符。"""

    placeholder: str = Field(..., description="占位符原文，如「【配图1：沧元图_破境瞬间】」")
    material_id: int = Field(..., description="素材库素材 id")


class ImageBindResponse(BaseModel):
    placeholder: str
    url: str
    matched: bool = True


class BatchDeleteRequest(BaseModel):
    """多选删除文章（软删：置为 deleted，可恢复）。"""

    ids: list[str] = Field(..., min_length=1, description="article_id 列表")


class BatchDeleteResponse(BaseModel):
    requested: int
    deleted: int
    not_found: list[str]


# ── 生成 ─────────────────────────────────────────────────────
class GenerateRequest(BaseModel):
    topic: str = Field(..., min_length=1, description="选题（主题句）")
    article_type: str = Field("depth", description="depth | info")
    requirement: str = Field("", description="额外要求，只会进 user prompt")
    provider: str | None = Field(
        None, description="zhipu（默认，真实调用）| mock（离线假数据，产物不可发布）"
    )
    match_images: bool = Field(True, description="是否用素材库给出配图建议")
    render: bool = Field(True, description="是否同时产出四平台 HTML 预览")
    persist: bool = Field(True, description="是否把草稿写回 articles 表")
    strict: bool = Field(False, description="质检 error 时是否直接返回 422")
    include_html: bool = Field(True, description="响应里是否带 HTML（体积较大）")


class GenerateResponse(BaseModel):
    article_id: str
    persisted: bool
    result: dict


# ── 润色 / 导出 ───────────────────────────────────────────────
class PolishRequest(BaseModel):
    text: str | None = Field(None, description="待润色文本；缺省则取已落库的 content_text")
    platform: str | None = Field(None, description="按某平台调性润色，缺省为通用")
    requirement: str = Field("", description="额外润色要求")
    provider: str | None = Field(None, description="zhipu | mock")
    persist: bool = Field(False, description="是否把润色结果写回 content_text")


class PolishResponse(BaseModel):
    article_id: str
    platform: str | None = None
    persisted: bool
    before_chars: int
    after_chars: int
    polished: str


class ExportResponse(BaseModel):
    article_id: str
    filename: str
    format: str
    char_count: int
    content: str


# ── 追踪 ─────────────────────────────────────────────────────
class TrackingIn(BaseModel):
    article_id: str = Field(..., description="必须是已存在的 articles.article_id")
    platform: str = Field(..., description="平台 key 或中文名（按 platforms.yaml 归一）")
    date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$", description="YYYY-MM-DD")
    title_used: str | None = None
    impress: int = Field(0, ge=0)
    views: int = Field(0, ge=0, description="阅读量")
    likes: int = Field(0, ge=0)
    comments: int = Field(0, ge=0)
    bookmarks: int = Field(0, ge=0)
    pending: int = Field(0, ge=0)
    revenue_cents: int = Field(0, ge=0, description="当日实收收益，单位「分」")


class TrackingOut(BaseModel):
    id: int
    date: str
    article_id: str
    platform: str
    platform_name: str
    title_used: str | None = None
    impress: int
    views: int
    likes: int
    comments: int
    bookmarks: int
    pending: int
    revenue_cents: int


class TrackingWriteResponse(BaseModel):
    created: bool
    item: TrackingOut


class TrackingListResponse(BaseModel):
    returned: int
    items: list[TrackingOut]


# ── 周计划 ───────────────────────────────────────────────────
class WeeklyTaskIn(BaseModel):
    week_start: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$", description="周一日期")
    weekday: int = Field(..., ge=0, le=6, description="0=周一 … 6=周日")
    title: str = Field(..., min_length=1, max_length=200)
    article_id: str | None = None
    platform: str | None = None
    status: str = Field("planned", description="planned/doing/done/skipped")
    note: str | None = None


class WeeklyTaskUpdate(BaseModel):
    week_start: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    weekday: int | None = Field(None, ge=0, le=6)
    title: str | None = Field(None, min_length=1, max_length=200)
    article_id: str | None = None
    platform: str | None = None
    status: str | None = None
    note: str | None = None


class WeeklyTaskOut(BaseModel):
    id: int
    week_start: str
    weekday: int
    title: str
    article_id: str | None = None
    platform: str | None = None
    status: str
    note: str | None = None
    created_at: datetime
    updated_at: datetime


class WeeklyPlanResponse(BaseModel):
    week_start: str | None
    returned: int
    items: list[WeeklyTaskOut]


# ══════════════════════════════════════════════════════════════
# Phase 4 —— 人工发布闭环（Epic 4.1 / M4）
#
# 这一组 schema 的字段命名刻意「不给假成功留话术空间」：
#   · 没有 success 字段 —— 只有明确的 state（pending/published/failed）
#   · confirm 请求必须显式带 confirmed=true，Pydantic 层不给默认真值
# ══════════════════════════════════════════════════════════════


class PublishConfirmRequest(BaseModel):
    platform: str = Field(..., min_length=1, description="平台 key 或中文名（按 platforms.yaml 归一）")
    confirmed: bool = Field(
        False,
        description="必须显式为 true：代表「我本人已经在该平台完成发布」。false/缺省一律拒绝。",
    )
    posted_url: str | None = Field(None, description="发布后的作品链接（可选，填了必须是 http(s)）")
    confirmed_by: str | None = Field(None, max_length=100, description="确认人署名，默认 human")
    note: str | None = Field(None, description="备注")


class PublishFailRequest(BaseModel):
    platform: str = Field(..., min_length=1)
    reason: str = Field(..., min_length=1, description="失败原因，必填 —— 失败也要留痕")


class PlatformStatusOut(BaseModel):
    platform: str
    platform_name: str
    state: str
    state_label: str
    posted_url: str | None = None
    confirmed_at: str | None = None
    confirmed_by: str | None = None
    note: str | None = None


class PublishStatusResponse(BaseModel):
    article_id: str
    article_status: str
    total_platforms: int
    published_count: int
    pending_count: int
    failed_count: int
    all_published: bool
    pending_label: str
    platforms: dict[str, PlatformStatusOut]


class PublishConfirmResponse(BaseModel):
    article_id: str
    platform: PlatformStatusOut
    status: PublishStatusResponse


class PublishPacketsResponse(BaseModel):
    article_id: str
    article_status: str
    pending_label: str
    all_published: bool
    published_count: int
    total_platforms: int
    packets: list[dict[str, Any]]


# ══════════════════════════════════════════════════════════════
# 今日推荐选题（常驻功能）
# ══════════════════════════════════════════════════════════════


class TopicOut(BaseModel):
    id: int
    date: str
    title: str
    topic_type: str
    summary: str = ""
    angle: str = ""
    article_type: str = "depth"
    blacklisted: bool = False
    recommend_count: int = 1
    fresh: bool = True  # 是否今日推荐
    # 爆款策划框架（wechat-viral-topic）产出：命中的「爆款基因」标签 + 为什么能爆
    viral_genes: list[str] = []
    viral_why: str = ""


class TopicTodayResponse(BaseModel):
    date: str
    items: list[TopicOut]
    needs_generation: bool
    blacklisted_count: int = 0


class TopicGenerateResponse(BaseModel):
    date: str
    items: list[TopicOut]
    generated: int


class TopicBlacklistResponse(BaseModel):
    id: int
    blacklisted: bool


class TopicWriteResponse(BaseModel):
    article_id: str
    ok: bool
    titles: dict[str, str]
    qa: dict[str, Any]
