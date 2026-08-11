"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { ButtonSecondary } from "@/components/ButtonSecondary";

/* ── types ──────────────────────────── */

interface ImageEditorProps {
  src: string; stem: string; materialId: number;
  width?: number; height?: number; format?: string; sizeBytes?: number;
  onClose: () => void;
  onSaveAsNew: (blob: Blob, filename: string) => Promise<void>;
  onOverwrite: (blob: Blob, materialId: number) => Promise<void>;
  onRename: (materialId: number, newStem: string) => Promise<void>;
  onCopyPath: (stem: string) => void;
  onDelete?: () => void;
}

function fmtSize(b: number) { return b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`; }

/* ── component ──────────────────────── */

export function ImageEditor({
  src, stem: initialStem, materialId, width, height, format, sizeBytes,
  onClose, onSaveAsNew, onOverwrite, onRename, onCopyPath, onDelete,
}: ImageEditorProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [stem, setStem] = useState(initialStem);
  const [msg, setMsg] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });

  // mode
  const [mode, setMode] = useState<"view" | "crop" | "saveDialog" | "rename">("view");

  // crop rect — 比例坐标 (0~1)，相对于原图
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // dragging state
  const [dragging, setDragging] = useState<"draw" | "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "w" | "e" | null>(null);
  const dragStart = useRef({ ex: 0, ey: 0, rx: 0, ry: 0, rw: 0, rh: 0 });

  // save dialog
  const [saveMode, setSaveMode] = useState<"overwrite" | "new">("new");
  const [saveName, setSaveName] = useState("");
  const [croppedBlob, setCroppedBlob] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);

  // rename
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  // preview crop with real px
  const cropPx = cropRect && naturalSize.w ? {
    x: Math.round(cropRect.x * naturalSize.w),
    y: Math.round(cropRect.y * naturalSize.h),
    w: Math.round(cropRect.w * naturalSize.w),
    h: Math.round(cropRect.h * naturalSize.h),
  } : null;

  /* ── helpers ───────────────────────── */

  /** 从鼠标事件算出相对于图片容器的比例坐标 (0~1) */
  const eventToRatio = useCallback((e: React.MouseEvent) => {
    const img = imgRef.current;
    if (!img) return { rx: 0, ry: 0 };
    const rect = img.getBoundingClientRect();
    return {
      rx: (e.clientX - rect.left) / rect.width,
      ry: (e.clientY - rect.top) / rect.height,
    };
  }, []);

  /* ── image load ────────────────────── */

  const srcBusted = reloadKey ? `${src}${src.includes("?") ? "&" : "?"}_t=${reloadKey}` : src;

  function onImgLoad() {
    const img = imgRef.current;
    if (img) setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
  }

  /* ── mouse handlers ────────────────── */

  function handleMouseDown(e: React.MouseEvent) {
    if (mode !== "crop") return;
    e.preventDefault();
    const { rx, ry } = eventToRatio(e);

    if (cropRect) {
      // check if clicking on a handle
      const h = getHandle(rx, ry);
      if (h) {
        setDragging(h);
        dragStart.current = { ex: rx, ey: ry, rx: cropRect.x, ry: cropRect.y, rw: cropRect.w, rh: cropRect.h };
        return;
      }
      // clicked outside → start new rect
      setCropRect(null);
    }
    setDragging("draw");
    dragStart.current = { ex: rx, ey: ry, rx, ry, rw: 0, rh: 0 };
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (mode !== "crop" || !dragging) return;
    e.preventDefault();
    const { rx, ry } = eventToRatio(e);
    const ds = dragStart.current;

    if (dragging === "draw") {
      const x = Math.min(ds.rx, rx), y = Math.min(ds.ry, ry);
      const w = Math.abs(rx - ds.rx), h = Math.abs(ry - ds.ry);
      if (w > 0.002 || h > 0.002) setCropRect({ x, y, w, h });
      return;
    }

    if (!cropRect) return;
    const dx = rx - ds.ex, dy = ry - ds.ey;
    let { x: crx, y: cry, w: crw, h: crh } = cropRect;

    switch (dragging) {
      case "nw": crx += dx; cry += dy; crw -= dx; crh -= dy; break;
      case "ne": cry += dy; crw += dx; crh -= dy; break;
      case "sw": crx += dx; crh += dy; crw -= dx; break;
      case "se": crw += dx; crh += dy; break;
      case "n": cry += dy; crh -= dy; break;
      case "s": crh += dy; break;
      case "w": crx += dx; crw -= dx; break;
      case "e": crw += dx; break;
      case "move": crx += dx; cry += dy; break;
    }
    // clamp
    crw = Math.max(0.01, Math.min(1 - crx, crw));
    crh = Math.max(0.01, Math.min(1 - cry, crh));
    crx = Math.max(0, Math.min(1 - crw, crx));
    cry = Math.max(0, Math.min(1 - crh, cry));
    setCropRect({ x: crx, y: cry, w: crw, h: crh });
    ds.ex = rx; ds.ey = ry;
  }

  function handleMouseUp() {
    setDragging(null);
  }

  /** 检测鼠标是否在把手/选框内，返回操作类型 */
  function getHandle(rx: number, ry: number): "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "w" | "e" | null {
    if (!cropRect) return null;
    const { x, y, w, h } = cropRect;
    const margin = 0.012; // ~12px on a 1000px image

    // corners first
    if (Math.abs(rx - x) < margin && Math.abs(ry - y) < margin) return "nw";
    if (Math.abs(rx - (x + w)) < margin && Math.abs(ry - y) < margin) return "ne";
    if (Math.abs(rx - x) < margin && Math.abs(ry - (y + h)) < margin) return "sw";
    if (Math.abs(rx - (x + w)) < margin && Math.abs(ry - (y + h)) < margin) return "se";
    // edges
    if (Math.abs(ry - y) < margin && rx > x + margin && rx < x + w - margin) return "n";
    if (Math.abs(ry - (y + h)) < margin && rx > x + margin && rx < x + w - margin) return "s";
    if (Math.abs(rx - x) < margin && ry > y + margin && ry < y + h - margin) return "w";
    if (Math.abs(rx - (x + w)) < margin && ry > y + margin && ry < y + h - margin) return "e";
    // inside
    if (rx > x && rx < x + w && ry > y && ry < y + h) return "move";
    return null;
  }

  function cursorClass() {
    if (mode !== "crop" || !cropRect) return "";
    if (dragging === "draw") return "";
    if (dragging === "move" || dragging === "nw" || dragging === "se") return "cursor-move";
    if (dragging) return "";
    return ""; // default crosshair from parent
  }

  /* ── crop → blob ───────────────────── */

  async function doCrop() {
    if (!cropPx || !imgRef.current) return;
    try {
      const c = document.createElement("canvas");
      c.width = cropPx.w; c.height = cropPx.h;
      c.getContext("2d")!.drawImage(imgRef.current, cropPx.x, cropPx.y, cropPx.w, cropPx.h, 0, 0, cropPx.w, cropPx.h);
      const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => b ? res(b) : rej(new Error()), "image/jpeg", 0.92));
      setCroppedBlob(blob);
      setSaveMode("new");
      setSaveName(stem.replace(/\.[^.]+$/, "") + "_裁切");
      setMode("saveDialog");
      setMsg(null);
    } catch { setMsg("裁切失败"); }
  }

  async function commitSave() {
    if (!croppedBlob) return;
    setSaving(true); setMsg(null);
    try {
      if (saveMode === "overwrite") { await onOverwrite(croppedBlob, materialId); setMsg("✓ 已覆盖原图"); setReloadKey(k => k + 1); }
      else { const n = saveName.trim() || stem; await onSaveAsNew(croppedBlob, `${n}.jpg`); setMsg(`✓ 已另存为「${n}.jpg」`); }
      setMode("view"); setCropRect(null); setCroppedBlob(null);
    } catch (e) { setMsg(`保存失败: ${e instanceof Error ? e.message : "?"}`); }
    finally { setSaving(false); }
  }

  async function commitRename() {
    const v = renameValue.trim(); if (!v || v === stem) { setMode("view"); return; }
    setRenaming(true); try { await onRename(materialId, v); setStem(v); setMsg("✓ 已重命名"); setMode("view"); }
    catch (e) { setMsg("重命名失败"); } finally { setRenaming(false); }
  }

  /* ── render ────────────────────────── */

  // crop overlay style (percentage-based, absolute on image)
  const overlayStyle = cropRect ? {
    left: `${cropRect.x * 100}%`, top: `${cropRect.y * 100}%`,
    width: `${cropRect.w * 100}%`, height: `${cropRect.h * 100}%`,
  } : { display: "none" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[90vh] w-full max-w-[960px] flex-col rounded-lg border border-subtle bg-card shadow-2xl">
        {/* header */}
        <div className="flex items-center gap-3 border-b border-subtle px-5 py-3">
          <h3 className="truncate text-[15px] font-semibold text-primary">{stem}</h3>
          <div className="ml-auto flex items-center gap-2">
            {mode === "view" ? (<>
              <ButtonSecondary className="h-7 text-xs px-3" onClick={() => setMode("crop")}>裁切</ButtonSecondary>
              <ButtonSecondary className="h-7 text-xs px-3" onClick={() => { setRenameValue(stem); setMode("rename"); }}>重命名</ButtonSecondary>
            </>) : mode === "rename" ? (<>
              <ButtonSecondary className="h-7 text-xs px-3" onClick={() => setMode("view")}>取消</ButtonSecondary>
              <Button className="h-7 text-xs px-3" onClick={commitRename} disabled={renaming}>{renaming ? "…" : "确认"}</Button>
            </>) : mode === "crop" ? (<>
              <ButtonSecondary className="h-7 text-xs px-3" onClick={() => { setMode("view"); setCropRect(null); }}>取消</ButtonSecondary>
              {cropPx && cropPx.w > 10 && cropPx.h > 10
                ? <Button className="h-7 text-xs px-3" onClick={doCrop}>确认裁切</Button>
                : <span className="text-xs text-tertiary">拖拽框选区域</span>}
            </>) : null}
            <button className="ml-2 text-lg text-tertiary hover:text-primary transition" onClick={onClose}>✕</button>
          </div>
        </div>

        {mode === "rename" ? (
          <div className="flex items-center gap-3 border-b border-subtle px-5 py-3">
            <span className="text-xs text-tertiary whitespace-nowrap">新名称（不含扩展名）</span>
            <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setMode("view"); }}
              className="h-8 flex-1 rounded-btn border border-subtle bg-raised px-3 text-[13px] text-primary focus:border-accent focus:outline-none" autoFocus />
          </div>
        ) : null}

        {mode === "saveDialog" ? (
          <div className="flex flex-col gap-3 border-b border-subtle px-5 py-4">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-[13px] text-primary cursor-pointer"><input type="radio" checked={saveMode==="overwrite"} onChange={()=>setSaveMode("overwrite")} className="accent-[#E5484D]" />覆盖原图</label>
              <label className="flex items-center gap-2 text-[13px] text-primary cursor-pointer"><input type="radio" checked={saveMode==="new"} onChange={()=>setSaveMode("new")} className="accent-[#E5484D]" />另存为新图片</label>
            </div>
            {saveMode === "new" ? (
              <div className="flex items-center gap-3"><span className="text-xs text-tertiary">文件名</span><input value={saveName} onChange={e=>setSaveName(e.target.value)} className="h-8 flex-1 rounded-btn border border-subtle bg-raised px-3 text-[13px] text-primary focus:border-accent focus:outline-none" /><span className="text-xs text-tertiary">.jpg</span></div>
            ) : <p className="text-xs text-plat-toutiao">⚠ 覆盖后原图将被替换，不可恢复</p>}
            <div className="flex gap-2">
              <Button className="h-8 text-xs px-4" onClick={commitSave} disabled={saving}>{saving ? "保存中…" : "确认保存"}</Button>
              <ButtonSecondary className="h-8 text-xs px-4" onClick={() => { setMode("crop"); setCroppedBlob(null); }}>返回裁切</ButtonSecondary>
            </div>
          </div>
        ) : null}

        {/* image area */}
        <div ref={containerRef}
          className="relative flex min-h-0 flex-1 items-center justify-center bg-[#0a0a0c] p-2"
          style={mode === "crop" ? { cursor: dragging ? undefined : "crosshair" } : undefined}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imgRef} src={srcBusted} alt={stem}
            onLoad={onImgLoad}
            draggable={false}
            className="max-h-[65vh] max-w-full object-contain select-none"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />

          {/* crop overlay — pure CSS, no canvas bullshit */}
          {mode === "crop" && cropRect ? (
            <div className="pointer-events-none absolute inset-0"
              style={{ width: "100%", height: "100%" }}>
              {/* darken outside */}
              <div style={{
                position: "absolute", inset: 0,
                background: `rgba(0,0,0,0.5)`,
                clipPath: `polygon(
                  0% 0%, 0% 100%, ${overlayStyle.left} 100%, ${overlayStyle.left} ${overlayStyle.top},
                  calc(${overlayStyle.left} + ${overlayStyle.width}) ${overlayStyle.top},
                  calc(${overlayStyle.left} + ${overlayStyle.width}) calc(${overlayStyle.top} + ${overlayStyle.height}),
                  ${overlayStyle.left} calc(${overlayStyle.top} + ${overlayStyle.height}),
                  ${overlayStyle.left} 100%, 100% 100%, 100% 0%
                )`,
              }} />
              {/* selection border */}
              <div className="pointer-events-auto absolute border-2 border-[#E5484D]"
                style={overlayStyle}>
                {/* 8 handles */}
                {(["nw","ne","sw","se","n","s","w","e"] as const).map(pos => {
                  const cs: Record<string, string> = {
                    nw: "-top-1.5 -left-1.5 cursor-nwse-resize",
                    ne: "-top-1.5 -right-1.5 cursor-nesw-resize",
                    sw: "-bottom-1.5 -left-1.5 cursor-nesw-resize",
                    se: "-bottom-1.5 -right-1.5 cursor-nwse-resize",
                    n: "-top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize",
                    s: "-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize",
                    w: "-left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize",
                    e: "-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize",
                  };
                  return (
                    <div key={pos} className={`absolute h-3 w-3 rounded-full border-2 border-[#E5484D] bg-white ${cs[pos]}`}
                      onMouseDown={(ev) => { ev.stopPropagation(); ev.preventDefault(); }}
                    />
                  );
                })}
                {/* size label */}
                <div className="absolute -top-7 left-1 rounded bg-black/70 px-2 py-0.5 text-[11px] text-white whitespace-nowrap">
                  {cropPx ? `${cropPx.w} × ${cropPx.h}` : ""}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* footer */}
        <div className="flex flex-wrap items-center gap-3 border-t border-subtle px-5 py-2.5 text-xs text-tertiary">
          {width && height ? <span>{width} × {height}</span> : null}
          {format ? <span className="uppercase">{format}</span> : null}
          {sizeBytes ? <span>{fmtSize(sizeBytes)}</span> : null}
          {cropPx && cropPx.w > 10 ? <span className="text-accent">选区 {cropPx.w} × {cropPx.h} · 拖拽把手调节</span> : null}
          {msg ? <span className={msg.startsWith("✓") ? "text-success" : "text-plat-toutiao"}>{msg}</span> : null}
          <div className="ml-auto flex gap-2">
            <ButtonSecondary className="h-7 text-xs px-2" onClick={() => { navigator.clipboard.writeText(stem); onCopyPath(stem); }}>复制路径</ButtonSecondary>
            {onDelete ? <ButtonSecondary className="h-7 text-xs px-2 text-plat-toutiao" onClick={onDelete}>删除</ButtonSecondary> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
