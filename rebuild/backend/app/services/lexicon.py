"""国漫领域词典 + 最大正向匹配分词器。

## 为什么需要它

旧工程 `工具/image_utils.py` 已丢失，Phase 1 按行为反推重写 `extract_keywords`，
采用「单字分隔符 + 停用词」切分。单字分隔符里包含 `飞 / 看 / 望 / 冲` 等常用字，
于是多字专名被从中间劈开：

    择日飞升 → ['择日']        # 被 `飞` 切断，作品名丢失
    韩立飞天 → ['韩立']        # 尚可，但纯属巧合

同时 `score_filename` 对「整词命中文件名」只给 3 分，低于跨库复用阈值
`MIN_REUSE_SCORE = 5`，导致 `南宫婉` / `孟川` / `韩立` 这类**完整角色名查询**
即使把正确素材排在第 1 位（score=3），也会被阈值挡回 `None`（漏配）。

## 方案

词典优先的**最大正向匹配**（max forward match）：
先用领域词典切出专名，词典切不动的残片再交给原有的分隔符/停用词逻辑。

不引入 jieba：
1. 角色名（南宫婉/孟川/石毅…）本就不在 jieba 通用词典里，必须自建词典才准；
   一旦自建词典，jieba 只剩「未登录词切分」这一点增益，而本场景的未登录词
   （台词残片）本来就不需要精细切分。
2. 纯 Python 最大匹配零新增依赖、完全离线、结果确定可复现，便于回归断言。

## 词的两级权重

- **SPECIFIC（专指词）**：角色名、法宝/地名等专有实体。语料里出现次数少，
  命中即高置信 → 打分加 `4`。
- **GENERIC（泛指词）**：作品名。一部作品动辄几百张素材，命中只能说明「同一部剧」
  → 打分加 `2`。

配合基础分 3（整词命中文件名）：专指词 3+4=7、作品名 3+2=5，都能越过
`MIN_REUSE_SCORE=5`；而**不在词典里的普通 3 字词仍停留在 3 分**，保持原有的
保守策略，不会凭空多出误配。
"""

from __future__ import annotations

import re
import threading

# ── 作品名（泛指词，命中只说明同一部剧） ─────────────────────────
WORK_TITLES: set[str] = {
    "凡人修仙传", "沧元图", "仙逆", "遮天", "择日飞升",
    "完美世界", "斗破苍穹", "斗罗大陆", "吞噬星空", "武庚纪",
    "一念永恒", "武动乾坤", "神印王座", "刺客伍六七", "时光代理人",
    "全职高手", "狐妖小红娘", "灵笼", "秦时明月", "天行九歌",
    "不良人", "镜双城", "眷思量", "万古最狂", "鬼刀", "诛仙",
    "元龙", "镖人", "斗罗大陆2绝世唐门", "剑来", "画江湖之不良人",
}

# ── 角色名（专指词） ─────────────────────────────────────────────
CHARACTER_NAMES: set[str] = {
    # 凡人修仙传
    "韩立", "南宫婉", "南宫阙", "墨大夫", "厉飞雨", "墨彩环", "紫灵",
    "元瑶", "银月", "掌天瓶", "极阴祖师", "陆天华", "张铁", "曲魂",
    # 沧元图
    "孟川", "柳七月", "孟安", "孟悠", "安海王", "洛棠", "秦五虎", "白瑶月",
    # 仙逆
    "王林", "李慕婉", "司徒南", "张新海", "朱雀子", "许爷爷",
    # 遮天
    "叶凡", "庞博", "李黑水", "东方野", "姬紫月", "段德", "黑皇",
    # 完美世界
    "石昊", "石毅", "秦怡宁", "云曦", "火灵儿", "柳神", "荒天帝", "云烨",
    # 择日飞升
    "王林2", "慕兰", "墨曦", "楚越", "居来提",
    # 斗破苍穹 / 斗罗大陆 / 吞噬星空 等
    "萧炎", "药尘", "药老", "美杜莎", "彩鳞", "萧薰儿",
    "唐三", "小舞", "唐昊", "戴沐白", "宁荣荣", "奥斯卡",
    "罗峰", "徐欣", "白小纯", "林动", "龙皓晨",
    "伍六七", "梅花十三", "程小时", "陆光", "叶修",
    "白月初", "涂山苏苏", "马克", "冉冰", "盖聂", "卫庄", "韩非",
    "李星云", "姬如雪", "苏摹", "白璎", "镜玄", "屠丽", "李七夜",
    "冰公主", "海琴烟", "张小凡", "陆雪琪", "碧瑶", "王胜", "刀马",
}

# ── 专有实体：法宝 / 地名 / 势力 / 称号（专指词） ────────────────
ENTITY_TERMS: set[str] = {
    # 凡人修仙传
    "血魔剑", "元磁神光", "青元剑诀", "黄枫谷", "落云宗", "乱星海", "掩月宗",
    # 遮天
    "北海之眼", "北斗星域", "十三大寇", "荒古禁地",
    # 仙逆
    "尊魂幡", "山河图", "青灵星", "雷仙殿", "修真家族",
    # 沧元图
    "大越王朝", "元神劫", "神魔之路", "十字神尊", "暗星境", "大日境",
    # 择日飞升
    "天道雷劫", "幽界", "皇廷", "幽都",
    # 斗罗 / 斗破
    "昊天锤", "蓝银草", "异火", "斗气",
}

