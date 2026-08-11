/** 前端统一视图模型（由 lib/data.ts 从后端 schema 归一化而来）。 */

export type PlatformKey = "toutiao" | "baijia" | "bilibili" | "xhs";

export type ArticleStatus = "published" | "pending" | "draft" | "failed" | "deleted";

export interface ArticleRow {
  articleId: string;
  title: string;
  work: string;
  status: ArticleStatus;
  /** 已有正文的平台列表（四平台文章显示全部四个，单平台显示一个） */
  platforms: PlatformKey[];
  views: number;
  date: string;
}

export interface Kpi {
  label: string;
  value: string;
  delta?: string;
  tone?: "success" | "warning" | "neutral";
}

export interface MaterialItem {
  id: number | string;
  /** `作品名_用途` 形式的展示名 */
  stem: string;
  work: string;
  /** 用途 / 场景 */
  scene: string;
  episode?: string | null;
  /** 缩略图地址（已改写为同源 /api/images/...）；无后端图片服务时为 null */
  url?: string | null;
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

/** 「项目文件」屏的富类型：携带后端真实信息（相对路径、可否删除、绝对路径用于复制）。 */
export interface FileItem {
  name: string;
  relPath: string;
  kind: string;
  /** 字节数（用于排序/格式化） */
  sizeBytes: number;
  /** 已格式化的尺寸文案（后端已给，如 "1.2 MB"） */
  size: string;
  updatedAt: string;
  /** 是否位于 uploads/ 下（仅此类可删） */
  deletable: boolean;
  /** 绝对路径，供「复制路径」使用 */
  path: string;
}

/** AI 写作页：单条配图建议（来自后端 image_suggestions，前端镜像所需字段）。 */
export interface ImageSuggestion {
  /** 占位符原文，如「【配图1：沧元图_破境瞬间】」 */
  placeholder: string;
  index: number;
  description: string;
  /** 是否已在素材库命中 */
  matched: boolean;
  /** 命中时的素材地址（/images/... 形式，前端会改写成同源 /api/images/...） */
  url?: string | null;
}

/** AI 写作页：一次生成的完整结果（前端镜像后端 result 字典）。 */
export interface GenResult {
  core?: string;
  titles?: Record<string, string>;
  contents?: Record<string, string>;
  image_sources?: Record<string, string>;
  image_suggestions?: ImageSuggestion[];
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
