"""今日推荐选题服务（编排层）。

职责：
- 触发生成 5 个选题（走 GenerationService.suggest_topics → LLM，按用户 8 条标准）。
- 去重：近 2 天推荐过 / 已拉黑的选题自动跳过。
- 落库 topic_recommendations，返回今日列表。
- 「用这个写文章」：把选题转成四平台草稿（复用 GenerationService.generate + ArticleRepository.upsert）。

不在此处调用 provider.generate——所有 AI 调用仍收敛在 GenerationService（结构不变）。
"""

from __future__ import annotations

import json
import re

from sqlalchemy.orm import Session

from app.core.settings import settings
from app.models.article import Article, ArticleStatus
from app.models.topic_recommendation import TopicRecommendation
from app.repositories.article_repository import ArticleRepository
from app.repositories.topic_repository import TopicRepository
from app.services.ai import AIConfigError, build_provider
from app.services.ai.generation import GenerationService

# 去重窗口：今日推荐过的，近 N 天内不再推（实现「明天尽量不推」）
DEDUP_DAYS = 2
TOPIC_TYPES = ["一线资讯", "小众剧情", "趣事", "人物生日", "大事记", "常青候选"]

_VALID_ARTICLE_TYPES = ("depth", "info")


def _norm_key(title: str) -> str:
    """归一化选题标题为去重键：去标点、小写、截断。"""
    s = re.sub(r"[^\w一-鿿]", "", (title or "").lower())
    return s[:60]


# 落库前把模型偶发编造的具体数字中和成定性描述（prompt 已严禁，但模型仍偶发）。
# 顺序：先匹配带动词的具体模式，再用「亿/万」兜底，避免硬数字进标题/文章。
_NUM_NEUTRALIZERS: list[tuple[str, str]] = [
    (r"票房突破\d+亿", "票房大爆"),
    (r"突破\d+亿", "大爆"),
    (r"票房\d+亿", "票房大爆"),
    (r"播放量\d+万?", "热度走高"),
    (r"排名(前|第)?\d+", "热度靠前"),
    (r"第\d+集", ""),  # prompt 要求「不知道集数就不写」，出现了就删
    (r"\d+亿", "大爆"),
    (r"\d+万", "走高"),
]


def _neutralize_numbers(s: str) -> str:
    """把编造的具体数字替换成定性描述；无数字则原样返回。"""
    for pat, rep in _NUM_NEUTRALIZERS:
        s = re.sub(pat, rep, s)
    return s


def generate_topics(today: str, session: Session, *, count: int = 5) -> dict:
    """生成并落库今日选题；返回 {date, items, generated}。

    无 AI 密钥时抛 AIConfigError（由路由层转 503，不假装能出选题）。
    """
    provider = build_provider(settings.ai_provider)  # 无密钥 → AIConfigError
    repo = TopicRepository(session)

    recent = repo.list_recent(DEDUP_DAYS)
    recent_keys = {_norm_key(r.title) for r in recent}
    blacklisted = repo.list_blacklisted()
    blacklisted_keys = {_norm_key(b.title) for b in blacklisted}

    svc = GenerationService(provider, session)

    collected: list[dict] = []
    seen_keys: set[str] = set()
    rounds = 0
    while len(collected) < count and rounds < 3:
        rounds += 1
        avoid = [c["title"] for c in collected] + [b.title for b in blacklisted]
        suggestions = svc.suggest_topics(today, count, avoid_titles=avoid, avoid_keys=list(seen_keys))
        for s in suggestions:
            if len(collected) >= count:
                break
            # 模型偶尔仍会写书名号《》：标题/摘要/理由统一剥离，保证展示与去重一致
            clean_title = re.sub(r"[《》]", "", (s.get("title") or "")).strip()
            if not clean_title:
                continue
            # 先按原始标题算去重键（与是否已中和无关），再对入库文本做数字中和
            key = _norm_key(clean_title)
            if key in seen_keys or key in recent_keys or key in blacklisted_keys:
                continue
            seen_keys.add(key)
            s["title"] = _neutralize_numbers(clean_title)
            s["summary"] = _neutralize_numbers(re.sub(r"[《》]", "", (s.get("summary") or "")).strip())
            s["angle"] = _neutralize_numbers(re.sub(r"[《》]", "", (s.get("angle") or "")).strip())
            s["why"] = _neutralize_numbers(re.sub(r"[《》]", "", (s.get("why") or "")).strip())
            collected.append(s)

    persisted: list[TopicRecommendation] = []
    for s in collected:
        key = _norm_key(s["title"])
        existing = repo.get_by_key(key)
        if existing is None:
            obj = TopicRecommendation(
                topic_key=key,
                date=today,
                title=s["title"],
                topic_type=s.get("type") or "常青候选",
                summary=s.get("summary") or "",
                angle=s.get("angle") or "",
                article_type=s.get("article_type") or "depth",
                viral_genes=json.dumps(s.get("genes") or [], ensure_ascii=False),
                viral_why=s.get("why") or "",
                blacklisted=False,
                recommend_count=1,
            )
            repo.add(obj)
            persisted.append(obj)
        else:
            # 历史出现过但已不在去重窗口/未拉黑 → 累计次数 +1，保留原日期
            existing.recommend_count = (existing.recommend_count or 0) + 1
            session.flush()
            persisted.append(existing)

    return {"date": today, "items": persisted, "generated": len(collected)}


def write_topic_article(topic_id: int, session: Session) -> dict:
    """把某个选题写成四平台草稿，返回 {article_id, ok, titles, qa}。

    article_id 固定为 `topic-{id}`，幂等：重复点只更新同一篇草稿，不建重复文章。
    """
    provider = build_provider(settings.ai_provider)  # 无密钥 → AIConfigError
    repo = TopicRepository(session)
    topic = repo.get(topic_id)
    if topic is None:
        raise LookupError(f"选题不存在：{topic_id}")

    article_id = f"topic-{topic.id}"
    svc = GenerationService(provider, session)
    atype = topic.article_type if topic.article_type in _VALID_ARTICLE_TYPES else "depth"
    result = svc.generate(topic.title, article_type=atype, article_id=article_id)

    arepo = ArticleRepository(session)
    arepo.upsert(
        article_id,
        title=result.titles.get("toutiao") or topic.title,
        status=ArticleStatus.DRAFT.value,
        content_text=result.core,
        titles=result.titles,
        contents=result.contents,
        image_sources=result.image_sources,
    )

    return {
        "article_id": article_id,
        "ok": result.ok,
        "titles": result.titles,
        "qa": result.qa_report.to_dict(),
    }
