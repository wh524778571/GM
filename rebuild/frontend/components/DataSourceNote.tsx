import type { DataSource } from "@/lib/types";

/** 数据来源提示：明确区分「后端实时」与「基线兜底」，避免把假数据当真数据。 */
export function DataSourceNote({ sources }: { sources: DataSource[] }) {
  const live = sources.every((s) => s === "backend");
  return (
    <p className="mt-8 text-xs text-tertiary">
      {live
        ? "数据来源：后端 FastAPI 实时（经同源 /api 代理）"
        : "数据来源：基线兜底数据（后端未连接或暂无数据）· 启动后端后自动切换为实时"}
    </p>
  );
}