# ── 通用标签（泛指词，用于 search_by_topic 的主题命中） ─────────
GENERIC_TAGS: set[str] = {
    "打戏", "特效", "剧情", "配音", "建模", "画质", "名场面",
    "玄幻", "修仙", "武侠", "科幻", "国漫", "3D", "2D",
}


class Lexicon:
    """领域词典：最大正向匹配分词 + 词权级别查询。线程安全（读多写少）。"""

    SPECIFIC = "specific"
    GENERIC = "generic"

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._kind: dict[str, str] = {}
        self._max_len = 0
        self._partials: set[str] = set()
        for term in CHARACTER_NAMES | ENTITY_TERMS:
            self._add(term, self.SPECIFIC)
        for term in WORK_TITLES | GENERIC_TAGS:
            self._add(term, self.GENERIC)
        self._rebuild_partials()

    # ── 写入 ──────────────────────────────────────────────────
    def _add(self, term: str, kind: str) -> None:
        term = term.strip()
        if len(term) < 2:
            return
        # 专指词优先：已登记为 specific 的不被 generic 覆盖
        if self._kind.get(term) == self.SPECIFIC and kind == self.GENERIC:
            return
        self._kind[term] = kind
        self._max_len = max(self._max_len, len(term))

    def _rebuild_partials(self) -> None:
        """专指词的所有 ≥2 字子串，用于「部分姓名」弱加权（如 南宫 → 南宫婉/南宫阙）。"""
        partials: set[str] = set()
        for term, kind in self._kind.items():
            if kind != self.SPECIFIC:
                continue
            for i in range(len(term)):
                for j in range(i + 2, len(term) + 1):
                    partials.add(term[i:j])
        self._partials = partials - set(self._kind)

    def register(self, terms, kind: str = GENERIC) -> int:
        """运行期注入数据驱动的词（如 materials.work / tags）。返回新增词数。"""
        added = 0
        with self._lock:
            for term in terms:
                if not term:
                    continue
                term = str(term).strip()
                if len(term) < 2 or self._kind.get(term) == kind:
                    continue
                before = len(self._kind)
                self._add(term, kind)
                added += len(self._kind) - before
            if added:
                self._rebuild_partials()
        return added

    # ── 查询 ──────────────────────────────────────────────────
    def kind_of(self, term: str) -> str | None:
        return self._kind.get(term)

    def is_specific(self, term: str) -> bool:
        return self._kind.get(term) == self.SPECIFIC

    def is_generic(self, term: str) -> bool:
        return self._kind.get(term) == self.GENERIC

    def is_partial_specific(self, term: str) -> bool:
        """是某个专指词的 ≥2 字子串，但本身不是词典词（如 `南宫`）。"""
        return term in self._partials

    def terms(self) -> list[str]:
        return sorted(self._kind)

    def size(self) -> int:
        return len(self._kind)

    # ── 分词 ──────────────────────────────────────────────────
    def segment(self, text: str) -> list[tuple[str, bool]]:
        """最大正向匹配。返回 [(片段, 是否词典词)]，按原文顺序，覆盖全部字符。

        >>> Lexicon().segment("拘灵术打在韩立身上")
        [('拘灵术打在', False), ('韩立', True), ('身上', False)]
        """
        if not text:
            return []
        result: list[tuple[str, bool]] = []
        buffer: list[str] = []
        i, n = 0, len(text)
        max_len = self._max_len or 1
        kinds = self._kind
        while i < n:
            hit = None
            for length in range(min(max_len, n - i), 1, -1):
                candidate = text[i : i + length]
                if candidate in kinds:
                    hit = candidate
                    break
            if hit is None:
                buffer.append(text[i])
                i += 1
                continue
            if buffer:
                result.append(("".join(buffer), False))
                buffer = []
            result.append((hit, True))
            i += len(hit)
        if buffer:
            result.append(("".join(buffer), False))
        return result

    def find_terms(self, text: str) -> list[str]:
        """文本中出现的全部词典词（按首次出现位置排序，专指词优先）。"""
        found: list[tuple[int, int, str]] = []
        for term, kind in self._kind.items():
            pos = text.find(term)
            if pos >= 0:
                found.append((0 if kind == self.SPECIFIC else 1, pos, term))
        found.sort()
        return [term for _, _, term in found]


LEXICON = Lexicon()

_CJK_RUN = re.compile(r"[\u4e00-\u9fa5]{2,}")


def register_corpus_terms(works, tags=()) -> int:
    """把语料里真实存在的作品名 / 标签注册进词典（数据驱动优先于硬编码）。"""
    added = LEXICON.register([w for w in works if w], Lexicon.GENERIC)
    added += LEXICON.register([t for t in tags if t], Lexicon.GENERIC)
    return added
