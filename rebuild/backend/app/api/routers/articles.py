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
    ExportResponse,
    GenerateRequest,
    GenerateResponse,
    ImageBindRequest,
    ImageBindResponse,
    PolishRequest,
    PolishResponse,
)
from app.core.platform_rules import PlatformRulesError, load_registry
from app.core.settings import settings
from app.db.base import get_session
from app.models.article import Article, ArticleStatus
from app.repositories.article_repository import ArticleRepository
from app.repositories.material_repository import MaterialRepository
from app.services.image_matching.matcher import ImageMatcherService
from app.services import qa
from app.services.ai import (
    AIConfigError,
    AIProviderError,
    GenerationError,
    GenerationService,
    build_provider,
)
from app.services.ai.prompts import SYSTEM_PROMPT

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


# ── 润色（走 AI，失败即显式报错）──────────────────────────────
POLISH_INSTRUCTION = """请对下面这段国漫自媒体稿件做润色，只做「润色」不做「改写选题」：

硬性要求：
1. 保留全部事实、数据、角色名、集数，禁止新增任何未出现的事实。
2. 保留全部 【配图N：作品名_用途】 占位符，位置可微调，不可删改文字。
3. 去 AI 味：少用工整排比、少堆形容词，保留口语节奏和「人」的呼吸感。
4. 标题里不出现书名号《》。
5. 结尾保留或补上一句互动引导。
6. 直接输出润色后的正文全文，不要任何解释、前言或 Markdown 代码块包裹。
"""


@router.post("/articles/{article_id}/polish", response_model=PolishResponse)
def polish_article(
    article_id: str, payload: PolishRequest, session: Session = Depends(get_session)
) -> PolishResponse:
    repo = ArticleRepository(session)
    article = _get_or_404(repo, article_id)

    source_text = (payload.text or article.content_text or "").strip()
    if not source_text:
        raise HTTPException(
            422,
            {"code": "NOTHING_TO_POLISH", "message": "既没传 text，文章也没有 content_text"},
        )

    platform_hint = ""
    if payload.platform:
        try:
            key = load_registry().normalize_platform(payload.platform)
            rules = load_registry().get(key)
            platform_hint = (
                f"\n目标平台：{rules.name}"
                f"（标题上限 {rules.title.max_chars} 字，正文目标 {rules.body.target_chars} 字）"
            )
        except PlatformRulesError as exc:
            raise HTTPException(422, str(exc)) from exc

    provider_name = payload.provider or settings.ai_provider
    try:
        provider = build_provider(provider_name)
    except AIConfigError as exc:
        raise HTTPException(503, exc.to_dict()) from exc

    extra = f"\n额外要求：{payload.requirement}" if payload.requirement.strip() else ""
    from app.services.ai.style_rules import STYLE_GUIDE

    user_prompt = f"{POLISH_INSTRUCTION}{platform_hint}{extra}\n{STYLE_GUIDE}\n\n---\n{source_text}"

    try:
        polished = provider.generate(
            SYSTEM_PROMPT,
            user_prompt,
            max_tokens=settings.ai_max_tokens,
            temperature=settings.ai_temperature,
        ).strip()
    except AIProviderError as exc:
        raise HTTPException(502, exc.to_dict()) from exc

    if not polished:
        raise HTTPException(
            502, {"code": "EMPTY_POLISH_RESULT", "message": "模型返回空内容，未做任何写入"}
        )

    persisted = False
    if payload.persist:
        article.content_text = polished
        session.flush()
        persisted = True

    return PolishResponse(
        article_id=article_id,
        platform=payload.platform,
        persisted=persisted,
        before_chars=len(source_text),
        after_chars=len(polished),
        polished=polished,
    )


# ── 导出（纯本地拼装，不调 AI）────────────────────────────────
@router.get("/articles/{article_id}/export", response_model=ExportResponse)
@router.post("/articles/{article_id}/export", response_model=ExportResponse)
def export_article(
    article_id: str,
    platform: str | None = Query(None, description="只导出某平台版本；缺省导出全平台合集"),
    session: Session = Depends(get_session),
) -> ExportResponse:
    article = _get_or_404(ArticleRepository(session), article_id)
    registry = load_registry()

    titles = article.titles or {}
    contents = article.contents or {}

    keys: list[str]
    if platform:
        try:
            keys = [registry.normalize_platform(platform)]
        except PlatformRulesError as exc:
            raise HTTPException(422, str(exc)) from exc
    else:
        keys = [k for k in registry.keys() if k in contents] or list(contents.keys())

    lines: list[str] = [f"# {article.title}", "", f"- article_id: {article.article_id}",
                        f"- status: {article.status}", f"- 导出时间: {article.updated_at}", ""]

    if not keys:
        core = (article.content_text or "").strip()
        if not core:
            raise HTTPException(
                422,
                {"code": "NOTHING_TO_EXPORT", "message": "该文章既无四平台内容也无 content_text"},
            )
        lines += ["## 正文（未分平台）", "", core, ""]
    else:
        for key in keys:
            name = registry.get(key).name if key in registry.keys() else key
            lines += [
                f"## {name}",
                "",
                f"**标题**：{titles.get(key, article.title)}",
                "",
                (contents.get(key) or "（该平台暂无内容）").strip(),
                "",
                "---",
                "",
            ]

    body = "\n".join(lines).rstrip() + "\n"
    suffix = f"_{keys[0]}" if platform and keys else ""
    return ExportResponse(
        article_id=article_id,
        filename=f"{article.article_id}{suffix}.md",
        format="md",
        char_count=len(body),
        content=body,
    )


@router.post("/articles/{article_id}/bind-image", response_model=ImageBindResponse)
def bind_image(
    article_id: str,
    payload: ImageBindRequest,
    session: Session = Depends(get_session),
) -> ImageBindResponse:
    """手动把某张素材绑定到文章里的配图占位符。

    - 写入 article.image_sources[placeholder] = material.path（落库，重载后仍在）
    - 返回该素材的可访问 url，前端 Writer 预览据此显示真图
    与自动匹配互补：自动匹配靠文件名，这里让用户显式指定，避免「匹配错图」。
    """
    repo = ArticleRepository(session)
    article = _get_or_404(repo, article_id)
    mat = MaterialRepository(session).get(payload.material_id)
    if mat is None:
        raise HTTPException(
            404,
            {"code": "MATERIAL_NOT_FOUND", "message": "素材不存在"},
        )
    sources = dict(article.image_sources or {})
    sources[payload.placeholder] = mat.path
    article.image_sources = sources
    session.flush()
    return ImageBindResponse(
        placeholder=payload.placeholder,
        url=ImageMatcherService.build_url(mat),
    )
