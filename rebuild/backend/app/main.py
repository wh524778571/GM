"""FastAPI 服务入口（Phase 1 + Phase 2）。

Phase 1：
    1. /health                健康检查（含数据库连通性、平台规则、素材数量）
    2. /render/*              一份内容 → 四平台差异化 HTML
    3. /materials, /materials/search  素材列表 / 模糊检索

Phase 2（内容闭环，见 app/api/routers/）：
    4. /articles*             文章 CRUD + AI 四平台生成 + 质检
    5. /tracking              平台数据追踪写入 / 查询
    6. /analytics*            数据看板（KPI / 明细汇总）

Phase 4（人工发布闭环）：
    7. /articles/{id}/publish/*  四平台发布包 / 状态 / 人工确认 / 失败登记

原则：绝不静默成功（坑 3）。渲染缺图、规则越界一律以 warnings/missing_images
返回；AI 未配置/失败一律显式 5xx；数据库不可用时 /health 返回 database_ok=false；
发布状态在人显式确认前恒为 pending（待人工发布），系统不做任何自动发布。
"""

from __future__ import annotations

from dataclasses import asdict

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.api.schemas import (
    HealthResponse,
    MaterialListResponse,
    MaterialOut,
    MaterialSearchHit,
    MaterialSearchResponse,
    RenderAllResponse,
    RenderOut,
    RenderRequest,
)
from app.api.routers import ROUTERS
from app.core.platform_rules import PlatformRulesError, load_registry
from app.core.settings import settings
from app.db.base import get_session
from app.models.material import Material
from app.repositories.material_repository import MaterialRepository
from app.services.ai.prompts import system_prompt_fingerprint
from app.services.image_matching.matcher import ImageMatcherService, cache_stats
from app.services.rendering import RenderResult, RenderService
from app.services.text_utils import extract_guoman_keywords, extract_keywords

app = FastAPI(
    title="国漫笔记 · 内容生产后端",
    version="0.4.0",
    description=(
        "Phase 1：数据层 + 四平台渲染 + 配图匹配；Phase 2：AI 生成 + 内容闭环；"
        "Phase 4：人工发布闭环（绝不自动发布、绝不静默成功）"
    ),
)

# 坑 1 防护：路由集中注册，不存在「写了端点忘了挂」
for _router in ROUTERS:
    app.include_router(_router)

# 开发环境表保证：新增表（如 topic_recommendations）在 import 时幂等创建；
# 生产由 alembic 管理（见 alembic/versions），此处对已存在的表无副作用。
from app.db.base import Base, engine  # noqa: E402

Base.metadata.create_all(engine)

# ── 素材图片静态服务 ──────────────────────────────────────────
# MaterialOut.url / 渲染 <img src> 都指向 IMG_BASE_URL（默认 /images）。
# 只有 MATERIALS_ROOT 真实存在时才挂载，否则保持 404——不做「看起来能出图」的假象。
if settings.materials_root and settings.materials_root.is_dir():
    app.mount(
        settings.img_base_url if settings.img_base_url.startswith("/") else "/images",
        StaticFiles(directory=settings.materials_root),
        name="images",
    )

SAMPLE_ARTICLE = """# 凡人修仙传第 177 集：韩立终于亮出底牌

《凡人修仙传》最新一集播出后，弹幕直接刷爆了。这一集的信息量，
可以说是整个乱星海篇章里最密集的一集。

【配图1：凡人修仙传第177集_12分00秒】

## 一、剧情：憋了三十集的伏笔终于收网

前面铺垫了很久的线索，在这一集里被一次性揭开。节奏没有拖沓，
该给的交代都给了，这在长篇国漫里其实挺难得。

## 二、画面：打戏调度明显升级

- 镜头语言更克制，不再靠慢放凑时长
- 粒子特效收敛了，反而更有质感
- 场景光影层次拉满

【配图2：凡人修仙传第177集_13分00秒】

> 这一集之后，国漫的打戏标准应该会被重新定义。

## 三、争议：配音与节奏

也有观众觉得后半段收得太急。这个批评不算苛刻，但整体瑕不掩瑜。

**总的来说，这是本季度最值得二刷的一集。**

📷 **配图清单**
- 配图1：第177集关键帧
- 配图2：打戏名场面

*@Yolo 国漫笔记*
"""


def _to_render_out(result: RenderResult) -> RenderOut:
    return RenderOut(
        platform=result.platform,
        platform_name=result.platform_name,
        html=result.html,
        char_count=result.char_count,
        image_count=result.image_count,
        ok=result.ok,
        missing_images=[asdict(m) for m in result.missing_images],
        warnings=result.warnings,
    )


