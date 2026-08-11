"use client";

import { useEffect, useState } from "react";
import { MaterialTile } from "@/components/MaterialTile";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { apiGet, ApiError } from "@/lib/clientApi";
import { toImageProxyUrl } from "@/lib/media";

interface PickerMaterial {
  id: number;
  path: string | null;
  stem: string;
  work: string | null;
  scene: string | null;
  episode: string | null;
  url: string | null;
}

/** 写文章时从素材库手动挑一张图，绑定到当前配图占位符。 */
export function MaterialPicker({
  open,
  initialQuery,
  onClose,
  onPick,
}: {
  open: boolean;
  initialQuery?: string;
  onClose: () => void;
  onPick: (m: { id: number; path: string | null; stem: string; url: string | null }) => void;
}) {
  const [items, setItems] = useState<PickerMaterial[]>([]);
  const [works, setWorks] = useState<{ work: string; count: number }[]>([]);
  const [activeWork, setActiveWork] = useState<string | null>(null);
  const [q, setQ] = useState(initialQuery ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setQ(initialQuery ?? "");
  }, [open, initialQuery]);

  // 打开时拉一次作品分类（用于筛选 chips）
  useEffect(() => {
    if (!open) return;
    let alive = true;
    apiGet<{ works: { work: string; count: number }[] }>(`/materials/works`)
      .then((r) => alive && setWorks(r.works ?? []))
      .catch(() => {
        /* 分类拉不到不影响主列表 */
      });
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setBusy(true);
    setError(null);
    const qs = new URLSearchParams({ source: "library", limit: "60" });
    if (q.trim()) qs.set("keyword", q.trim());
    if (activeWork) qs.set("work", activeWork);
    apiGet<{ items: PickerMaterial[] }>(`/materials?${qs.toString()}`)
      .then((r) =>
        alive &&
        setItems(
          (r.items ?? []).map((m) => ({ ...m, url: toImageProxyUrl(m.url) })),
        ),
      )
      .catch((e) => alive && setError((e as ApiError).message || "读取失败"))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [open, q, activeWork]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-[760px] flex-col rounded-card border border-subtle bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-subtle px-4 py-3">
          <h3 className="text-[15px] font-semibold text-primary">从素材库选择配图</h3>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="按作品名 / 用途搜索"
            className="ml-auto h-9 w-56 rounded-btn border border-subtle bg-raised px-3 text-[13px] text-primary focus:border-accent focus:outline-none"
          />
          <ButtonSecondary className="h-9 px-3" onClick={onClose}>
            关闭
          </ButtonSecondary>
        </div>
        {works.length > 1 ? (
          <div className="flex flex-wrap gap-2 border-b border-subtle px-4 py-3">
            <button
              type="button"
              onClick={() => setActiveWork(null)}
              className={
                "h-8 rounded-full px-3 text-[12px] transition " +
                (activeWork === null
                  ? "bg-accent text-white"
                  : "border border-subtle bg-raised text-secondary hover:border-accent")
              }
            >
              全部
            </button>
            {works.map((w) => (
              <button
                key={w.work}
                type="button"
                onClick={() => setActiveWork(w.work)}
                className={
                  "h-8 rounded-full px-3 text-[12px] transition " +
                  (activeWork === w.work
                    ? "bg-accent text-white"
                    : "border border-subtle bg-raised text-secondary hover:border-accent")
                }
              >
                {w.work}
                <span className="ml-1 opacity-60">{w.count}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-gap4 overflow-y-auto p-4">
          {busy ? (
            <div className="text-[13px] text-tertiary">读取中…</div>
          ) : error ? (
            <div className="text-[13px] text-plat-toutiao">{error}</div>
          ) : items.length === 0 ? (
            <div className="text-[13px] text-tertiary">没有匹配的素材，换个关键词试试</div>
          ) : (
            items.map((m) => (
              <MaterialTile
                key={m.id}
                item={{
                  id: m.id,
                  stem: m.stem,
                  work: m.work ?? "未分类",
                  scene: m.scene ?? "",
                  episode: m.episode,
                  url: m.url,
                }}
                onClick={() => onPick({ id: m.id, path: m.path, stem: m.stem, url: m.url })}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
