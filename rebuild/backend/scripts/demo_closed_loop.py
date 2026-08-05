#!/usr/bin/env python
"""内容闭环端到端演示：选题 → 生成 → 配图 → 四平台预览 → 质检 → 落库 → 追踪 → 数据回流。

用法：
    python scripts/demo_closed_loop.py                  # mock 供应商，跑完自动清理演示数据
    python scripts/demo_closed_loop.py --provider zhipu # 真实调智谱（需 .env 里配 ZHIPU_API_KEY）
    python scripts/demo_closed_loop.py --keep           # 保留演示文章/追踪，便于在前端里看
    python scripts/demo_closed_loop.py --out ./var/demo # 顺便把四平台预览 HTML 落地

说明
----
1. 除「AI 供应商」可换成 mock 外，**其余全是生产代码路径**：同一套
   settings/Engine/Repository/GenerationService/ImageMatcherService/RenderService/
   AnalyticsService，配图匹配打的是真实的 825 条素材库。
2. 任何一步失败都直接抛异常并以非零码退出，**不打印「✅ 完成」**（坑 3）。
3. 默认在结束时删除本次写入的演示文章与追踪行，不污染真实数据；`--keep` 可保留。
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.platform_rules import load_registry  # noqa: E402
from app.core.settings import settings  # noqa: E402
from app.db.base import session_scope  # noqa: E402
from app.models.article import ArticleStatus  # noqa: E402
from app.repositories.article_repository import ArticleRepository  # noqa: E402
from app.repositories.material_repository import MaterialRepository  # noqa: E402
from app.repositories.tracking_repository import TrackingRepository  # noqa: E402
from app.services.ai import GenerationService, build_provider  # noqa: E402
from app.services.ai.prompts import system_prompt_fingerprint  # noqa: E402
from app.services.ai.provider import MockProvider  # noqa: E402
from app.services.analytics import AnalyticsService  # noqa: E402

DEMO_ARTICLE_ID = "DEMO-CLOSEDLOOP"
TOPIC = "《仙逆》第147集：王林道心未与雷融，这一集藏了5个细节"

# 演示用「模型输出」。刻意在小红书版里塞了 2 个配图占位符，
# 用来现场证明 platforms.yaml 的「纯文字无图」硬规则确实会被强制执行。
MOCK_PAYLOAD = {
    "core": (
        "核心解析：第147集把王林的道心困境摆到了台面上。前作里他一路强杀，"
        "这一集却在雷劫前停住了——不是打不过，是心里那道坎没过去。"
    ),
    "toutiao": (
        "追《仙逆》三年，这一集我是真的坐直了。\n\n"
        "## 一句台词把前147集都串起来了\n"
        "「道心未与雷融」这六个字出来的时候，弹幕齐刷刷刷屏。它不是随口一句，"
        "是把王林从散修一路走到今天的所有别扭都点破了：他修的是仙道，走的却是人的路。"
        "前面那么多集的隐忍、算计、失去，全压在这一句上。\n\n"
        "【配图1：仙逆_道心未与雷融】\n\n"
        "## 分镜是真的下了功夫\n"
        "夜戏那段光比压得很低，只留一道雷光打在侧脸上。制作组没让他做任何夸张表情，"
        "就是站着，风吹袍角。这种克制在国漫里不多见，大部分作品到这儿都要来段咆哮。"
        "越安静反而越有压迫感，二刷才发现背景音里一直有很轻的心跳声。\n\n"
        "【配图2：仙逆第147集_夜晚_室外】\n\n"
        "## 那个被忽略的环境细节\n"
        "内环的建筑规制和外围完全不同，屋檐的兽首朝向、灯笼的挂法都变了。"
        "这不是随便画的，是在用美术告诉你：他已经踩进另一个阶层了，但心还留在原地。\n\n"
        "【配图3：仙逆第147集_能安然居于内环】\n\n"
        "## 修真家族那条暗线\n"
        "众多修真家族依附凡人国度那一幕只有几秒，却解释了这个世界的秩序是怎么维持的。"
        "上层看着高高在上，根却扎在最普通的凡人堆里。王林的拧巴，本质上就是这个世界的拧巴。\n\n"
        "【配图4：仙逆_众多修真家族依附凡人国度】\n\n"
        "## 我的看法\n"
        "这一集没打大架，却是近二十集里信息密度最高的一集。它在为后面的转折铺路，"
        "把人物的内因交代清楚了，后面再爆发才不会显得突兀。\n\n"
        "【配图5：仙逆第147集_究竟需要什么】\n\n"
        "你们二刷的时候，有没有注意到那个心跳声？评论区聊聊。"
    ),
    "baijia": (
        "## 从第147集看《仙逆》的叙事结构调整\n"
        "本集在整季中承担的是「内因交代」职能，而非推进战斗线。从分集节奏看，"
        "前146集完成了外部世界的铺开，本集则第一次把主角的心理障碍显性化。\n\n"
        "【配图1：仙逆_道心未与雷融】\n\n"
        "## 视听语言：低光比与静态构图\n"
        "夜戏段落采用低光比布光，主光仅由雷光提供，人物保持静态。相较于同类修仙题材"
        "习惯使用的大幅度动作与音效堆叠，本集的处理更接近写实剧集的表达方式。\n\n"
        "【配图2：仙逆第147集_夜晚_室外】\n\n"
        "## 美术设定承担了叙事功能\n"
        "内环与外围在建筑规制上的差异（兽首朝向、灯笼悬挂方式）构成了阶层区隔的视觉标记，"
        "美术设定在此处直接参与叙事，而非仅作背景。\n\n"
        "【配图3：仙逆第147集_能安然居于内环】\n\n"
        "## 世界观补完：依附结构\n"
        "修真家族依附凡人国度的设定，为整个世界的资源循环给出了合理解释，"
        "也为后续势力冲突预留了动机基础。\n\n"
        "【配图4：仙逆_众多修真家族依附凡人国度】\n\n"
        "## 结论\n"
        "本集属于典型的「低事件密度、高信息密度」集数。此类集数在长篇连载动画中往往"
        "承担结构性作用，其价值需放在整季维度评估。\n\n"
        "【配图5：仙逆第147集_究竟需要什么】\n\n"
        "你认为这种慢节奏处理是加分还是拖节奏？欢迎在评论区讨论。"
    ),
    "bilibili": (
        "先问一个问题：147集这种「没打起来」的集数，到底算不算水？\n\n"
        "## 我先说结论：不算\n"
        "「道心未与雷融」这句一出来，弹幕直接炸了。这六个字把王林前面所有的别扭都点破了。\n\n"
        "【配图1：仙逆_道心未与雷融】\n\n"
        "## 但争议点确实存在\n"
        "整集几乎没有动作戏，主角站着的时间比动的时间长。习惯了爽感节奏的观众看这集，"
        "大概率会觉得慢。这个批评我觉得成立，不能因为喜欢就说它没缺点。\n\n"
        "【配图2：仙逆第147集_夜晚_室外】\n\n"
        "## 反方角度也给一下\n"
        "内环那段美术，兽首朝向和灯笼挂法全改了——这种细节没人要求制作组做，做了就是加分。\n\n"
        "【配图3：仙逆第147集_能安然居于内环】\n\n"
        "## 最后一个暴论\n"
        "修真家族依附凡人国度这条设定，比很多集的打戏都值钱。它决定了这个世界立不立得住。\n\n"
        "【配图4：仙逆_众多修真家族依附凡人国度】\n\n"
        "【配图5：仙逆第147集_究竟需要什么】\n\n"
        "所以到底是燃还是水？评论区打个分，我看看大家的分歧有多大。"
    ),
    "xhs": (
        "追了三年\n·\n这一集我坐直了\n·\n"
        "【配图1：仙逆_道心未与雷融】\n"
        "「道心未与雷融」\n六个字\n把王林前147集都串起来了\n·\n"
        "不是打不过\n是心里那道坎没过去\n·\n"
        "【配图2：仙逆第147集_夜晚_室外】\n"
        "夜戏只留一道雷光\n他站着 什么都没说\n·\n"
        "二刷才听见\n背景里一直有心跳声\n·\n"
        "你们发现了吗"
    ),
}

# 演示用追踪数据（明确标注为演示值，不冒充真实运营数据）
DEMO_METRICS = {
    "toutiao": {"impress": 12000, "views": 860, "likes": 24, "comments": 6, "bookmarks": 3},
    "baijia": {"impress": 4200, "views": 310, "likes": 9, "comments": 1, "bookmarks": 2},
    "bilibili": {"impress": 3100, "views": 420, "likes": 31, "comments": 12, "bookmarks": 8},
    "xhs": {"impress": 2600, "views": 540, "likes": 47, "comments": 5, "bookmarks": 19},
}


def stage(index: int, title: str) -> None:
    print(f"\n{'━' * 66}\n【{index}/8】{title}\n{'━' * 66}")


def build_demo_provider(name: str):
    """mock 用固定 payload；其余走真实工厂（密钥缺失会明确报错，不静默降级）。"""
    if name == "mock":
        return MockProvider(json.dumps(MOCK_PAYLOAD, ensure_ascii=False))
    return build_provider(name)


def main() -> int:
    parser = argparse.ArgumentParser(description="国漫内容闭环端到端演示")
    parser.add_argument("--provider", default="mock", help="mock（默认）| zhipu")
    parser.add_argument("--article-id", default=DEMO_ARTICLE_ID)
    parser.add_argument("--topic", default=TOPIC)
    parser.add_argument("--keep", action="store_true", help="保留演示数据（默认结束后清理）")
    parser.add_argument("--out", default="", help="把四平台预览 HTML 写到该目录")
    args = parser.parse_args()

    registry = load_registry()
    article_id = args.article_id

    with session_scope() as session:
        # ── 0. 环境自检 ───────────────────────────────────────
        stage(0, "环境自检")
        materials = MaterialRepository(session).count()
        print(f"数据源      : {settings.database_url}")
        print(f"平台规则源  : {registry.source_path}（{len(registry.keys())} 个平台）")
        print(f"素材库      : {materials} 条")
        print(f"AI 供应商   : {args.provider}"
              f"（ZHIPU_API_KEY {'已配置' if settings.zhipu_api_key_configured else '未配置'}）")
        print(f"人设指纹    : {system_prompt_fingerprint()}")
        if materials == 0:
            print("⚠️  素材库为空，配图建议只会给出「无匹配」——先跑 scripts/index_archive_materials.py")

        # ── 1. 选题 ───────────────────────────────────────────
        stage(1, "选题")
        print(f"选题：{args.topic}（{len(args.topic)} 字）")
        articles = ArticleRepository(session)
        _, created = articles.upsert(
            article_id,
            title=args.topic,
            status=ArticleStatus.DRAFT.value,
        )
        print(f"文章记录：{article_id}（{'新建' if created else '复用已有'}）")

        # ── 2. AI 生成 ────────────────────────────────────────
        stage(2, "AI 生成四平台内容")
        provider = build_demo_provider(args.provider)
        service = GenerationService(provider, session, registry=registry)
        result = service.generate(args.topic, article_type="depth", article_id=article_id)
        print(f"供应商 {result.provider} / 人设指纹 {result.system_prompt_fingerprint}"
              f" / 埋点 {result.telemetry}")
        for key in registry.keys():
            rule = registry.get(key)
            print(f"  {rule.name:<6} 标题 {len(result.titles[key]):>2} 字"
                  f"（上限 {rule.title.max_chars}）｜正文 {len(result.contents[key]):>4} 字"
                  f"｜{result.titles[key]}")
        if result.enforcements:
            print("规则强制执行：")
            for note in result.enforcements:
                print(f"  · {note}")

        # ── 3. 配图建议 ───────────────────────────────────────
        stage(3, "配图建议（复用素材匹配服务）")
        matched = [s for s in result.image_suggestions if s.matched]
        print(f"占位符 {len(result.image_suggestions)} 个，命中素材 {len(matched)} 个")
        for s in result.image_suggestions:
            flag = "✅" if s.matched else "⬜"
            detail = f"{s.stem}（score {s.score}，{s.reason}）" if s.matched else s.reason
            print(f"  {flag} 配图{s.index}：{s.description} → {detail}")

        # ── 4. 四平台预览 ─────────────────────────────────────
        stage(4, "四平台预览（复用渲染服务）")
        out_dir = Path(args.out).resolve() if args.out else None
        if out_dir:
            out_dir.mkdir(parents=True, exist_ok=True)
        for key in registry.keys():
            render = result.renders[key]
            notes = []
            if render.missing_images:
                notes.append(f"缺图 {len(render.missing_images)} 处")
            notes.extend(render.warnings)
            note = f"  ⚠️ {'；'.join(notes)}" if notes else ""
            print(f"  {render.platform_name:<6} HTML {len(render.html):>6} 字节"
                  f"｜正文 {render.char_count:>4} 字｜配图 {render.image_count} 张{note}")
            if out_dir:
                path = out_dir / f"{article_id}_{key}.html"
                path.write_text(render.html, encoding="utf-8")
        if out_dir:
            print(f"预览已写入：{out_dir}")

        # ── 5. 质检 ───────────────────────────────────────────
        stage(5, "发布前质检（规则源 platforms.yaml）")
        report = result.qa_report
        print(f"结论：{'通过' if report.ok else '未通过'}"
              f"（error {len(report.errors)} / warning {len(report.warnings)}）")
        for line in report.to_lines():
            print(line)
        if not report.ok:
            # 质检不过不算闭环成功，明确失败退出
            raise SystemExit("❌ 质检未通过，闭环中止（不会把不合格内容标成成功）")

        # ── 6. 落库草稿 ───────────────────────────────────────
        stage(6, "落库为草稿")
        article, _ = articles.upsert(
            article_id,
            title=result.titles["toutiao"],
            status=ArticleStatus.DRAFT.value,
            content_text=result.core,
            titles=result.titles,
            contents=result.contents,
            image_sources=result.image_sources,
        )
        session.flush()
        print(f"已保存：id={article.id} article_id={article.article_id}"
              f" status={article.status} 四平台内容 {len(article.contents or {})} 份")

        # ── 7. 发布后数据追踪 ─────────────────────────────────
        stage(7, "发布后数据追踪录入")
        day = (date.today() - timedelta(days=1)).isoformat()
        tracking = TrackingRepository(session)
        for key, metrics in DEMO_METRICS.items():
            _, is_new = tracking.upsert(
                date=day,
                article_id=article_id,
                platform=key,
                title_used=result.titles[key],
                **metrics,
            )
            print(f"  {registry.get(key).name:<6} {day} "
                  f"曝光 {metrics['impress']:>6} 阅读 {metrics['views']:>5} "
                  f"赞 {metrics['likes']:>3} 评 {metrics['comments']:>3} 藏 {metrics['bookmarks']:>3}"
                  f"  [{'新增' if is_new else '更新'}]")

        # ── 8. 数据回流 ───────────────────────────────────────
        stage(8, "数据回流（KPI 看板，指导下一轮选题）")
        kpi = AnalyticsService(session, registry=registry).kpi()
        reads, eng, rev, proxy = (
            kpi["reads"], kpi["engagement"], kpi["revenue"], kpi["xhs_follower_proxy"],
        )
        rate = "暂无数据" if eng["avg_rate"] is None else f"{eng['avg_rate'] * 100:.2f}%"
        print(f"文章总数    : {kpi['articles']['total']}（{kpi['articles']['by_status']}）")
        print(f"阅读        : {reads['total_views']}（曝光 {reads['total_impress']}，"
              f"{reads['tracking_rows']} 条追踪）")
        print(f"互动        : {eng['total']}（赞 {eng['likes']} 评 {eng['comments']} "
              f"藏 {eng['bookmarks']}），互动率 {rate}")
        print(f"小红书涨粉  : 代理值 {proxy['value']}（{proxy['basis']}），"
              f"真实粉丝数 {proxy['real_follower_count']}")
        print(f"              {proxy['note']}")
        print(f"收益        : 已记录 {rev['recorded_cents']} 分，预估 {rev['estimated_cents']} 分")
        print(f"              {rev['note']}")

        # ── 清理 ──────────────────────────────────────────────
        if args.keep:
            print(f"\n--keep：演示数据保留在库中（article_id={article_id}）")
        else:
            for row in tracking.list_by_article(article_id):
                tracking.delete(row)
            articles.delete(article)
            print(f"\n已清理演示数据（article_id={article_id}）；加 --keep 可保留")

    print(f"\n{'━' * 66}")
    print("✅ 闭环跑通：选题 → 生成 → 配图 → 预览 → 质检 → 落库 → 追踪 → 回流")
    print(f"{'━' * 66}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
