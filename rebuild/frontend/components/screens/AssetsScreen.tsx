"use client";

import { useCallback, useRef, useState } from "react";
import { AppShell, Section } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { Chip } from "@/components/Chip";
import { ImageEditor } from "@/components/ImageEditor";
import { KpiGrid } from "@/components/KpiGrid";
import { MaterialTile } from "@/components/MaterialTile";
import { DataSourceNote } from "@/components/DataSourceNote";
import { apiDelete, apiGet, ApiError } from "@/lib/clientApi";
import { toImageProxyUrl } from "@/lib/media";
import type { DataSource, Kpi, MaterialItem } from "@/lib/types";

const PAGE_SIZE = 48;

/** 分页条：上一页 / 页码 1 2 3 ... / 下一页 / 跳转输入 */
function PaginationBar({ page, total, onGo, disabled }: { page: number; total: number; onGo: (p: number) => void; disabled: boolean }) {
  const [jump, setJump] = useState("");

  // 生成页码列表：当前页 ±2，首尾固定
  const pages: (number | "...")[] = [];
  const radius = 2;
  const start = Math.max(2, page - radius);
  const end = Math.min(total - 1, page + radius);

  pages.push(1);
  if (start > 2) pages.push("...");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push("...");
  if (total > 1) pages.push(total);

  function doJump() {
    const n = parseInt(jump, 10);
    if (n >= 1 && n <= total) { onGo(n); setJump(""); }
  }

  const btn = "h-8 min-w-[32px] rounded-btn border border-subtle text-xs text-secondary hover:border-accent hover:text-accent disabled:opacity-40 transition";

  return (
    <div className="mt-4 flex items-center justify-center gap-1.5">
      <button className={btn} onClick={() => onGo(page - 1)} disabled={disabled || page <= 1}>上一页</button>
      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`dot-${i}`} className="px-1 text-xs text-tertiary">…</span>
        ) : (
          <button
            key={p}
            className={`${btn} ${p === page ? "border-accent bg-accent/10 text-accent font-semibold" : ""}`}
            onClick={() => onGo(p)}
            disabled={disabled}
          >
            {p}
          </button>
        ),
      )}
      <button className={btn} onClick={() => onGo(page + 1)} disabled={disabled || page >= total}>下一页</button>
      <span className="ml-3 text-xs text-tertiary">跳至</span>
      <input
        value={jump}
        onChange={(e) => setJump(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => { if (e.key === "Enter") doJump(); }}
        placeholder={`${total}`}
        className="h-8 w-12 rounded-btn border border-subtle bg-raised px-2 text-center text-xs text-primary focus:border-accent focus:outline-none"
      />
      <span className="text-xs text-tertiary">页</span>
      <button className={btn} onClick={doJump} disabled={disabled || !jump}>跳转</button>
    </div>
  );
}

interface MaterialOut {
  id: number;
  stem: string;
  work?: string | null;
  scene?: string | null;
  episode?: string | null;
  url?: string | null;
}
interface MaterialListResponse {
  total_indexed: number;
  returned: number;
  items: MaterialOut[];
}
interface SearchHit {
  material_id: number;
  stem: string;
  work?: string | null;
  episode?: string | null;
  url?: string | null;
  score: number;
  reason: string;
}
interface SearchResponse {
  query: string;
  keywords: string[];
  hits: SearchHit[];
}

function fromList(items: MaterialOut[]): MaterialItem[] {
  return items.map((m) => ({
    id: m.id,
    stem: m.stem,
    work: m.work ?? "未分类",
    scene: m.scene ?? "待补充用途",
    episode: m.episode ?? null,
    url: toImageProxyUrl(m.url),
  }));
}

function fromHits(hits: SearchHit[]): MaterialItem[] {
  return hits.map((h) => ({
    id: h.material_id,
    stem: h.stem,
    work: h.work ?? "未分类",
    scene: h.reason,
    episode: h.episode ?? null,
    url: toImageProxyUrl(h.url),
  }));
}

