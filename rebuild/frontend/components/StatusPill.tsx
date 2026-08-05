import type { ArticleStatus } from "@/lib/types";

/**
 * 状态药丸（圆角 20）：
 * 已发布=success / 待发布=warning / 草稿=tertiary+border-subtle / 失败=plat-toutiao。
 */
const STATUS: Record<ArticleStatus, { label: string; className: string }> = {
  published: { label: "已发布", className: "border-success/40 bg-success/10 text-success" },
  pending: { label: "待发布", className: "border-warning/40 bg-warning/10 text-warning" },
  draft: { label: "草稿", className: "border-subtle bg-raised text-tertiary" },
  failed: { label: "失败", className: "border-plat-toutiao/40 bg-plat-toutiao/10 text-plat-toutiao" },
};

export function StatusPill({ status }: { status: ArticleStatus }) {
  const { label, className } = STATUS[status];
  return (
    <span
      className={`inline-flex h-6 items-center justify-center rounded-pill border px-3 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}
