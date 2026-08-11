"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { ButtonSecondary } from "@/components/ButtonSecondary";

interface ImageEditorProps {
  src: string;
  stem: string;
  materialId: number;
  width?: number;
  height?: number;
  format?: string;
  sizeBytes?: number;
  onClose: () => void;
  onSaveAsNew: (blob: Blob, filename: string) => Promise<void>;
  onOverwrite: (blob: Blob, materialId: number) => Promise<void>;
  onRename: (materialId: number, newStem: string) => Promise<void>;
  onCopyPath: (stem: string) => void;
  onDelete?: () => void;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const HANDLE_SIZE = 10;
const MIN_CROP = 20;

type HandlePos = "tl" | "tr" | "bl" | "br" | "tm" | "bm" | "ml" | "mr";

/** 裁切框（像素坐标，基于原始图分辨率） */
interface CropBox { x: number; y: number; w: number; h: number; }

export function ImageEditor({
  src,
  stem: initialStem,
  materialId,
  width,
  height,
  format,
  sizeBytes,
  onClose,
  onSaveAsNew,
  onOverwrite,
  onRename,
  onCopyPath,
  onDelete,
}: ImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [stem, setStem] = useState(initialStem);
  const [mode, setMode] = useState<"view" | "crop" | "saveDialog" | "rename">("view");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // 裁切状态
  const [crop, setCrop] = useState<CropBox | null>(null);
  const [dragging, setDragging] = useState<HandlePos | "draw" | "move" | null>(null);
  const [hoverHandle, setHoverHandle] = useState<HandlePos | "move" | null>(null);
  const dragRef = useRef({ sx: 0, sy: 0, ox: 0, oy: 0, ow: 0, oh: 0 });

  // save dialog
  const [saveMode, setSaveMode] = useState<"overwrite" | "new">("new");
  const [saveName, setSaveName] = useState("");
  const [croppedBlob, setCroppedBlob] = useState<Blob | null>(null);

  // rename
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  // load image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const bustedSrc = reloadKey ? `${src}${src.includes("?") ? "&" : "?"}_t=${reloadKey}` : src;
    img.onload = () => { imgRef.current = img; drawFrame(); };
    img.src = bustedSrc;
  }, [src, reloadKey]);

  /* ── 绘制 ──────────────────────────── */

  const drawFrame = useCallback(() => {
    const c = canvasRef.current;
    const img = imgRef.current;
    if (!c || !img) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);

    if (mode === "crop" && crop) {
      // 裁切区域铺满 canvas
      const s = Math.min(c.width / crop.w, c.height / crop.h);
      const dw = crop.w * s, dh = crop.h * s;
      const dx = (c.width - dw) / 2, dy = (c.height - dh) / 2;
      ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, dx, dy, dw, dh);

      // handles（在画布坐标计算）
      const hSize = HANDLE_SIZE / s;
      const handles: { pos: HandlePos; rx: number; ry: number }[] = [
        { pos: "tl", rx: crop.x, ry: crop.y },
        { pos: "tr", rx: crop.x + crop.w, ry: crop.y },
        { pos: "bl", rx: crop.x, ry: crop.y + crop.h },
        { pos: "br", rx: crop.x + crop.w, ry: crop.y + crop.h },
        { pos: "tm", rx: crop.x + crop.w / 2, ry: crop.y },
        { pos: "bm", rx: crop.x + crop.w / 2, ry: crop.y + crop.h },
        { pos: "ml", rx: crop.x, ry: crop.y + crop.h / 2 },
        { pos: "mr", rx: crop.x + crop.w, ry: crop.y + crop.h / 2 },
      ];

      // 裁剪边界线
      ctx.save();
      ctx.strokeStyle = "rgba(229,72,77,0.7)";
      ctx.lineWidth = 1.5 / s;
      const bx = dx + (crop.x - crop.x) * s, by = dy + (crop.y - crop.y) * s; // 简化：边界即图像边缘
      ctx.strokeRect(dx, dy, dw, dh);

      // 九宫格辅助线
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 0.5 / s;
      for (let i = 1; i < 3; i++) {
        const lx = dx + dw * i / 3;
        ctx.beginPath(); ctx.moveTo(lx, dy); ctx.lineTo(lx, dy + dh); ctx.stroke();
        const ly = dy + dh * i / 3;
        ctx.beginPath(); ctx.moveTo(dx, ly); ctx.lineTo(dx + dw, ly); ctx.stroke();
      }

      // handles
      for (const h of handles) {
        const hcx = dx + (h.rx - crop.x) * s;
        const hcy = dy + (h.ry - crop.y) * s;
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#E5484D";
        ctx.lineWidth = 2 / s;
        ctx.beginPath();
        ctx.arc(hcx, hcy, HANDLE_SIZE / s, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();

      // 尺寸标签
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      const label = `${Math.round(crop.w)} × ${Math.round(crop.h)}`;
      ctx.font = `${Math.max(12, 14 / s)}px Inter, sans-serif`;
      const tm = ctx.measureText(label);
      const pad = 4 / s;
      ctx.fillRect(dx + 6 / s, dy + 6 / s, tm.width + pad * 2, 20 / s);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, dx + 6 / s + pad, dy + 6 / s + 14 / s);
    } else {
      // view 模式：铺满
      const s = Math.min(c.width / img.naturalWidth, c.height / img.naturalHeight);
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      ctx.drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
    }
  }, [mode, crop, src]);

  // resize canvas
  useEffect(() => {
    const onResize = () => {
      const c = canvasRef.current;
      if (!c) return;
      c.width = Math.min(window.innerWidth * 0.85, 900);
      c.height = Math.min(window.innerHeight * 0.6, 600);
      drawFrame();
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [drawFrame]);

  useEffect(() => { drawFrame(); }, [drawFrame]);

  /* ── 鼠标交互 ──────────────────────── */

  function posToImg(e: React.MouseEvent<HTMLCanvasElement>): { ix: number; iy: number } {
    const c = canvasRef.current!;
    const img = imgRef.current;
    if (!img) return { ix: 0, iy: 0 };
    const rect = c.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    if (!crop) {
      // view 模式：图像居中缩放
      const s = Math.min(c.width / img.naturalWidth, c.height / img.naturalHeight);
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      const dx = (c.width - dw) / 2, dy = (c.height - dh) / 2;
      return { ix: (cx - dx) / s, iy: (cy - dy) / s };
    }
    // crop 模式：裁切区域铺满
    const s = Math.min(c.width / crop.w, c.height / crop.h);
    const dw = crop.w * s, dh = crop.h * s;
    const dx = (c.width - dw) / 2, dy = (c.height - dh) / 2;
    return { ix: crop.x + (cx - dx) / s, iy: crop.y + (cy - dy) / s };
  }

  function hitHandle(ix: number, iy: number): HandlePos | "move" | null {
    if (!crop) return null;
    const threshold = HANDLE_SIZE + 4;
    const hh = threshold / 2;
    const halfW = hh, halfH = hh;
    if (Math.abs(ix - crop.x) < halfW && Math.abs(iy - crop.y) < halfH) return "tl";
    if (Math.abs(ix - (crop.x + crop.w)) < halfW && Math.abs(iy - crop.y) < halfH) return "tr";
    if (Math.abs(ix - crop.x) < halfW && Math.abs(iy - (crop.y + crop.h)) < halfH) return "bl";
    if (Math.abs(ix - (crop.x + crop.w)) < halfW && Math.abs(iy - (crop.y + crop.h)) < halfH) return "br";
    if (ix > crop.x + halfW && ix < crop.x + crop.w - halfW && Math.abs(iy - crop.y) < halfH) return "tm";
    if (ix > crop.x + halfW && ix < crop.x + crop.w - halfW && Math.abs(iy - (crop.y + crop.h)) < halfH) return "bm";
    if (Math.abs(ix - crop.x) < halfW && iy > crop.y + halfH && iy < crop.y + crop.h - halfH) return "ml";
    if (Math.abs(ix - (crop.x + crop.w)) < halfW && iy > crop.y + halfH && iy < crop.y + crop.h - halfH) return "mr";
    if (ix > crop.x && ix < crop.x + crop.w && iy > crop.y && iy < crop.y + crop.h) return "move";
    return null;
  }

  function clampCrop(box: CropBox, img: HTMLImageElement): CropBox {
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

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (mode !== "crop") return;
    const { ix, iy } = posToImg(e);
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const img = imgRef.current;
    if (!img) return;

    if (crop) {
      const h = hitHandle(ix, iy);
      if (h) {
        setDragging(h);
        dragRef.current = { sx: cx, sy: cy, ox: crop.x, oy: crop.y, ow: crop.w, oh: crop.h };
        return;
      }
      // 点在外面 → 重新框选
      setCrop(null);
      setDragging("draw");
      dragRef.current = { sx: cx, sy: cy, ox: ix, oy: iy, ow: img.naturalWidth, oh: img.naturalHeight };
      return;
    }
    // 无现有框选 → 画新框
    setDragging("draw");
    dragRef.current = { sx: cx, sy: cy, ox: ix, oy: iy, ow: img.naturalWidth, oh: img.naturalHeight };
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const { ix, iy } = posToImg(e);
    // hover 检测（非拖拽时更新光标）
    if (!dragging && crop) {
      setHoverHandle(hitHandle(ix, iy));
    }
    if (!dragging || mode !== "crop") return;
    const img = imgRef.current;
    if (!img) return;
    const dr = dragRef.current;

    if (dragging === "draw") {
      // 拖出新选区（图像坐标）
      const x1 = Math.max(0, Math.min(dr.ox, ix));
      const y1 = Math.max(0, Math.min(dr.oy, iy));
      const x2 = Math.min(img.naturalWidth, Math.max(dr.ox, ix));
      const y2 = Math.min(img.naturalHeight, Math.max(dr.oy, iy));
      setCrop({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
      return;
    }

    if (!crop) return;
    // 拖拽 handle，更新 crop 位置（图像坐标）
    let { x, y, w, h } = crop;
    const dx = ix - dr.ox, dy = iy - dr.oy;

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
    setCrop(clampCrop({ x, y, w, h }, img));
    dr.ox = ix; dr.oy = iy;
  }

  function handleMouseUp() {
    setDragging(null);
  }

  /** 裁切 → blob（异步） */
  function cropToBlob(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!crop || !imgRef.current) return reject(new Error("no crop"));
      const c = document.createElement("canvas");
      c.width = Math.round(crop.w);
      c.height = Math.round(crop.h);
      c.getContext("2d")!.drawImage(imgRef.current, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
      c.toBlob((b) => { if (b) resolve(b); else reject(new Error("toBlob failed")); }, "image/jpeg", 0.92);
    });
  }

  async function doCrop() {
    try {
      const b = await cropToBlob();
      setCroppedBlob(b);
      setSaveMode("new");
      setSaveName(stem.replace(/\.[^.]+$/, "") + "_裁切");
      setMode("saveDialog");
      setMsg(null);
    } catch {
      setMsg("选区太小，请重新框选");
    }
  }

  async function commitSave() {
    if (!croppedBlob) return;
    setSaving(true); setMsg(null);
    try {
      if (saveMode === "overwrite") {
        await onOverwrite(croppedBlob, materialId);
        setMsg("✓ 已覆盖原图");
        setReloadKey((k) => k + 1);
      } else {
        const name = saveName.trim() || stem;
        await onSaveAsNew(croppedBlob, `${name}.jpg`);
        setMsg(`✓ 已另存为「${name}.jpg」`);
      }
      setMode("view"); setCrop(null); setCroppedBlob(null);
    } catch (e) {
      setMsg(`保存失败: ${e instanceof Error ? e.message : "未知错误"}`);
    } finally { setSaving(false); }
  }

  async function commitRename() {
    const v = renameValue.trim();
    if (!v || v === stem) { setMode("view"); return; }
    setRenaming(true); setMsg(null);
    try { await onRename(materialId, v); setStem(v); setMsg("✓ 已重命名"); setMode("view"); }
    catch (e) { setMsg(`重命名失败: ${e instanceof Error ? e.message : "未知错误"}`); }
    finally { setRenaming(false); }
  }

  /* ── 光标样式 ──────────────────────── */

  const cursorClass = (() => {
    if (mode !== "crop") return "cursor-default";
    if (dragging === "draw") return "cursor-crosshair";
    if (dragging === "move") return "cursor-move";
    const h = dragging || hoverHandle;
    if (h === "tl" || h === "br") return "cursor-nwse-resize";
    if (h === "tr" || h === "bl") return "cursor-nesw-resize";
    if (h === "tm" || h === "bm") return "cursor-ns-resize";
    if (h === "ml" || h === "mr") return "cursor-ew-resize";
    if (h === "move") return "cursor-move";
    if (crop) return "cursor-move";
    return "cursor-crosshair";
  })();

  /* ── render ────────────────────────── */

  const header = (
    <div className="flex items-center gap-3 border-b border-subtle px-5 py-3">
      <h3 className="truncate text-[15px] font-semibold text-primary">{stem}</h3>
      <div className="ml-auto flex items-center gap-2">
        {mode === "view" ? (
          <>
            <ButtonSecondary className="h-7 text-xs px-3" onClick={() => setMode("crop")}>裁切</ButtonSecondary>
            <ButtonSecondary className="h-7 text-xs px-3" onClick={() => { setRenameValue(stem); setMode("rename"); }}>重命名</ButtonSecondary>
          </>
        ) : mode === "rename" ? (
          <>
            <ButtonSecondary className="h-7 text-xs px-3" onClick={() => setMode("view")}>取消</ButtonSecondary>
            <Button className="h-7 text-xs px-3" onClick={commitRename} disabled={renaming}>{renaming ? "…" : "确认"}</Button>
          </>
        ) : mode === "crop" ? (
          <>
            <ButtonSecondary className="h-7 text-xs px-3" onClick={() => { setMode("view"); setCrop(null); }}>取消</ButtonSecondary>
            {crop ? (
              <Button className="h-7 text-xs px-3" onClick={doCrop}>确认裁切</Button>
            ) : (
              <span className="text-xs text-tertiary">拖拽框选区域</span>
            )}
          </>
        ) : null}
        <button className="ml-2 text-lg text-tertiary hover:text-primary transition" onClick={onClose} title="关闭">✕</button>
      </div>
    </div>
  );

  const infoBar = (
    <div className="flex flex-wrap items-center gap-3 border-t border-subtle px-5 py-2.5 text-xs text-tertiary">
      {width && height ? <span>{width} × {height}</span> : null}
      {format ? <span className="uppercase">{format}</span> : null}
      {sizeBytes ? <span>{fmtSize(sizeBytes)}</span> : null}
      {mode === "crop" && crop ? (
        <span className="text-accent">选区 {Math.round(crop.w)} × {Math.round(crop.h)} · 拖拽把手调节</span>
      ) : null}
      {msg ? <span className={msg.startsWith("✓") ? "text-success" : "text-plat-toutiao"}>{msg}</span> : null}
      <div className="ml-auto flex gap-2">
        <ButtonSecondary className="h-7 text-xs px-2" onClick={() => { navigator.clipboard.writeText(stem); onCopyPath(stem); }}>复制路径</ButtonSecondary>
        {onDelete ? <ButtonSecondary className="h-7 text-xs px-2 text-plat-toutiao" onClick={onDelete}>删除</ButtonSecondary> : null}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[90vh] w-full max-w-[960px] flex-col rounded-lg border border-subtle bg-card shadow-2xl">
        {header}

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
              <label className="flex items-center gap-2 text-[13px] text-primary cursor-pointer"><input type="radio" name="saveMode" checked={saveMode === "overwrite"} onChange={() => setSaveMode("overwrite")} className="accent-[#E5484D]" />覆盖原图</label>
              <label className="flex items-center gap-2 text-[13px] text-primary cursor-pointer"><input type="radio" name="saveMode" checked={saveMode === "new"} onChange={() => setSaveMode("new")} className="accent-[#E5484D]" />另存为新图片</label>
            </div>
            {saveMode === "new" ? (
              <div className="flex items-center gap-3"><span className="text-xs text-tertiary whitespace-nowrap">文件名</span><input value={saveName} onChange={(e) => setSaveName(e.target.value)} className="h-8 flex-1 rounded-btn border border-subtle bg-raised px-3 text-[13px] text-primary focus:border-accent focus:outline-none" /><span className="text-xs text-tertiary whitespace-nowrap">.jpg</span></div>
            ) : <p className="text-xs text-plat-toutiao">⚠ 覆盖后原图将被替换，不可恢复</p>}
            <div className="flex gap-2">
              <Button className="h-8 text-xs px-4" onClick={commitSave} disabled={saving}>{saving ? "保存中…" : "确认保存"}</Button>
              <ButtonSecondary className="h-8 text-xs px-4" onClick={() => { setMode("crop"); setCroppedBlob(null); }}>返回裁切</ButtonSecondary>
            </div>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 items-center justify-center bg-[#0a0a0c] p-2">
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className={cursorClass}
            style={{ maxWidth: "100%", maxHeight: "65vh", objectFit: "contain" }}
          />
        </div>

        {infoBar}
      </div>
    </div>
  );
}
