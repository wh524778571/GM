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
type HandlePos = "tl" | "tr" | "bl" | "br" | "tm" | "bm" | "ml" | "mr";
interface CropBox { x: number; y: number; w: number; h: number; }
type Mode = "view" | "crop" | "saveDialog" | "rename";

const MIN_CROP = 20;
const HANDLE_R = 6;

function fmtSize(b: number) { return b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`; }

export function ImageEditor({
  src, stem: initialStem, materialId, width, height, format, sizeBytes,
  onClose, onSaveAsNew, onOverwrite, onRename, onCopyPath, onDelete,
}: ImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [stem, setStem] = useState(initialStem);
  const [mode, setMode] = useState<Mode>("view");
  const [msg, setMsg] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // crop state
  const [crop, setCrop] = useState<CropBox | null>(null);
  const [dragging, setDragging] = useState<HandlePos | "draw" | "move" | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null>(null);
  const hoverRef = useRef<HandlePos | "draw" | "move" | null>(null);

  // save dialog
  const [saveMode, setSaveMode] = useState<"overwrite" | "new">("new");
  const [saveName, setSaveName] = useState("");
  const [croppedBlob, setCroppedBlob] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);

  // rename
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  /* ── coordinate helpers ────────────── */

  /** Canvas pos → image pixel (view-mode: image fits canvas, centered) */
  const viewScale = useCallback(() => {
    const c = canvasRef.current, img = imgRef.current;
    if (!c || !img) return { s: 1, dx: 0, dy: 0 };
    const s = Math.min(c.width / img.naturalWidth, c.height / img.naturalHeight);
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    return { s, dx: (c.width - dw) / 2, dy: (c.height - dh) / 2 };
  }, []);

  /** Canvas pos → image pixel (crop-mode: crop region fills canvas) */
  const cropScale = useCallback(() => {
    const c = canvasRef.current;
    if (!c || !crop) return { s: 1, dx: 0, dy: 0 };
    const s = Math.min(c.width / crop.w, c.height / crop.h);
    const dw = crop.w * s, dh = crop.h * s;
    return { s, dx: (c.width - dw) / 2, dy: (c.height - dh) / 2, cx: crop.x, cy: crop.y };
  }, [crop]);

  const e2view = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!, img = imgRef.current!;
    const r = c.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const { s, dx, dy } = viewScale();
    return { ix: (cx - dx) / s, iy: (cy - dy) / s, cx, cy };
  }, [viewScale]);

  const e2crop = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const { s, dx, dy, cx: cropX = 0, cy: cropY = 0 } = cropScale();
    return { ix: cropX + (cx - dx) / s, iy: cropY + (cy - dy) / s, cx, cy, s };
  }, [cropScale]);

  /* ── handle detection (crop-mode coords, threshold in image px) ── */

  function hitHandle(ix: number, iy: number, scale: number): HandlePos | "move" | null {
    if (!crop) return null;
    const th = (HANDLE_R + 4) / scale; // threshold in image pixels
    const hw = th, hh = th;
    const cx = crop.x, cy = crop.y, cw = crop.w, ch = crop.h;
    if (Math.abs(ix - cx) < hw && Math.abs(iy - cy) < hh) return "tl";
    if (Math.abs(ix - (cx + cw)) < hw && Math.abs(iy - cy) < hh) return "tr";
    if (Math.abs(ix - cx) < hw && Math.abs(iy - (cy + ch)) < hh) return "bl";
    if (Math.abs(ix - (cx + cw)) < hw && Math.abs(iy - (cy + ch)) < hh) return "br";
    if (ix > cx + hw && ix < cx + cw - hw && Math.abs(iy - cy) < hh) return "tm";
    if (ix > cx + hw && ix < cx + cw - hw && Math.abs(iy - (cy + ch)) < hh) return "bm";
    if (Math.abs(ix - cx) < hw && iy > cy + hh && iy < cy + ch - hh) return "ml";
    if (Math.abs(ix - (cx + cw)) < hw && iy > cy + hh && iy < cy + ch - hh) return "mr";
    if (ix > cx && ix < cx + cw && iy > cy && iy < cy + ch) return "move";
    return null;
  }

  function clamp(box: CropBox, img: HTMLImageElement): CropBox {
    let { x, y, w, h } = box;
    if (w < MIN_CROP) w = MIN_CROP;
    if (h < MIN_CROP) h = MIN_CROP;
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > img.naturalWidth) w = img.naturalWidth - x;
    if (y + h > img.naturalHeight) h = img.naturalHeight - y;
    if (w < MIN_CROP) w = MIN_CROP;
    if (h < MIN_CROP) h = MIN_CROP;
    return { x, y, w, h };
  }

  /* ── load image ────────────────────── */

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { imgRef.current = img; drawFrame(); };
    img.src = reloadKey ? `${src}${src.includes("?") ? "&" : "?"}_t=${reloadKey}` : src;
  }, [src, reloadKey]);

  /* ── draw ──────────────────────────── */

  const drawFrame = useCallback(() => {
    const c = canvasRef.current, img = imgRef.current;
    if (!c || !img) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);

    if (mode === "crop" && crop && crop.w >= MIN_CROP && crop.h >= MIN_CROP) {
      const s = Math.min(c.width / crop.w, c.height / crop.h);
      const dw = crop.w * s, dh = crop.h * s;
      const dx = (c.width - dw) / 2, dy = (c.height - dh) / 2;
      ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, dx, dy, dw, dh);

      // border
      ctx.strokeStyle = "rgba(229,72,77,0.6)";
      ctx.lineWidth = 1;
      ctx.strokeRect(dx, dy, dw, dh);

      // grid
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.lineWidth = 0.5;
      for (let i = 1; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(dx + dw * i / 3, dy); ctx.lineTo(dx + dw * i / 3, dy + dh); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(dx, dy + dh * i / 3); ctx.lineTo(dx + dw, dy + dh * i / 3); ctx.stroke();
      }

      // handles
      const hx = [dx, dx + dw / 2, dx + dw];
      const hy = [dy, dy + dh / 2, dy + dh];
      for (let r = 0; r < 3; r++)
        for (let cl = 0; cl < 3; cl++) {
          if (r === 1 && cl === 1) continue; // skip center
          ctx.fillStyle = "#fff";
          ctx.strokeStyle = "#E5484D";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(hx[cl], hy[r], HANDLE_R, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
        }

      // size label
      const lbl = `${Math.round(crop.w)} × ${Math.round(crop.h)}`;
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.font = "12px Inter, sans-serif";
      const m = ctx.measureText(lbl);
      ctx.fillRect(dx + 6, dy + 6, m.width + 8, 18);
      ctx.fillStyle = "#fff";
      ctx.fillText(lbl, dx + 10, dy + 20);
      ctx.restore();
    } else {
      const { s, dx, dy } = viewScale();
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      ctx.drawImage(img, dx, dy, dw, dh);
      // if in crop mode but no selection yet, show hint
      if (mode === "crop") {
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.font = "14px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("拖拽鼠标框选裁切区域", c.width / 2, c.height / 2);
        ctx.textAlign = "start";
      }
    }
  }, [mode, crop, src, viewScale]);

  useEffect(() => {
    const onResize = () => {
      const c = canvasRef.current; if (!c) return;
      c.width = Math.min(window.innerWidth * 0.85, 900);
      c.height = Math.min(window.innerHeight * 0.6, 600);
      drawFrame();
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [drawFrame]);

  useEffect(() => { drawFrame(); }, [drawFrame]);

  /* ── mouse events ──────────────────── */

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (mode !== "crop") return;
    const img = imgRef.current; if (!img) return;
    const ev = e2view(e); // always view coords for drawing

    // has existing crop → check handles first
    if (crop) {
      const { s } = cropScale();
      const h = hitHandle(e2crop(e).ix, e2crop(e).iy, s);
      if (h) {
        setDragging(h);
        dragRef.current = { sx: ev.cx, sy: ev.cy, ox: crop.x, oy: crop.y, ow: crop.w, oh: crop.h };
        return;
      }
      // clicked outside → restart drawing
      setCrop(null);
    }
    setDragging("draw");
    dragRef.current = { sx: ev.cx, sy: ev.cy, ox: ev.ix, oy: ev.iy, ow: img.naturalWidth, oh: img.naturalHeight };
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (mode !== "crop") return;
    const img = imgRef.current; if (!img) return;

    if (!dragging) {
      // hover detection (crop-mode coords)
      if (crop) {
        const ce = e2crop(e);
        hoverRef.current = hitHandle(ce.ix, ce.iy, ce.s);
      }
      return;
    }

    const dr = dragRef.current; if (!dr) return;

    if (dragging === "draw") {
      // draw: always use view coords
      const ev = e2view(e);
      const x1 = Math.max(0, Math.min(dr.ox, ev.ix));
      const y1 = Math.max(0, Math.min(dr.oy, ev.iy));
      const x2 = Math.min(img.naturalWidth, Math.max(dr.ox, ev.ix));
      const y2 = Math.min(img.naturalHeight, Math.max(dr.oy, ev.iy));
      const w = x2 - x1, h = y2 - y1;
      if (w > 1 || h > 1) setCrop({ x: x1, y: y1, w, h });
      return;
    }

    if (!crop) return;
    // handle drag: crop-mode coords
    const ce = e2crop(e);
    const dx = ce.ix - dr.ox, dy = ce.iy - dr.oy;
    let { x, y, w, h } = crop;

    switch (dragging) {
      case "tl": x += dx; y += dy; w -= dx; h -= dy; break;
      case "tr": y += dy; w += dx; h -= dy; break;
      case "bl": x += dx; h += dy; w -= dx; break;
      case "br": w += dx; h += dy; break;
      case "tm": y += dy; h -= dy; break;
      case "bm": h += dy; break;
      case "ml": x += dx; w -= dx; break;
      case "mr": w += dx; break;
      case "move": x += dx; y += dy; break;
    }
    setCrop(clamp({ x, y, w, h }, img));
    dr.ox = ce.ix; dr.oy = ce.iy;
  }

  function handleMouseUp() { setDragging(null); dragRef.current = null; }

  const cursorClass = (() => {
    if (mode !== "crop") return "cursor-default";
    if (dragging === "draw") return "cursor-crosshair";
    const h = dragging || hoverRef.current;
    if (h === "tl" || h === "br") return "cursor-nwse-resize";
    if (h === "tr" || h === "bl") return "cursor-nesw-resize";
    if (h === "tm" || h === "bm") return "cursor-ns-resize";
    if (h === "ml" || h === "mr") return "cursor-ew-resize";
    if (h === "move") return "cursor-move";
    if (crop) return "cursor-move";
    return "cursor-crosshair";
  })();

  /* ── crop → blob ───────────────────── */

  async function doCrop() {
    if (!crop || !imgRef.current) return;
    try {
      const c = document.createElement("canvas");
      c.width = Math.round(crop.w); c.height = Math.round(crop.h);
      c.getContext("2d")!.drawImage(imgRef.current, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => b ? res(b) : rej(new Error("fail")), "image/jpeg", 0.92));
      setCroppedBlob(blob);
      setSaveMode("new");
      setSaveName(stem.replace(/\.[^.]+$/, "") + "_裁切");
      setMode("saveDialog");
      setMsg(null);
    } catch { setMsg("裁切失败，请重试"); }
  }

  async function commitSave() {
    if (!croppedBlob) return;
    setSaving(true); setMsg(null);
    try {
      if (saveMode === "overwrite") { await onOverwrite(croppedBlob, materialId); setMsg("✓ 已覆盖原图"); setReloadKey((k) => k + 1); }
      else { const n = saveName.trim() || stem; await onSaveAsNew(croppedBlob, `${n}.jpg`); setMsg(`✓ 已另存为「${n}.jpg」`); }
      setMode("view"); setCrop(null); setCroppedBlob(null);
    } catch (e) { setMsg(`保存失败: ${e instanceof Error ? e.message : "未知错误"}`); }
    finally { setSaving(false); }
  }

  async function commitRename() {
    const v = renameValue.trim(); if (!v || v === stem) { setMode("view"); return; }
    setRenaming(true); setMsg(null);
    try { await onRename(materialId, v); setStem(v); setMsg("✓ 已重命名"); setMode("view"); }
    catch (e) { setMsg(`重命名失败: ${e instanceof Error ? e.message : "未知错误"}`); }
    finally { setRenaming(false); }
  }

  /* ── render ────────────────────────── */

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
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
              <ButtonSecondary className="h-7 text-xs px-3" onClick={() => { setMode("view"); setCrop(null); }}>取消</ButtonSecondary>
              {crop ? <Button className="h-7 text-xs px-3" onClick={doCrop}>确认裁切</Button>
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
              <label className="flex items-center gap-2 text-[13px] text-primary cursor-pointer"><input type="radio" checked={saveMode === "overwrite"} onChange={() => setSaveMode("overwrite")} className="accent-[#E5484D]" />覆盖原图</label>
              <label className="flex items-center gap-2 text-[13px] text-primary cursor-pointer"><input type="radio" checked={saveMode === "new"} onChange={() => setSaveMode("new")} className="accent-[#E5484D]" />另存为新图片</label>
            </div>
            {saveMode === "new" ? (
              <div className="flex items-center gap-3"><span className="text-xs text-tertiary">文件名</span><input value={saveName} onChange={(e) => setSaveName(e.target.value)} className="h-8 flex-1 rounded-btn border border-subtle bg-raised px-3 text-[13px] text-primary focus:border-accent focus:outline-none" /><span className="text-xs text-tertiary">.jpg</span></div>
            ) : <p className="text-xs text-plat-toutiao">⚠ 覆盖后原图将被替换，不可恢复</p>}
            <div className="flex gap-2">
              <Button className="h-8 text-xs px-4" onClick={commitSave} disabled={saving}>{saving ? "保存中…" : "确认保存"}</Button>
              <ButtonSecondary className="h-8 text-xs px-4" onClick={() => { setMode("crop"); setCroppedBlob(null); }}>返回裁切</ButtonSecondary>
            </div>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 items-center justify-center bg-[#0a0a0c] p-2">
          <canvas ref={canvasRef}
            onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
            className={cursorClass}
            style={{ maxWidth: "100%", maxHeight: "65vh" }} />
        </div>

        {/* footer */}
        <div className="flex flex-wrap items-center gap-3 border-t border-subtle px-5 py-2.5 text-xs text-tertiary">
          {width && height ? <span>{width} × {height}</span> : null}
          {format ? <span className="uppercase">{format}</span> : null}
          {sizeBytes ? <span>{fmtSize(sizeBytes)}</span> : null}
          {mode === "crop" && crop ? <span className="text-accent">选区 {Math.round(crop.w)} × {Math.round(crop.h)} · 拖拽把手调节</span> : null}
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
