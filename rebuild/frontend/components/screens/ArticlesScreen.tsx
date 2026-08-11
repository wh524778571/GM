"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell, Section } from "@/components/AppShell";
import { Chip } from "@/components/Chip";
import { TableHeader, TableRow } from "@/components/TableRow";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { DataSourceNote } from "@/components/DataSourceNote";
import { PLATFORMS } from "@/lib/platforms";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/clientApi";
import {
  useArticleSelection,
  toggleArticleSelection,
  setArticleSelection,
  clearArticleSelection,
  removeArticleSelection,
} from "@/lib/articleSelection";
import type { ArticleRow, ArticleStatus } from "@/lib/types";

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "draft", label: "草稿" },
  { key: "pending", label: "待发布" },
  { key: "published", label: "已发布" },
  { key: "failed", label: "失败" },
  { key: "deleted", label: "回收站" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

interface ArticleItem {
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
  items: ArticleItem[];
}

function normalize(items: ArticleItem[]): ArticleRow[] {
  return items.map((a) => ({
    articleId: a.article_id,
    title: a.title,
    work: a.folder_name ?? "国漫笔记",
    status: (a.status as ArticleStatus) ?? "draft",
    platform: (Object.keys(a.titles ?? {})[0] ?? Object.keys(a.publish_schedule ?? {})[0] ?? "xhs") as ArticleRow["platform"],
    views: 0,
    date: (a.updated_at ?? a.created_at ?? "").slice(0, 10),
  }));
}

export function ArticlesScreen({
  initialRows,
  initialCounts,
}: {
  initialRows: ArticleRow[];
  initialCounts: Record<string, number>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ArticleRow[]>(initialRows);
  const [counts, setCounts] = useState<Record<string, number>>(initialCounts);
  const [active, setActive] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const selected = useArticleSelection();

  const visible = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.title.toLowerCase().includes(q) || r.work.toLowerCase().includes(q),
    );
  })();

  const visibleIds = visible.map((r) => r.articleId);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  function toggleSelectAll() {
    if (allSelected) clearArticleSelection();
    else setArticleSelection(visibleIds);
  }

  const countFor = (key: FilterKey) =>
    key === "all"
      ? Object.entries(counts)
          .filter(([k]) => k !== "deleted")
          .reduce((a, [, b]) => a + b, 0)
      : counts[key] ?? 0;

  async function refresh(status?: string) {
    setBusy(true);
    setError(null);
    try {
      const q = status ? `?status=${status}` : "";
      const res = await apiGet<ArticleListResponse>(`/articles${q}`);
      setRows(normalize(res.items));
      if (res.by_status) setCounts(res.by_status);
    } catch (e) {
      setError((e as ApiError).message || "加载失败");
    } finally {
      setBusy(false);
    }
  }

  function onFilter(key: FilterKey) {
    setActive(key);
    refresh(key === "all" ? undefined : key);
  }

  async function onDelete(id: string) {
    if (!window.confirm("确认删除该文章？（软删，可恢复）")) return;
    setBusy(true);
    try {
      await apiPatch(`/articles/${id}`, { status: "deleted" });
      removeArticleSelection([id]);
      setOk("已删除");
      await refresh(active === "all" ? undefined : active);
    } catch (e) {
      setError((e as ApiError).message || "删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function onRestore(id: string) {
    if (!window.confirm("恢复该文章到草稿？（从回收站取出）")) return;
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/articles/${id}`, { status: "draft" });
      removeArticleSelection([id]);
      setOk("已恢复到草稿");
      await refresh(active === "all" ? undefined : active);
    } catch (e) {
      setError((e as ApiError).message || "恢复失败");
    } finally {
      setBusy(false);
    }
  }

  async function onBatchDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(`确认删除选中的 ${ids.length} 篇文章？（软删，可恢复）`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ requested: number; deleted: number; not_found: string[] }>(
        "/articles/batch-delete",
        { ids },
      );
      clearArticleSelection();
      setOk(`已删除 ${res.deleted} 篇`);
      await refresh(active === "all" ? undefined : active);
    } catch (e) {
      setError((e as ApiError).message || "批量删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function onBatchRestore() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(`确认恢复选中的 ${ids.length} 篇文章到草稿？（从回收站取出）`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ requested: number; restored: number; not_found: string[] }>(
        "/articles/batch-restore",
        { ids },
      );
      clearArticleSelection();
      setOk(`已恢复 ${res.restored} 篇到草稿`);
      await refresh(active === "all" ? undefined : active);
    } catch (e) {
      setError((e as ApiError).message || "批量恢复失败");
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const header = ["状态", "标题", "作品", "平台", "阅读量", "日期"];
    const lines = rows.map((r) =>
      [r.status, `"${r.title.replace(/"/g, '""')}"`, r.work, PLATFORMS[r.platform].name, r.views, r.date].join(","),
    );
    const csv = "﻿" + [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "articles.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell
      title="文章管理"
      subtitle="草稿 / 待发布 / 已发布 状态流"
      actionLabel="新建文章"
      onAction={() => router.push("/writer")}
      onSearch={(q) => setQuery(q)}
    >
      <Section
        title="全部文章"
        hint={query ? `关键词「${query}」· ${visible.length} 篇` : `共 ${rows.length} 篇`}
        action={<ButtonSecondary onClick={exportCsv}>导出 CSV</ButtonSecondary>}
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Chip
              key={f.key}
              label={f.label}
              count={countFor(f.key)}
              active={active === f.key}
              onClick={() => onFilter(f.key)}
            />
          ))}
        </div>

        <TableHeader
          selectCol
          allSelected={allSelected}
          onToggleAll={toggleSelectAll}
        />
        <div className="flex flex-col gap-2">
          {visible.map((row) => (
            <TableRow
              key={row.articleId}
              row={row}
              selected={selected.has(row.articleId)}
              onToggleSelect={() => toggleArticleSelection(row.articleId)}
              onRowClick={
                active === "deleted"
                  ? undefined
                  : () =>
                      row.status === "draft" || row.status === "pending"
                        ? router.push(`/writer?articleId=${row.articleId}`)
                        : router.push(`/articles/${row.articleId}`)
              }
              onDelete={active === "deleted" ? undefined : () => onDelete(row.articleId)}
              onRestore={active === "deleted" ? () => onRestore(row.articleId) : undefined}
            />
          ))}
          {visible.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-tertiary">
              {active === "deleted" ? "回收站是空的" : "没有匹配的文章"}
            </p>
          ) : null}
        </div>

        {selected.size > 0 && active !== "deleted" ? (
          <div className="mt-4 flex items-center justify-between rounded-row border border-accent/40 bg-accent-bg px-4 py-3">
            <span className="text-[13px] text-accent">已选 {selected.size} 篇</span>
            <div className="flex items-center gap-2">
              <ButtonSecondary onClick={clearArticleSelection}>取消</ButtonSecondary>
              <button
                type="button"
                onClick={onBatchDelete}
                disabled={busy}
                className="h-9 rounded-btn border border-accent bg-accent px-4 text-[13px] font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
              >
                批量删除
              </button>
            </div>
          </div>
        ) : null}

        {selected.size > 0 && active === "deleted" ? (
          <div className="mt-4 flex items-center justify-between rounded-row border border-success/40 bg-success/10 px-4 py-3">
            <span className="text-[13px] text-success">已选 {selected.size} 篇（回收站）</span>
            <div className="flex items-center gap-2">
              <ButtonSecondary onClick={clearArticleSelection}>取消</ButtonSecondary>
              <button
                type="button"
                onClick={onBatchRestore}
                disabled={busy}
                className="h-9 rounded-btn border border-success bg-success px-4 text-[13px] font-medium text-white transition-colors hover:bg-success/90 disabled:opacity-50"
              >
                批量恢复
              </button>
            </div>
          </div>
        ) : null}

        {error ? <p className="mt-3 text-[13px] text-plat-toutiao">{error}</p> : null}
        {ok ? <p className="mt-3 text-[13px] text-success">{ok}</p> : null}
        <p className="mt-4 text-xs text-tertiary">
          点「发布」拿到四平台的可复制内容与人工步骤；系统不代发，状态在你亲手确认前一直是「待人工发布」。
        </p>
      </Section>
      <DataSourceNote sources={["backend"]} />
    </AppShell>
  );
}
