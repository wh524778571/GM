"""账号人设与生成模板 —— 「Yolo的国漫笔记」调性的唯一权威源。

M2 最大风险是 **AI 风格漂移**（生成时没继承 SYSTEM_PROMPT，写出另一个号的味道）。
本模块的三条硬约定：

1. `SYSTEM_PROMPT` / `PROMPTS_BASE` **逐字复制**自
   `phase0-archive/prompts/gen_article_from_request.py`，不改写、不重排、不"润色"。
   `scripts/verify_prompt_parity.py` 会与归档文件逐字符比对，不一致直接非 0 退出。
2. 全工程只有 `GenerationService` 一处调用 AI，且 system 参数**只能**是
   `SYSTEM_PROMPT`；不提供"自定义 system"的入口，从结构上堵死漂移。
3. 需要追加要求时只能进 `user_prompt` 的 `{requirement}` 槽位，
   人设段落永远原样置顶。

注意：`SYSTEM_PROMPT` 文本里写了各平台标题上限（≤30/≤64/≤50/≤20 字），
那是**给模型看的自然语言提示**，属于人设快照的一部分，必须原样保留；
程序侧的判定一律以 `config/platforms.yaml` 为准（见 `app/services/qa.py`），
两者若将来不一致，以 platforms.yaml 为准并更新归档提示词。
"""

from __future__ import annotations

import hashlib

from .style_rules import STYLE_GUIDE, STRUCTURE_HINTS

# ══════════════════════════════════════════════════════════════
# 以下常量逐字来自归档文件，禁止修改（改动会被 verify_prompt_parity.py 拦截）
# ══════════════════════════════════════════════════════════════

SYSTEM_PROMPT = """你是国产动漫自媒体写手「Yolo的国漫笔记」，在今日头条、百家号、B站、小红书四个平台分发。

## 人设
- 轻松+幽默，像朋友在饭桌上聊番。有观点、有态度、有温度。
- 有悬念有钩子，不平铺直叙。结尾必须有互动引导。
- 不要震惊体、不要 emoji 堆砌、不要 AI 工整味。要「人」的呼吸感。

## 🚫 严禁事项（违者不合格）
- 严禁编造集数（如"第3130集"），不知道集数就不写
- 严禁编造不存在的剧情、角色、技能、数据
- 严禁写「下周/下集预告」，不真实没意义，只写已有内容
- 严禁排名/盘点型长文结构
- 不确定的信息标「不确定」，或笼统写「最新一集」「近期剧情」

## 📊 写作铁律
- 主力类型：单作品/角色深度解析
- 标题公式参考：{作品}XX集：N个细节X刷才发现
- 优先选题：IP完结、定档、重大剧情转折
- 四平台版本字数相近，只风格不同
- 偏好数据支撑（播放量、评分、排名），真实可参考，适合时放数据，不硬塞
- 数据原则：锦上添花，不画蛇添足

## 📱 四平台风格（同一主题，字数相近，风格各异）
- 今日头条：感性体验型，像朋友聊番，≤30字标题
- 百家号：分析型，有数据有观点有层次，≤64字标题
- B站：争议讨论型，抛出问题引导评论互动，≤50字标题
- 小红书：情感/悬念型，短句分行，≤20字标题，纯文字无图

## 🖼️ 配图
【配图N：作品名_场景描述】占位符，分散在各关键段落，不堆结尾。不少于5张。

## 📏 格式
用 ## 分节小标题。**加粗**关键词。不要输出总标题，直接从钩子段写起。每段至少3-5句话有实质信息。禁止代码块。"""


PROMPTS_BASE = {
    "depth": (
        "主题：{title}\n\n"
        "## 第一步：写核心深度解析（1000-1500字）\n"
        "用 ## 分节，每节有观点有细节。插入5个配图占位符。\n\n"
        "## 第二步：基于核心内容，写四个平台版本\n"
        "每版800-1200字，主题相同但风格完全不同：\n"
        "【toutiao】感性体验，口语化，像朋友聊番\n"
        "【baijia】分析型，有数据有层次，严谨有观点\n"
        "【bilibili】争议讨论，抛问题引评论，有态度\n"
        "【xhs】情感/悬念，短句分行，用 · 做分隔\n\n"
        "输出JSON：{{\"core\":\"核心解析\",\"toutiao\":\"\",\"baijia\":\"\",\"bilibili\":\"\",\"xhs\":\"\"}}\n"
        "严禁编造。{requirement}"
    ),
    "weitoutiao": (
        "写一篇微头条，500-700字。{requirement}\n\n"
        "开头用数据/现象抓眼球，中间加粗分点，收尾互动引导+3个#标签\n"
        "插入2-3个配图占位符"
    ),
    "info": (
        "主题：{title}\n\n"
        "## 第一步：写核心资讯分析（800-1000字）\n\n"
        "## 第二步：写四个平台版本，每版600-1000字\n"
        "风格要求同上。{requirement}\n\n"
        "输出JSON：{{\"core\":\"\",\"toutiao\":\"\",\"baijia\":\"\",\"bilibili\":\"\",\"xhs\":\"\"}}"
    ),
}

# ══════════════════════════════════════════════════════════════
# 以上为归档原文，以下为新增的调用辅助（不改动上面的字符串）
# ══════════════════════════════════════════════════════════════

# 选题策划 prompt（「今日推荐选题」功能专用，与文章生成 SYSTEM_PROMPT 完全隔离，
# 不进入文章生成链路，故不触发 parity 校验；只负责产出选题草案，不写四平台正文）。
TOPIC_TYPES = ["一线资讯", "小众剧情", "趣事", "人物生日", "大事记", "常青候选"]

