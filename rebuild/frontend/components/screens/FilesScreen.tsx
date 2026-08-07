"use client";

import { useCallback, useRef, useState } from "react";
import { AppShell, Section } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { Chip } from "@/components/Chip";
import { DataSourceNote } from "@/components/DataSourceNote";
import { apiDelete, apiGet, ApiError } from "@/lib/clientApi";
import { IconFolder } from "@/components/icons";
import type { DataSource, FileItem } from "@/lib/types";

const SORTS = [
  { key: "updated", label: "按更新时间" },
  { key: "name", label: "按名称" },
  { key: "size", label: "按大小" },
  { key: "kind", label: "按类型" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];

interface FileListResponse {
  root: string;
  total: number;
  items: FileItem[];
}

function sortItems(items: FileItem[], sort: SortKey): FileItem[] {
  const copy = [...items];
  if (sort === "name") copy.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === "size") copy.sort((a, b) => b.sizeBytes - a.sizeBytes);
  else if (sort === "kind") copy.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  else copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return copy;
}

export function FilesScreen({
  initialFiles,
  fileSource,
}: {
  initialFiles: FileItem[];
  fileSource: DataSource;
}) {
  const [items, setItems] = useState<FileItem[]>(initialFiles);
  const [sort, setSort] = useState<SortKey>("updated");
  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [live, setLive] = useState(fileSource === "backend");
  const [copied, setCopied] = useState<string | null>(null);

  const [showUpload, setShowUpload] = useState(false);
  const [upSubdir, setUpSubdir] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiGet<FileListResponse>(`/files?sort=${sort}`);
      setItems(res.items ?? []);
      setLive(true);
    } catch (e) {
      const ae = e as ApiError;
      setError(
        ae.status === 503
          ? "后端未配置项目文件根目录（FILES_ROOT），当前展示的是基线文件"
          : ae.message || "读取失败",
      );
    } finally {
      setBusy(false);
    }
  }, [sort]);

  function onSort(key: SortKey) {
    setSort(key);
    if (live) void reload();
    else setItems((prev) => sortItems(prev, key));
  }

  const visible = (() => {
    const base = live ? items : sortItems(items, sort);
    if (!keyword.trim()) return base;
    const low = keyword.toLowerCase();
    return base.filter((f) => f.name.toLowerCase().includes(low) || f.relPath.toLowerCase().includes(low));
  })();

  async function doUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("请选择要上传的文件");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (upSubdir.trim()) fd.append("subdir", upSubdir.trim());
      const res = await fetch("/api/files", { method: "POST", body: fd });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as
          | { detail?: { code?: string; message?: string } | string }
          | null;
        const d = detail?.detail;
        const msg = typeof d === "string" ? d : d?.message ?? res.statusText;
        throw new Error(res.status === 503 ? "后端未配置文件根目录，文件未保存" : msg || "上传失败");
      }
      setOk("已上传到 uploads/");
      setShowUpload(false);
      if (fileRef.current) fileRef.current.value = "";
      setUpSubdir("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(item: FileItem) {
    if (!item.deletable) return;
    if (!window.confirm(`确认删除 ${item.name}？（仅删除 uploads/ 下文件，项目源文件不可删）`)) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/files?rel_path=${encodeURIComponent(item.relPath)}`);
      setOk(`已删除 ${item.name}`);
      await reload();
    } catch (e) {
      setError((e as ApiError).message || "删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function copyPath(item: FileItem) {
    try {
      await navigator.clipboard.writeText(item.path);
      setCopied(item.relPath);
      window.setTimeout(() => setCopied((c) => (c === item.relPath ? null : c)), 1600);
    } catch {
      setError("复制失败（浏览器未授权剪贴板），请手动选中路径复制");
    }
  }

  const field =
    "h-9 w-full rounded-btn border border-subtle bg-raised px-3 text-[13px] text-primary focus:border-accent focus:outline-none";

  return (
    <AppShell
      title="项目文件"
      subtitle="设计稿 / 文档 / 规则源"
      actionLabel="上传文件"
      onAction={() => {
        setShowUpload((v) => !v);
        setOk(null);
      }}
      onSearch={(q) => setKeyword(q)}
    >
      {error ? (
        <div className="mb-4 rounded-row border border-plat-toutiao/40 bg-plat-toutiao/10 px-4 py-2.5 text-[13px] text-plat-toutiao">
          {error}
        </div>
      ) : null}
      {ok ? (
        <div className="mb-4 rounded-row border border-success/40 bg-success/10 px-4 py-2.5 text-[13px] text-success">
          {ok}
        </div>
      ) : null}

      {showUpload ? (
        <div className="mb-4 rounded-card border border-subtle bg-card p-4">
          <h2 className="text-[15px] font-semibold text-primary">上传文件</h2>
          <p className="mt-1 text-xs text-tertiary">只落地到 uploads/ 目录，项目源文件不可覆盖。</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-tertiary">文件</span>
              <input
                ref={fileRef}
                type="file"
                className="text-[13px] text-secondary file:mr-3 file:rounded-btn file:border file:border-subtle file:bg-raised file:px-3 file:py-1.5 file:text-[13px] file:text-primary"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-tertiary">子目录（可选）</span>
              <input value={upSubdir} onChange={(e) => setUpSubdir(e.target.value)} placeholder="docs" className={field} />
            </label>
            <Button onClick={doUpload} disabled={busy}>
              {busy ? "上传中…" : "上传"}
            </Button>
            <ButtonSecondary onClick={() => setShowUpload(false)} disabled={busy}>
              取消
            </ButtonSecondary>
          </div>
        </div>
      ) : null}

      <Section
        title="全部文件"
        hint={`共 ${visible.length} 项${keyword ? ` · 关键词「${keyword}」` : ""}`}
        action={
          <div className="flex flex-wrap gap-2">
            {SORTS.map((s) => (
              <Chip
                key={s.key}
                label={s.label}
                active={sort === s.key}
                onClick={() => onSort(s.key)}
                disabled={busy && live}
              />
            ))}
          </div>
        }
      >
        <div className="flex h-9 w-full items-center gap-4 px-4 text-xs text-tertiary">
          <span className="min-w-0 flex-1">名称</span>
          <span className="w-[96px] shrink-0">类型</span>
          <span className="w-[88px] shrink-0 text-right">大小</span>
          <span className="w-[140px] shrink-0 text-right">更新时间</span>
          <span className="w-[120px] shrink-0 text-right">操作</span>
        </div>

        <div className="flex flex-col gap-2">
          {visible.map((file) => (
            <div
              key={file.relPath}
              className="flex h-[52px] w-full items-center gap-4 rounded-row border border-subtle bg-card px-4 transition-colors hover:bg-raised"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <span className="text-tertiary">
                  <IconFolder size={18} />
                </span>
                <span className="truncate text-sm text-primary">{file.name}</span>
              </div>
              <span className="w-[96px] shrink-0 text-[13px] text-secondary">{file.kind}</span>
              <span className="w-[88px] shrink-0 text-right text-[13px] tabular-nums text-secondary">
                {file.size}
              </span>
              <span className="w-[140px] shrink-0 text-right text-[13px] tabular-nums text-tertiary">
                {file.updatedAt}
              </span>
              <div className="flex w-[120px] shrink-0 items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void copyPath(file)}
                  className="text-xs text-accent hover:underline"
                >
                  {copied === file.relPath ? "已复制" : "复制路径"}
                </button>
                {file.deletable ? (
                  <button
                    type="button"
                    onClick={() => void onDelete(file)}
                    disabled={busy}
                    className="text-xs text-plat-toutiao hover:underline disabled:opacity-50"
                  >
                    删除
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {visible.length === 0 ? (
            <div className="rounded-card border border-dashed border-subtle px-4 py-10 text-center text-[13px] text-tertiary">
              {busy ? "读取中…" : "没有匹配的文件"}
            </div>
          ) : null}
        </div>
      </Section>

      <DataSourceNote sources={[live ? "backend" : fileSource]} />
    </AppShell>
  );
}
