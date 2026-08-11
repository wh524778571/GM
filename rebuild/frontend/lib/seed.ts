/**
 * 基线兜底数据（seed）。
 * 来源：《国漫笔记重启方案.md》§2.4 真实数据基线 + 《设计资产交接清单.md》§3。
 * 用途：后端未启动 / 无数据（Phase 2 demo 自清理）时，7 屏仍呈现真实观感的国漫内容。
 */
import type {
  ArticleRow,
  Kpi,
  MaterialItem,
  PlatformShare,
  ProjectFile,
  TrendPoint,
} from "./types";

/** 文章管理 4 行基线（状态 / 作品 / 阅读量 与画布一致） */
export const SEED_ARTICLES: ArticleRow[] = [
  {
    articleId: "art-mulan-zhizhan",
    title: "慕兰之战：凡人修仙传最燃的一集，韩立终于亮出底牌",
    work: "凡人修仙传",
    status: "published",
    platforms: ["xhs"],
    views: 2180,
    date: "2026-07-28",
  },
  {
    articleId: "art-dxi-7chang",
    title: "打戏 7 场：2026 上半年国漫最能打的 7 个高光时刻",
    work: "国漫盘点",
    status: "published",
    platforms: ["toutiao"],
    views: 1530,
    date: "2026-07-25",
  },
  {
    articleId: "art-xianni-gaibian",
    title: "仙逆改编争议：动画删了原著哪几段，值不值得追",
    work: "仙逆",
    status: "draft",
    platforms: ["baijia"],
    views: 860,
    date: "2026-07-22",
  },
  {
    articleId: "art-cangyuantu-s2",
    title: "沧元图 S2 第 21 集解析：孟川破境，元神境的代价是什么",
    work: "沧元图",
    status: "pending",
    platforms: ["bilibili"],
    views: 1920,
    date: "2026-07-31",
  },
];

/** 文章管理筛选 chips（全部 47 / 草稿 12 / 待发布 2 / 已发布 31 / 失败 2） */
export const SEED_ARTICLE_FILTERS = [
  { key: "all", label: "全部", count: 47 },
  { key: "draft", label: "草稿", count: 12 },
  { key: "pending", label: "待发布", count: 2 },
  { key: "published", label: "已发布", count: 31 },
  { key: "failed", label: "失败", count: 2 },
] as const;

/** 工作台 KPI */
export const SEED_DASHBOARD_KPIS: Kpi[] = [
  { label: "本周待更", value: "4", delta: "草稿 3 · 待发布 1", tone: "warning" },
  { label: "已发布", value: "2", delta: "+2 本周", tone: "success" },
  { label: "待发布", value: "1", delta: "待人工确认后发布", tone: "warning" },
  { label: "素材库", value: "825", delta: "跨 47 篇", tone: "neutral" },
];

/** 数据看板 KPI */
export const SEED_ANALYTICS_KPIS: Kpi[] = [
  { label: "总阅读量", value: "128.6k", delta: "+12.4% 环比", tone: "success" },
  { label: "平均互动率", value: "4.8%", delta: "+0.6pt 环比", tone: "success" },
  { label: "小红书粉丝", value: "1.4k", delta: "代理值（赞+藏）", tone: "neutral" },
  { label: "预估收益", value: "¥1,240", delta: "头条原创待开通 ×3–5", tone: "warning" },
];

/** 配图管理 KPI */
export const SEED_ASSET_KPIS: Kpi[] = [
  { label: "素材总数", value: "825", delta: "跨 47 篇", tone: "neutral" },
  { label: "本月新增", value: "47", delta: "+47 张", tone: "success" },
  { label: "已分类", value: "612", delta: "占比 74%", tone: "success" },
  { label: "待分类", value: "213", delta: "待人工归档", tone: "warning" },
];

/** 数据看板：近 14 日阅读趋势 */
export const SEED_TREND: TrendPoint[] = [
  { date: "07-18", views: 5200 },
  { date: "07-19", views: 6100 },
  { date: "07-20", views: 5800 },
  { date: "07-21", views: 7400 },
  { date: "07-22", views: 8600 },
  { date: "07-23", views: 8100 },
  { date: "07-24", views: 9700 },
  { date: "07-25", views: 11200 },
  { date: "07-26", views: 10400 },
  { date: "07-27", views: 12600 },
  { date: "07-28", views: 14800 },
  { date: "07-29", views: 13500 },
  { date: "07-30", views: 15200 },
  { date: "07-31", views: 16900 },
];

/** 数据看板：平台分布 */
export const SEED_PLATFORM_SHARE: PlatformShare[] = [
  { platform: "xhs", name: "小红书", views: 52400 },
  { platform: "toutiao", name: "今日头条", views: 38600 },
  { platform: "baijia", name: "百家号", views: 24100 },
  { platform: "bilibili", name: "B站", views: 13500 },
];