def _render_payload(
    content: str, session: Session, *, article_id: str | None, cache_key: str, match_images: bool
) -> RenderAllResponse:
    resolver = None
    if match_images:
        resolver = ImageMatcherService(session).resolver(article_id=article_id)
    try:
        results = RenderService(image_resolver=resolver).render_all(content, cache_key=cache_key)
    except PlatformRulesError as exc:  # 规则缺失属于硬错误，不吞
        raise HTTPException(status_code=500, detail=f"平台规则加载失败：{exc}") from exc

    return RenderAllResponse(
        cache_key=cache_key,
        all_ok=all(r.ok for r in results.values()),
        distinct_html=len({r.html for r in results.values()}),
        results={k: _to_render_out(v) for k, v in results.items()},
    )


# ── 健康检查 ──────────────────────────────────────────────────
@app.get("/health", response_model=HealthResponse)
def health(session: Session = Depends(get_session)) -> HealthResponse:
    database_ok = True
    material_count = 0
    try:
        session.execute(text("SELECT 1"))
        material_count = session.scalar(select(func.count()).select_from(Material)) or 0
    except Exception:
        database_ok = False

    registry = load_registry()
    return HealthResponse(
        status="ok" if database_ok else "degraded",
        app_env=settings.app_env,
        database=settings.database_url,
        database_ok=database_ok,
        platforms=list(registry.keys()),
        material_count=material_count,
        zhipu_api_key_configured=settings.zhipu_api_key_configured,
        ai_provider=settings.ai_provider,
        # 人设指纹：产物与服务端的 SYSTEM_PROMPT 版本可对账，改动一眼可见
        system_prompt_fingerprint=system_prompt_fingerprint(),
    )


@app.get("/platforms")
def platforms() -> dict:
    """平台规则的唯一权威来源（config/platforms.yaml）。"""
    registry = load_registry()
    return {
        "source": str(settings.platforms_config_path),
        "platforms": {
            key: {
                "name": registry.get(key).name,
                "title_max": registry.get(key).title.max_chars,
                "body_target": registry.get(key).body.target_chars,
                "body_max": registry.get(key).body.max_chars,
                "images_allowed": registry.get(key).images.allowed,
            }
            for key in registry.keys()
        },
    }


# ── 渲染 ─────────────────────────────────────────────────────
@app.get("/render/sample", response_model=RenderAllResponse)
def render_sample(
    match_images: bool = Query(True, description="是否用素材库自动配图"),
    session: Session = Depends(get_session),
) -> RenderAllResponse:
    """把内置样例文章渲染成四个平台的 HTML。"""
    return _render_payload(
        SAMPLE_ARTICLE,
        session,
        article_id=None,
        cache_key="sample",
        match_images=match_images,
    )


@app.post("/render", response_model=RenderAllResponse)
def render(payload: RenderRequest, session: Session = Depends(get_session)) -> RenderAllResponse:
    if not payload.content.strip():
        raise HTTPException(status_code=422, detail="content 不能为空")
    return _render_payload(
        payload.content,
        session,
        article_id=payload.article_id,
        cache_key=payload.cache_key or payload.article_id or "adhoc",
        match_images=payload.match_images,
    )


# ── 素材 ─────────────────────────────────────────────────────
@app.get("/materials", response_model=MaterialListResponse)
def list_materials(
    work: str | None = None,
    source: str | None = None,
    article_id: str | None = None,
    keyword: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
) -> MaterialListResponse:
    repo = MaterialRepository(session)
    items = repo.list(
        work=work,
        source=source,
        article_id=article_id,
        keyword=keyword,
        limit=limit,
        offset=offset,
    )
    return MaterialListResponse(
        total_indexed=session.scalar(select(func.count()).select_from(Material)) or 0,
        returned=len(items),
        items=[
            MaterialOut(
                id=m.id,
                path=m.path,
                filename=m.filename,
                stem=m.stem,
                source=m.source,
                work=m.work,
                episode=m.episode,
                scene=m.scene,
                kind=m.kind,
                article_id=m.article_id,
                tags=m.tags,
                width=m.width,
                height=m.height,
                size_bytes=m.size_bytes,
                url=ImageMatcherService.build_url(m),
            )
            for m in items
        ],
    )


@app.get("/materials/search", response_model=MaterialSearchResponse)
def search_materials(
    q: str = Query(..., min_length=1, description="主题或配图描述"),
    limit: int = Query(5, ge=1, le=50),
    exclude_article_id: str | None = None,
    include_recycle: bool = True,
    session: Session = Depends(get_session),
) -> MaterialSearchResponse:
    keywords = extract_guoman_keywords(q) or extract_keywords(q)
    hits = ImageMatcherService(session).search(
        keywords,
        exclude_article_id=exclude_article_id,
        include_recycle=include_recycle,
        limit=limit,
    )
    return MaterialSearchResponse(
        query=q,
        keywords=keywords,
        hits=[MaterialSearchHit(**asdict(h)) for h in hits],
    )


@app.get("/materials/works")
def material_works(session: Session = Depends(get_session)) -> dict:
    return {"works": [{"work": w, "count": c} for w, c in MaterialRepository(session).works()]}


@app.get("/debug/cache")
def debug_cache() -> dict:
    """配图三级缓存状态（内存 → 磁盘 → 重建），便于排查命中来源。"""
    return cache_stats()