export function AssetsScreen({
  initialKpis,
  initialMaterials,
  initialWorks,
  kpiSource,
  materialSource,
}: {
  initialKpis: Kpi[];
  initialMaterials: MaterialItem[];
  initialWorks: { work: string; count: number }[];
  kpiSource: DataSource;
  materialSource: DataSource;
}) {
  const [items, setItems] = useState<MaterialItem[]>(initialMaterials);
  const [works] = useState(initialWorks);
  const [activeWork, setActiveWork] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [live, setLive] = useState(materialSource === "backend");

  // 分页
  const [total, setTotal] = useState(initialMaterials.length);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 图片编辑器
  const [editorItem, setEditorItem] = useState<MaterialItem | null>(null);
  const [editorInfo, setEditorInfo] = useState<{ width?: number; height?: number; format?: string; sizeBytes?: number }>({});

  const [showImport, setShowImport] = useState(false);
  const [impWork, setImpWork] = useState("");
  const [impScene, setImpScene] = useState("");
  const [impEpisode, setImpEpisode] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const loadByWork = useCallback(async (work: string | null, offset = 0) => {
    setBusy(true);
    setError(null);
    setKeywords([]);
    setQuery("");
    try {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset), source: "library" });
      if (work) qs.set("work", work);
      const res = await apiGet<MaterialListResponse>(`/materials?${qs.toString()}`);
      setItems(fromList(res.items ?? []));
      setTotal(res.total_indexed ?? 0);
      setLive(true);
    } catch (e) {
      setError((e as ApiError).message || "素材读取失败");
    } finally {
      setBusy(false);
    }
  }, []);

  const goToPage = useCallback((p: number, work: string | null) => {
    const clamped = Math.max(1, Math.min(totalPages, p));
    setPage(clamped);
    loadByWork(work, (clamped - 1) * PAGE_SIZE);
  }, [totalPages, loadByWork]);

  /** 切换筛选 → 回到第一页 */
  const refreshPage1 = useCallback((work: string | null) => {
    setPage(1);
    loadByWork(work, 0);
  }, [loadByWork]);

  const search = useCallback(async (q: string) => {
    const term = q.trim();
    if (!term) {
      await refreshPage1(null);
      setActiveWork(null);
      return;
    }
    setBusy(true);
    setError(null);
    setQuery(term);
    try {
      const res = await apiGet<SearchResponse>(
        `/materials/search?q=${encodeURIComponent(term)}&limit=${PAGE_SIZE}&include_recycle=false`,
      );
      setKeywords(res.keywords ?? []);
      setItems(fromHits(res.hits ?? []));
      setActiveWork(null);
      setLive(true);
    } catch (e) {
      setError((e as ApiError).message || "检索失败");
    } finally {
      setBusy(false);
    }
  }, [loadByWork]);

  async function deleteMaterial(id: number, stem: string) {
    if (!window.confirm(`确认删除素材「${stem}」？\n（软删除，进入回收站，文件保留可恢复）`)) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/materials/${id}`);
      setItems((prev) => prev.filter((it) => it.id !== id));
      setOk(`已删除「${stem}」（可在回收站恢复）`);
    } catch (e) {
      setError((e as ApiError).message || "删除失败");
    } finally {
      setBusy(false);
    }
  }

  /** 点击素材 → 打开预览/编辑弹窗，同时探测图片信息 */
  function openEditor(item: MaterialItem) {
    setEditorItem(item);
    setEditorInfo({});
    setOk(null);
    setError(null);
    // 异步探测图片真实尺寸
    if (item.url) {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => setEditorInfo({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => setEditorInfo({});
      img.src = item.url;
      // 用 HEAD 请求取 size / format（不下载整图）
      fetch(item.url, { method: "HEAD" })
        .then((r) => {
          const cl = r.headers.get("content-length");
          const ct = r.headers.get("content-type") || "";
          const fmt = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : ct.includes("gif") ? "gif" : ct.includes("jpeg") ? "jpeg" : "";
          setEditorInfo((prev) => ({
            ...prev,
            sizeBytes: cl ? Number(cl) : undefined,
            format: fmt || prev.format,
          }));
        })
        .catch(() => {});
    }
  }

  /** 裁切保存：blob → FormData → POST /materials */
  async function saveAsNew(blob: Blob, filename: string) {
    const fd = new FormData();
    fd.append("file", blob, filename);
    const work = editorItem?.work !== "未分类" ? (editorItem?.work ?? "") : "";
    if (work) fd.append("work", work);
    const res = await fetch("/api/materials", { method: "POST", body: fd });
    if (!res.ok) {
      const d = await res.json().catch(() => null) as { detail?: { message?: string } } | null;
      throw new Error(d?.detail?.message || "裁切保存失败");
    }
    await refreshPage1(activeWork);
  }

  /** 覆盖原图：blob → FormData → PATCH /materials/{id}/replace */
  async function overwriteOriginal(blob: Blob, materialId: number) {
    const fd = new FormData();
    fd.append("file", blob, "replaced.jpg");
    const res = await fetch(`/api/materials/${materialId}/replace`, { method: "PATCH", body: fd });
    if (!res.ok) {
      const d = await res.json().catch(() => null) as { detail?: { message?: string } } | null;
      throw new Error(d?.detail?.message || "覆盖失败");
    }
    await refreshPage1(activeWork);
  }

  /** 重命名：PATCH /materials/{id} */
  async function renameMaterial(materialId: number, newStem: string) {
    const fd = new FormData();
    fd.append("stem", newStem);
    const res = await fetch(`/api/materials/${materialId}`, { method: "PATCH", body: fd });
    if (!res.ok) {
      const d = await res.json().catch(() => null) as { detail?: { message?: string } } | null;
      throw new Error(d?.detail?.message || "重命名失败");
    }
    await refreshPage1(activeWork);
  }

  async function doImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("请选择要导入的图片");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (impWork.trim()) fd.append("work", impWork.trim());
      if (impScene.trim()) fd.append("scene", impScene.trim());
      if (impEpisode.trim()) fd.append("episode", impEpisode.trim());

      // multipart 不能走 clientApi（它固定 JSON），直接打同源代理
      const res = await fetch("/api/materials", { method: "POST", body: fd });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as
          | { detail?: { code?: string; message?: string } | string }
          | null;
        const d = detail?.detail;
        const msg = typeof d === "string" ? d : d?.message ?? res.statusText;
        throw new Error(
          res.status === 503
            ? "后端未配置素材根目录（MATERIALS_ROOT），文件未保存"
            : msg || "导入失败",
        );
      }
      const saved = (await res.json()) as MaterialOut;
      setOk(`已导入 ${saved.stem}${saved.url ? "" : "（未生成可访问地址）"}`);
      setShowImport(false);
      if (fileRef.current) fileRef.current.value = "";
      await refreshPage1(activeWork);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "h-9 w-full rounded-btn border border-subtle bg-raised px-3 text-[13px] text-primary focus:border-accent focus:outline-none";

  return (
    <AppShell
      title="配图管理"
      subtitle="命名规则 作品名_用途 · 缩略图由 Pillow 生成"
      actionLabel="导入素材"
      onAction={() => {
        setShowImport((v) => !v);
        setOk(null);
      }}
      onSearch={(q) => void search(q)}
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

      {showImport ? (
        <div className="mb-4 rounded-card border border-subtle bg-card p-4">
          <h2 className="text-[15px] font-semibold text-primary">导入素材</h2>
          <p className="mt-1 text-xs text-tertiary">
            文件会按「作品名_用途」重命名后存入素材库，同名不覆盖（自动加 _2）。
          </p>
          <div className="mt-3 grid grid-cols-4 gap-3">
            <label className="col-span-4 flex flex-col gap-1">
              <span className="text-xs text-tertiary">图片文件</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
                className="text-[13px] text-secondary file:mr-3 file:rounded-btn file:border file:border-subtle file:bg-raised file:px-3 file:py-1.5 file:text-[13px] file:text-primary"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-tertiary">作品名</span>
              <input value={impWork} onChange={(e) => setImpWork(e.target.value)} placeholder="沧元图" className={field} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-tertiary">用途 / 场景</span>
              <input value={impScene} onChange={(e) => setImpScene(e.target.value)} placeholder="打戏" className={field} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-tertiary">集数（可选）</span>
              <input value={impEpisode} onChange={(e) => setImpEpisode(e.target.value)} placeholder="21" className={field} />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={doImport} disabled={busy}>
              {busy ? "导入中…" : "导入"}
            </Button>
            <ButtonSecondary onClick={() => setShowImport(false)} disabled={busy}>
              取消
            </ButtonSecondary>
          </div>
        </div>
      ) : null}

      <Section title="素材概览">
        <KpiGrid items={initialKpis} />
      </Section>

      <Section
        title="素材库"
        hint={
          query
            ? `检索「${query}」${keywords.length ? ` · 关键词 ${keywords.join(" / ")}` : ""} · 显示 ${items.length}/${total} 条`
            : `${activeWork ?? "全部作品"} · 显示 ${items.length}/${total} 条`
        }
        action={
          query || activeWork ? (
            <ButtonSecondary
              onClick={() => {
                setActiveWork(null);
                void loadByWork(null);
              }}
              disabled={busy}
            >
              清除筛选
            </ButtonSecondary>
          ) : undefined
        }
      >
        <div className="mb-4 flex flex-wrap gap-2">
          <Chip
            label="全部"
            active={activeWork === null && !query}
            onClick={() => {
              setActiveWork(null);
              void loadByWork(null);
            }}
            disabled={busy}
          />
          {works.map((w) => (
            <Chip
              key={w.work}
              label={w.work}
              count={w.count}
              active={activeWork === w.work}
              onClick={() => {
                setActiveWork(w.work);
                void loadByWork(w.work);
              }}
              disabled={busy}
            />
          ))}
          {works.length === 0 ? (
            <span className="text-[13px] text-tertiary">后端未返回作品分组（素材库为空或未连接）</span>
          ) : null}
        </div>

        {items.length === 0 ? (
          <div className="rounded-card border border-dashed border-subtle px-4 py-10 text-center text-[13px] text-tertiary">
            {busy ? "读取中…" : "没有匹配的素材，换个关键词或清除筛选试试"}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-gap4">
              {items.map((item) => (
                <MaterialTile
                  key={`${item.id}-${item.stem}`}
                  item={item}
                  onClick={() => openEditor(item)}
                  onDelete={() => deleteMaterial(Number(item.id), item.stem)}
                />
              ))}
            </div>
            {totalPages > 1 ? <PaginationBar page={page} total={totalPages} onGo={(p) => goToPage(p, activeWork)} disabled={busy} /> : null}
          </>
        )}
      </Section>

      <DataSourceNote sources={[kpiSource, live ? "backend" : materialSource]} />

      {editorItem?.url ? (
        <ImageEditor
          src={editorItem.url}
          stem={editorItem.stem}
          materialId={Number(editorItem.id)}
          width={editorInfo.width}
          height={editorInfo.height}
          format={editorInfo.format}
          sizeBytes={editorInfo.sizeBytes}
          onClose={() => setEditorItem(null)}
          onSaveAsNew={saveAsNew}
          onOverwrite={overwriteOriginal}
          onRename={renameMaterial}
          onCopyPath={(s) => {
            navigator.clipboard.writeText(s).catch(() => {});
            setOk(`已复制路径「${s}」`);
          }}
          onDelete={() => {
            setEditorItem(null);
            deleteMaterial(Number(editorItem.id), editorItem.stem);
          }}
        />
      ) : null}
    </AppShell>
  );
}