/** 配图管理：12 张素材卡（命名规则 作品名_用途） */
export const SEED_MATERIALS: MaterialItem[] = [
  { id: "m1", stem: "凡人修仙传_慕兰之战", work: "凡人修仙传", scene: "慕兰之战", episode: "第 118 集" },
  { id: "m2", stem: "凡人修仙传_韩立立绘", work: "凡人修仙传", scene: "韩立立绘", episode: "第 116 集" },
  { id: "m3", stem: "沧元图_孟川立绘", work: "沧元图", scene: "孟川立绘", episode: "S2 第 21 集" },
  { id: "m4", stem: "沧元图_破境瞬间", work: "沧元图", scene: "破境瞬间", episode: "S2 第 21 集" },
  { id: "m5", stem: "仙逆_王林出场", work: "仙逆", scene: "王林出场", episode: "第 42 集" },
  { id: "m6", stem: "仙逆_逆天改命", work: "仙逆", scene: "逆天改命", episode: "第 45 集" },
  { id: "m7", stem: "斗破苍穹_萧炎焚决", work: "斗破苍穹", scene: "萧炎焚决", episode: "年番第 88 集" },
  { id: "m8", stem: "斗罗大陆_唐三武魂", work: "斗罗大陆", scene: "唐三武魂", episode: "第 264 集" },
  { id: "m9", stem: "遮天_叶凡登场", work: "遮天", scene: "叶凡登场", episode: "第 30 集" },
  { id: "m10", stem: "国漫盘点_打戏合集", work: "国漫盘点", scene: "打戏合集", episode: null },
  { id: "m11", stem: "武庚纪_子羽战神", work: "武庚纪", scene: "子羽战神", episode: "第 五季 12 集" },
  { id: "m12", stem: "灵笼_马克突围", work: "灵笼", scene: "马克突围", episode: "S2 第 6 集" },
];

/** 配图管理筛选 chips */
export const SEED_ASSET_FILTERS = [
  { key: "all", label: "全部", count: 825 },
  { key: "classified", label: "已分类", count: 612 },
  { key: "unclassified", label: "待分类", count: 213 },
  { key: "month", label: "本月新增", count: 47 },
] as const;

/** 项目文件：10 行（真实项目文件） */
export const SEED_FILES: ProjectFile[] = [
  { name: "设计系统 v6.0.ardot", kind: "设计稿", size: "1.2 MB", updatedAt: "2026-08-03 21:40" },
  { name: "复用组件库.ardot", kind: "设计稿", size: "860 KB", updatedAt: "2026-08-03 21:22" },
  { name: "工作台 Dashboard.ardot", kind: "屏设计", size: "420 KB", updatedAt: "2026-08-03 20:58" },
  { name: "文章管理 Articles.ardot", kind: "屏设计", size: "388 KB", updatedAt: "2026-08-03 20:51" },
  { name: "数据看板 Analytics.ardot", kind: "屏设计", size: "402 KB", updatedAt: "2026-08-03 20:37" },
  { name: "设计资产交接清单.md", kind: "文档", size: "11 KB", updatedAt: "2026-08-03 21:55" },
  { name: "国漫笔记重启方案.md", kind: "文档", size: "15 KB", updatedAt: "2026-08-03 20:27" },
  { name: "开发任务拆解.md", kind: "文档", size: "6 KB", updatedAt: "2026-08-03 20:29" },
  { name: "platforms.yaml", kind: "规则源", size: "4 KB", updatedAt: "2026-08-03 22:36" },
];

export const SEED_FILE_SORTS = [
  { key: "updated", label: "按更新时间" },
  { key: "name", label: "按名称" },
  { key: "size", label: "按大小" },
  { key: "kind", label: "按类型" },
] as const;

/** AI 写作：右侧实时预览样稿（约 1920 字量级的国漫深度文片段） */
export const SEED_WRITER_TOPIC = "沧元图 S2 第 21 集：孟川破境，元神境的代价是什么";

export const SEED_WRITER_OUTLINE = [
  "开篇钩子：这一集把「破境」拍成了献祭",
  "第一幕：孟川的元神境为什么来得这么晚",
  "第二幕：7 场打戏里最关键的一场（对比原著）",
  "第三幕：安海王的立场反转埋了什么伏笔",
  "结尾：下一集最该关注的三条线",
];

export const SEED_WRITER_PREVIEW = [
  "沧元图 S2 第 21 集播完，弹幕里刷得最多的两个字是「值了」。",
  "这一集把孟川破境这件事，拍成了一场献祭——他拿走的每一分力量，都在别处被扣了回去。",
  "【配图1：沧元图_破境瞬间】",
  "先说结论：这集的信息密度是本季最高的一集，明面上是打，暗线全是代价。",
  "第一幕，孟川的元神境为什么来得这么晚。原著里这一段只有不到两千字，动画补了整整十一分钟的心理戏。",
  "补的这十一分钟不是水，它把「破境=失去」这个母题第一次摆到了台面上。",
  "【配图2：沧元图_孟川立绘】",
  "第二幕，本集 7 场打戏里最关键的一场，是孟川和妖王在雪原上的第 4 场。",
  "这场戏改了原著的胜负逻辑：原著靠功法压制，动画改成了消耗战，赢得非常难看，但也非常可信。",
  "第三幕，安海王的立场反转。他在第 21 集只出现了 40 秒，可这 40 秒把前面十集的铺垫全部盘活了。",
  "结尾，下一集最该盯三条线：孟川的寿元、白瑶月的态度、以及那柄一直没出鞘的刀。",
  "如果你也在追，评论区聊聊：这一集的「代价」，你觉得值吗？",
].join("\n\n");

export const SEED_WRITER_CHAR_COUNT = 1920;
