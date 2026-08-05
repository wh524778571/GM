/** 前端统一视图模型（由 lib/data.ts 从后端 schema 归一化而来）。 */

export type PlatformKey = "toutiao" | "baijia" | "bilibili" | "xhs";

export type ArticleStatus = "published" | "pending" | "draft" | "failed";

export interface ArticleRow {
  /** 业务唯一键 articles.article_id */
  articleId: string;
  title: string;
  /** 作品名（凡人修仙传 / 沧元图 …），作为标题副信息展示 */
  work: string;
  status: ArticleStatus;
  platform: PlatformKey;
  /** 阅读量（tracking 汇总） */
  views: number;
  /** YYYY-MM-DD */
  date: string;
}

export interface Kpi {
  label: string;
  value: string;
  delta?: string;
  tone?: "success" | "warning" | "neutral";
}

export interface WeeklyTask {
  id: number | string;
  /** 0=周一 … 6=周日 */
  weekday: number;
  title: string;
  platform?: PlatformKey | null;
  status: "planned" | "doing" | "done" | "skipped";
  note?: string | null;
}

export interface MaterialItem {
  id: number | string;
  /** `作品名_用途` 形式的展示名 */
  stem: string;
  work: string;
  /** 用途 / 场景 */
  scene: string;
  episode?: string | null;
}

export interface TrendPoint {
  date: string;
  views: number;
}

export interface PlatformShare {
  platform: PlatformKey;
  name: string;
  views: number;
}

export interface ProjectFile {
  name: string;
  kind: string;
  size: string;
  updatedAt: string;
}

// ── 人工发布闭环（Phase 4 / Epic 4.1）────────────────────────
/** 单平台发布态。没有「发布中」——系统不代发，只有人确认前 / 人确认后。 */
export type PublishState = "pending" | "published" | "failed";

export interface PublishImageTask {
  index: number;
  description: string;
  suggested_filename: string;
  matched: boolean;
  url: string | null;
}

/** 后端 PublishPacket.to_dict() 的前端镜像。 */
export interface PublishPacket {
  platform: string;
  platform_name: string;
  display_color: string;
  state: PublishState;
  state_label: string;
  title: string;
  title_char_count: number;
  title_max_chars: number;
  copy_text: string;
  body_char_count: number;
  body_max_chars: number | null;
  html?: string;
  images_allowed: boolean;
  image_tasks: PublishImageTask[];
  console_url: string;
  manual_steps: string[];
  blockers: string[];
  warnings: string[];
  posted_url: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  note: string | null;
  ready: boolean;
}

export interface PublishPlatformStatus {
  platform: string;
  platform_name: string;
  state: PublishState;
  state_label: string;
  posted_url: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  note: string | null;
}

export interface PublishStatusResponse {
  article_id: string;
  article_status: string;
  total_platforms: number;
  published_count: number;
  pending_count: number;
  failed_count: number;
  all_published: boolean;
  pending_label: string;
  platforms: Record<string, PublishPlatformStatus>;
}

export interface PublishPacketsResponse {
  article_id: string;
  article_status: string;
  pending_label: string;
  all_published: boolean;
  published_count: number;
  total_platforms: number;
  packets: PublishPacket[];
}

/** 数据来源标记：backend = 后端实时，seed = 基线兜底 */
export type DataSource = "backend" | "seed";

export interface Sourced<T> {
  source: DataSource;
  data: T;
}
