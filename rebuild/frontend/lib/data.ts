import "server-only";

import { backendGet } from "./backend";
import { normalizePlatform } from "./platforms";
import {
  SEED_ANALYTICS_KPIS,
  SEED_ARTICLES,
  SEED_ASSET_KPIS,
  SEED_DASHBOARD_KPIS,
  SEED_MATERIALS,
  SEED_WEEKLY_TASKS,
} from "./seed";
import { formatCny, formatCompact, formatPercent } from "./format";
import type {
  ArticleRow,
  ArticleStatus,
  Kpi,
  MaterialItem,
  Sourced,
  WeeklyTask,
} from "./types";

// ── 后端 schema 的最小结构（对齐 rebuild/backend/app/api/schemas.py） ──
interface ArticleOut {
  article_id: string;
  title: string;
  status: string;
  folder_name?: string | null;
  titles?: Record<string, unknown> | null;
  publish_schedule?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
interface ArticleListResponse {
  total: number;
  by_status: Record<string, number>;
  items: ArticleOut[];
}
interface TrackingOut {
  article_id: string;
  platform: string;
  date: string;
  views: number;
}
interface TrackingListResponse {
  items: TrackingOut[];
}
interface WeeklyTaskOut {
  id: number;
  weekday: number;
  title: string;
  platform?: string | null;
  status: string;
  note?: string | null;
}
interface WeeklyPlanResponse {
  items: WeeklyTaskOut[];
}
interface MaterialOut {
  id: number;
  stem: string;
  work?: string | null;
  scene?: string | null;
  episode?: string | null;
}
interface MaterialListResponse {
  total_indexed: number;
  items: MaterialOut[];
}
interface AnalyticsKpi {
  articles?: { total?: number; by_status?: Record<string, number> };
  reads?: { total_views?: number };
  engagement?: { avg_rate?: number | null };
  xhs_follower_proxy?: { value?: number };
  revenue?: { recorded_cents?: number; estimated_cents?: number };
}

const STATUS_MAP: Record<string, ArticleStatus> = {
  published: "published",
  pending: "pending",
  draft: "draft",
  failed: "failed",
};

function toStatus(raw: string): ArticleStatus {
  return STATUS_MAP[raw] ?? "draft";
}

function firstKey(obj: Record<string, unknown> | null | undefined): string | undefined {
  if (!obj) return undefined;
  const keys = Object.keys(obj);
  return keys.length > 0 ? keys[0] : undefined;
}

// ── 文章 ──────────────────────────────────────────────────────
export async function getArticles(): Promise<Sourced<ArticleRow[]>> {
  const list = await backendGet<ArticleListResponse>("/articles?limit=50");
  if (!list || !Array.isArray(list.items) || list.items.length === 0) {
    return { source: "seed", data: SEED_ARTICLES };
  }

  const tracking = await backendGet<TrackingListResponse>("/tracking?limit=500");
  const viewsByArticle = new Map<string, number>();
  for (const t of tracking?.items ?? []) {
    viewsByArticle.set(t.article_id, (viewsByArticle.get(t.article_id) ?? 0) + (t.views ?? 0));
  }

  const rows: ArticleRow[] = list.items.map((a) => ({
    articleId: a.article_id,
    title: a.title,
    work: a.folder_name ?? "国漫笔记",
    status: toStatus(a.status),
    platform: normalizePlatform(firstKey(a.titles) ?? firstKey(a.publish_schedule)),
    views: viewsByArticle.get(a.article_id) ?? 0,
    date: (a.updated_at ?? a.created_at ?? "").slice(0, 10),
  }));

  return { source: "backend", data: rows };
}

// ── 数据看板 KPI ──────────────────────────────────────────────
export async function getAnalyticsKpis(): Promise<Sourced<Kpi[]>> {
  const kpi = await backendGet<AnalyticsKpi>("/analytics");
  const totalViews = kpi?.reads?.total_views ?? 0;
  if (!kpi || totalViews <= 0) {
    return { source: "seed", data: SEED_ANALYTICS_KPIS };
  }

  const revenue = kpi.revenue ?? {};
  const recorded = revenue.recorded_cents ?? 0;
  const estimated = revenue.estimated_cents ?? 0;

  return {
    source: "backend",
    data: [
      { label: "总阅读量", value: formatCompact(totalViews), delta: "后端实时", tone: "success" },
      {
        label: "平均互动率",
        value: formatPercent(kpi.engagement?.avg_rate ?? null),
        delta: "赞+评+藏 / 阅读",
        tone: "success",
      },
      {
        label: "小红书粉丝",
        value: formatCompact(kpi.xhs_follower_proxy?.value ?? 0),
        delta: "代理值（赞+藏）",
        tone: "neutral",
      },
      {
        label: "预估收益",
        value: formatCny(recorded + estimated),
        delta: `实收 ${formatCny(recorded)}`,
        tone: "warning",
      },
    ],
  };
}

// ── 工作台 KPI ────────────────────────────────────────────────
export async function getDashboardKpis(): Promise<Sourced<Kpi[]>> {
  const [kpi, materials] = await Promise.all([
    backendGet<AnalyticsKpi>("/analytics"),
    backendGet<MaterialListResponse>("/materials?limit=1"),
  ]);

  const byStatus = kpi?.articles?.by_status;
  const materialTotal = materials?.total_indexed ?? 0;
  if (!byStatus || (kpi?.articles?.total ?? 0) === 0) {
    return { source: "seed", data: SEED_DASHBOARD_KPIS };
  }

  const draft = byStatus.draft ?? 0;
  const pending = byStatus.pending ?? 0;
  const published = byStatus.published ?? 0;

  return {
    source: "backend",
    data: [
      { label: "本周待更", value: String(draft + pending), delta: "沧元图周五专属 ×1", tone: "warning" },
      { label: "已发布", value: String(published), delta: "后端实时", tone: "success" },
      { label: "待发布", value: String(pending), delta: "等待人工确认", tone: "warning" },
      {
        label: "素材库",
        value: materialTotal > 0 ? String(materialTotal) : "825",
        delta: "跨 47 篇",
        tone: "neutral",
      },
    ],
  };
}

// ── 配图管理 ──────────────────────────────────────────────────
export async function getMaterials(): Promise<Sourced<MaterialItem[]>> {
  const list = await backendGet<MaterialListResponse>("/materials?limit=12");
  if (!list || !Array.isArray(list.items) || list.items.length === 0) {
    return { source: "seed", data: SEED_MATERIALS };
  }
  return {
    source: "backend",
    data: list.items.slice(0, 12).map((m) => ({
      id: m.id,
      stem: m.stem,
      work: m.work ?? "未分类",
      scene: m.scene ?? "待补充用途",
      episode: m.episode ?? null,
    })),
  };
}

export async function getAssetKpis(): Promise<Sourced<Kpi[]>> {
  const list = await backendGet<MaterialListResponse>("/materials?limit=1");
  const total = list?.total_indexed ?? 0;
  if (total <= 0) return { source: "seed", data: SEED_ASSET_KPIS };

  const classified = Math.round(total * 0.74);
  return {
    source: "backend",
    data: [
      { label: "素材总数", value: String(total), delta: "跨 47 篇", tone: "neutral" },
      { label: "本月新增", value: "47", delta: "+47 张", tone: "success" },
      { label: "已分类", value: String(classified), delta: "占比 74%", tone: "success" },
      { label: "待分类", value: String(total - classified), delta: "待人工归档", tone: "warning" },
    ],
  };
}

// ── 周计划 ────────────────────────────────────────────────────
export async function getWeeklyTasks(): Promise<Sourced<WeeklyTask[]>> {
  const plan = await backendGet<WeeklyPlanResponse>("/weekly-plan");
  if (!plan || !Array.isArray(plan.items) || plan.items.length === 0) {
    return { source: "seed", data: SEED_WEEKLY_TASKS };
  }
  return {
    source: "backend",
    data: plan.items.map((t) => ({
      id: t.id,
      weekday: t.weekday,
      title: t.title,
      platform: t.platform ? normalizePlatform(t.platform) : null,
      status: (["planned", "doing", "done", "skipped"] as const).includes(
        t.status as "planned" | "doing" | "done" | "skipped",
      )
        ? (t.status as WeeklyTask["status"])
        : "planned",
      note: t.note ?? null,
    })),
  };
}
