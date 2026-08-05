"""文章管理 + AI 生成（Epic 2.2）。

`POST /articles/{article_id}/generate` 是内容闭环的入口：
    选题 → 生成 → 配图建议 → 四平台预览 → （可选）落库为草稿。

错误一律显式：AI 未配置 → 503；AI 限流/失败 → 502（带 attempts/retryable）；
质检不过且 strict=True → 422（带完整 issues）。绝不返回「看起来成功」的空壳。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.schemas import (
    ArticleCreate,
    ArticleListResponse,
    ArticleOut,
    ArticleUpdate,
    GenerateRequest,
    GenerateResponse,
)
from app.core.settings import settings
from app.db.base import get_session
from app.models.article import Article, ArticleStatus
from app.repositories.article_repository import ArticleRepository
from app.services import qa
from app.services.ai import (
    AIConfigError,
    AIProviderError,
    GenerationError,
    GenerationService,
    build_provider,
)

router = APIRouter(tags=["articles"])

VALID_STATUS = tuple(s.value for s in ArticleStatus)


def _to_out(article: Article) -> ArticleOut:
    return ArticleOut(
        id=article.id,
        article_id=article.article_id,
        title=article.title,
        status=article.status,
        folder_name=article.folder_name,
        content_text=article.content_text,
        titles=article.titles,
        contents=article.contents,
        image_sources=article.image_sources,
        publish_schedule=article.publish_schedule,
        created_at=article.created_at,
        updated_at=article.updated_at,
    )


def _check_status(status: str | None) -> None:
    if status is not None and status not in VALID_STATUS:
        raise HTTPException(422, f"未知状态 {status!r}，可选：{list(VALID_STATUS)}")


def _get_or_404(repo: ArticleRepository, article_id: str) -> Article:
    article = repo.get_by_article_id(article_id)
    if article is None:
        raise HTTPException(404, f"文章不存在：{article_id}")
    return article


# ── CRUD ─────────────────────────────────────────────────────
@router.get("/articles", response_model=ArticleListResponse)
def list_articles(
    status: str | None = Query(None, description="draft/pending/published/failed/deleted"),
    keyword: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
) -> ArticleListResponse:
    _check_status(status)
    repo = ArticleRepository(session)
    items = repo.list(status=status, keyword=keyword, limit=limit, offset=offset)
    by_status = repo.count_by_status()
    return ArticleListResponse(
        total=sum(v for k, v in by_status.items() if k != ArticleStatus.DELETED.value),
        returned=len(items),
        by_status=by_status,
        items=[_to_out(a) for a in items],
    )


@router.post("/articles", response_model=ArticleOut, status_code=201)
def create_article(
    payload: ArticleCreate, session: Session = Depends(get_session)
) -> ArticleOut:
    _check_status(payload.status)
    repo = ArticleRepository(session)
    if repo.get_by_article_id(payload.article_id) is not None:
        # 已存在就明确冲突，不做「悄悄覆盖」
        raise HTTPException(409, f"article_id 已存在：{payload.article_id}")
    article = repo.add(Article(**payload.model_dump()))
    return _to_out(article)


@router.get("/articles/{article_id}", response_model=ArticleOut)
def get_article(article_id: str, session: Session = Depends(get_session)) -> ArticleOut:
    return _to_out(_get_or_404(ArticleRepository(session), article_id))


@router.patch("/articles/{article_id}", response_model=ArticleOut)
def update_article(
    article_id: str, payload: ArticleUpdate, session: Session = Depends(get_session)
) -> ArticleOut:
    _check_status(payload.status)
    repo = ArticleRepository(session)
    article = _get_or_404(repo, article_id)
    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(422, "没有任何待更新字段")
    for key, value in fields.items():
        setattr(article, key, value)
    session.flush()
    return _to_out(article)


# ── 生成（闭环入口）───────────────────────────────────────────
@router.post("/articles/{article_id}/generate", response_model=GenerateResponse)
def generate_article(
    article_id: str, payload: GenerateRequest, session: Session = Depends(get_session)
) -> GenerateResponse:
    provider_name = payload.provider or settings.ai_provider
    try:
        provider = build_provider(provider_name)
    except AIConfigError as exc:
        # 密钥缺失 = 服务不可用，明确 503；不退化成 mock 假装能写稿
        raise HTTPException(503, exc.to_dict()) from exc

    service = GenerationService(provider, session)
    try:
        result = service.generate(
            payload.topic,
            article_type=payload.article_type,
            requirement=payload.requirement,
            article_id=article_id,
            match_images=payload.match_images,
            render=payload.render,
        )
    except GenerationError as exc:
        raise HTTPException(422, exc.to_dict()) from exc
    except AIProviderError as exc:
        raise HTTPException(502, exc.to_dict()) from exc

    if payload.strict and not result.ok:
        raise HTTPException(422, {"stage": "qa", **result.qa_report.to_dict()})

    persisted = False
    if payload.persist:
        repo = ArticleRepository(session)
        repo.upsert(
            article_id,
            title=result.titles.get("toutiao") or result.topic,
            status=ArticleStatus.DRAFT.value,
            content_text=result.core,
            titles=result.titles,
            contents=result.contents,
            image_sources=result.image_sources,
        )
        persisted = True

    return GenerateResponse(
        article_id=article_id,
        persisted=persisted,
        result=result.to_dict(include_html=payload.include_html),
    )


# ── 单独质检（不调 AI）────────────────────────────────────────
@router.post("/articles/{article_id}/qa")
def qa_article(article_id: str, session: Session = Depends(get_session)) -> dict:
    """对已落库的四平台内容跑一次质检，规则全部来自 platforms.yaml。"""
    article = _get_or_404(ArticleRepository(session), article_id)
    report = qa.quality_check(
        article.titles or {}, article.contents or {}, article.image_sources or {}
    )
    return {"article_id": article_id, **report.to_dict()}
