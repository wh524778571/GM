"use client";

import { StatusPill } from "./StatusPill";
import { PublishButton } from "./PublishModal";
import { PLATFORMS } from "@/lib/platforms";
import { formatViews } from "@/lib/format";
import type { ArticleRow } from "@/lib/types";

/**
 * comp-table-row（画布 2:277）：976×61 / 圆角 8 / bg-card。
 * 5 列（顺序固定，组件化时增强的「阅读量」列不可丢）：
 *   状态药丸 · 标题 · 平台 · 阅读量 · 日期
 * Phase 4 追加第 6 列「发布」：打开人工发布弹窗（不代发，只给内容和步骤）。
 * 行可点击进详情；可触发删除。
 */
export const TABLE_COLS = {
  status: "w-[76px] shrink-0",
  title: "min-w-0 flex-1",
  platform: "w-[96px] shrink-0",
  views: "w-[88px] shrink-0 text-right",
  date: "w-[96px] shrink-0 text-right",
  action: "w-[104px] shrink-0 text-right",
} as const;

export function TableHeader() {
  return (
    <div className="flex h-9 w-full items-center gap-4 px-4 text-xs text-tertiary">
      <span className={TABLE_COLS.status}>状态</span>
      <span className={TABLE_COLS.title}>标题</span>
      <span className={TABLE_COLS.platform}>平台</span>
      <span className={TABLE_COLS.views}>阅读量</span>
      <span className={TABLE_COLS.date}>日期</span>
      <span className={TABLE_COLS.action}>操作</span>
    </div>
  );
}

export function TableRow({
  row,
  onRowClick,
  onDelete,
}: {
  row: ArticleRow;
  onRowClick?: () => void;
  onDelete?: () => void;
}) {
  const platform = PLATFORMS[row.platform];

  return (
    <div
      onClick={onRowClick}
      className={`flex h-[61px] w-full items-center gap-4 rounded-row border border-subtle bg-card px-4 transition-colors hover:bg-raised ${
        onRowClick ? "cursor-pointer" : ""
      }`}
    >
      <div className={TABLE_COLS.status}>
        <StatusPill status={row.status} />
      </div>

      <div className={TABLE_COLS.title}>
        <div className="truncate text-sm font-medium text-primary">{row.title}</div>
        <div className="truncate text-xs text-tertiary">{row.work}</div>
      </div>

      <div className={`${TABLE_COLS.platform} flex items-center gap-2`}>
        <span className={`h-2 w-2 shrink-0 rounded-pill ${platform.bg}`} />
        <span className={`truncate text-[13px] ${platform.text}`}>{platform.name}</span>
      </div>

      <div className={`${TABLE_COLS.views} text-[13px] tabular-nums text-primary`}>
        {formatViews(row.views)}
      </div>

      <div className={`${TABLE_COLS.date} text-[13px] tabular-nums text-secondary`}>{row.date}</div>

      <div className={`${TABLE_COLS.action} flex justify-end`}>
        <div className="flex items-center justify-end gap-1.5">
          {onDelete ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="h-7 rounded-btn border border-subtle px-2 text-xs text-tertiary transition-colors hover:border-plat-toutiao/50 hover:text-plat-toutiao"
              title="删除"
            >
              删
            </button>
          ) : null}
          <PublishButton
            articleId={row.articleId}
            articleTitle={row.title}
            className="h-7 px-2.5 text-xs"
          />
        </div>
      </div>
    </div>
  );
}