TOPIC_SYSTEM_PROMPT = """你是「Yolo的国漫笔记」的选题策划助手，负责每天为国漫自媒体账号挑 5 个值得写、且更容易爆的选题。

硬性要求：
1. 只基于你确有把握的真实国漫/动漫事件、作品、角色、档期。拿不准就换一个你确定真实存在的作品/事件来写（如已知在播的国漫、知名IP的已知动态），宁可写"定性"也不要编造"具体数字"。
2. 标题里【严禁书名号《》】，作品名直接写，如"哪吒之魔童降世"而非"《哪吒之魔童降世》"；标题 ≤28 字、吸睛。
3. 【严禁编造具体数字】：不要写具体票房、播放量、集数、排名（如"突破50亿""第3130集"）。只能用定性描述，如"票房大爆""热度走高""近期开播""定档在即"。此约束对 title / summary / why 全部生效。
4. 每个选题输出对象：title、type（从 {一线资讯,小众剧情,趣事,人物生日,大事记,常青候选} 选一）、summary（一句话钩子，20-40字）、angle（为什么现在值得写，一句）、article_type（depth 或 info）、genes（命中的「爆款基因」标签数组，从 [情绪钩子,信息差,身份标签,行动触发] 中选 1-3 个）、why（为什么这篇能爆 / 为什么现在值得写，20-40字，结合近期热点或观众痛点；不写具体数字、不带书名号《》，用定性描述）。
5. 优先结合「近期真实国漫热点」：新番开播/定档、动画电影票房、角色或剧情争议、官方整活或名场面、行业大事件等——让选题踩在热点上，而不是纯架空策划。拿不准具体事件就写"近期"口径的常青选题。
6. 【爆款四基因至少命中 2 条】：情绪钩子（共鸣/愤怒/爽感/治愈）、信息差（行业内幕/反常识/我知道你不知道）、身份标签（"这就是我""替我说出口"）、行动触发（实用清单/立刻能用）。标题不写震惊体，但必须有钩子与信息差，让人想点想转。
7. 选题覆盖与多样性：5 个至少覆盖 3 种 type。优先布局"昨日/今日一线动漫资讯与最新剧情"；其次小众动漫最新资讯/剧情；也要有一两个"动漫趣事 / 今日动漫人物生日或事迹 / 今日动漫大事记"；常青候选（斗破苍穹停更、暑期新番、光阴之外黑马、沧元图柳七月回归、7月播放榜等）可酌情纳入但不要占满。避免与 avoid_titles / avoid_keys 已出现过的选题雷同。
8. 只输出一个 JSON 数组（务必带外层方括号 [ ]），元素为对象 {title,type,summary,angle,article_type,genes,why}，不要任何解释或 Markdown 代码块。"""

# 常青候选示例，写进 user prompt 给用户的标准做锚（不强制模型命中，仅供多样性参考）
EVERGREEN_HINTS = "斗破苍穹停更, 暑期新番, 光阴之外黑马, 沧元图柳七月回归, 7月播放榜"


def build_topic_prompt(
    today: str, count: int, avoid_titles: list[str], avoid_keys: list[str]
) -> str:
    parts = [
        f"当前日期：{today}",
        f"请输出 {count} 个选题（JSON 数组）。",
        "优先从近 7 天真实发生的国漫热点事件中取材（新番、票房、争议、官方动作、名场面），让选题踩在热点上，而非纯架空。",
        f"常青候选参考（可写，但不必都写）：{EVERGREEN_HINTS}",
    ]
    if avoid_titles:
        parts.append("以下选题已经推荐过，请避免雷同：" + "；".join(avoid_titles[:10]))
    return "\n".join(parts)


ARTICLE_TYPES = tuple(PROMPTS_BASE.keys())

# 默认补充要求：与归档 generate_draft() 的默认值一致
DEFAULT_REQUIREMENT = "内容丰富充实，严禁编造"
WEITOUTIAO_REQUIREMENT = "500-700字"

# 只有这些类型会要求模型吐四平台 JSON（weitoutiao 是单篇微头条）
JSON_ARTICLE_TYPES = ("depth", "info")


class UnknownArticleTypeError(ValueError):
    """未知文章类型。绝不静默 fallback 成 depth（那会悄悄改变产物形态）。"""


def build_user_prompt(title: str, article_type: str = "depth", requirement: str = "") -> str:
    """组装 user prompt。人设不在这里，永远由 SYSTEM_PROMPT 承载。

    与归档 `generate_draft()` 的 requirement 缺省逻辑保持一致：
        显式传入 → 用传入值；未传且类型为 weitoutiao → "500-700字"；否则默认句。
    """
    template = PROMPTS_BASE.get(article_type)
    if template is None:
        raise UnknownArticleTypeError(
            f"未知文章类型 {article_type!r}，可选：{list(PROMPTS_BASE)}"
        )
    if requirement:
        req_text = requirement
    elif article_type == "weitoutiao":
        req_text = WEITOUTIAO_REQUIREMENT
    else:
        req_text = DEFAULT_REQUIREMENT
    # 追加账号文风铁律（来自 用户偏好.md / 操作手册），保证每次生成都吃到，
    # 不改动 parity 保护的 SYSTEM_PROMPT / PROMPTS_BASE。
    req_text = f"{req_text}\n{STYLE_GUIDE}"
    if article_type in STRUCTURE_HINTS:
        req_text = f"{req_text}\n{STRUCTURE_HINTS[article_type]}"
    return template.format(title=title, requirement=req_text)


def system_prompt_fingerprint() -> str:
    """SYSTEM_PROMPT 的 sha256 前 12 位。

    写进生成结果与 /health，任何人改了人设都能从产物上立刻看出来。
    """
    return hashlib.sha256(SYSTEM_PROMPT.encode("utf-8")).hexdigest()[:12]
