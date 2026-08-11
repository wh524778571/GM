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
  const [cropping, setCropping] = useState(false);
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // save dialog state
  const [saveMode, setSaveMode] = useState<"overwrite" | "new">("new");
  const [saveName, setSaveName] = useState("");
  const [croppedBlob, setCroppedBlob] = useState<Blob | null>(null);

  // rename state
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  // load image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      const c = canvasRef.current;
      if (!c) return;
      const maxW = Math.min(window.innerWidth * 0.8, 900);
      const s = Math.min(1, maxW / img.naturalWidth);
      setScale(s);
      c.width = img.naturalWidth * s;
      c.height = img.naturalHeight * s;
      drawView(c, img, s);
    };
    img.src = src;
  }, [src]);

  function drawView(c: HTMLCanvasElement, img: HTMLImageElement, s: number) {
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
  }

  function drawCropOverlay(c: HTMLCanvasElement, img: HTMLImageElement) {
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const { x, y, w, h } = cropRect;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, c.width, y);
    ctx.fillRect(0, y + h, c.width, c.height - y - h);
    ctx.fillRect(0, y, x, h);
    ctx.fillRect(x + w, y, c.width - x - w, h);
    ctx.strokeStyle = "#E5484D";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    const realW = Math.round(w / scale);
    const realH = Math.round(h / scale);
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    const label = `${realW} × ${realH}`;
    const m = ctx.measureText(label);
    const lx = x + 4;
    const ly = y > 20 ? y - 6 : y + h + 16;
    ctx.fillRect(lx - 2, ly - 14, m.width + 8, 18);
    ctx.fillStyle = "#fff";
    ctx.font = "12px Inter, sans-serif";
    ctx.fillText(label, lx + 2, ly);
  }

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    const img = imgRef.current;
    if (!c || !img) return;
    if (mode === "crop" && cropRect.w > 10) {
      drawCropOverlay(c, img);
    } else {
      drawView(c, img, scale);
    }
  }, [mode, cropRect, scale]);

  useEffect(() => { redraw(); }, [redraw]);

  function getCanvasPos(e: React.MouseEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (mode !== "crop") return;
    const { x, y } = getCanvasPos(e);
    setDragStart({ x, y });
    setCropRect({ x, y, w: 0, h: 0 });
    setCropping(true);
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!cropping || mode !== "crop") return;
    const { x, y } = getCanvasPos(e);
    const c = canvasRef.current!;
    setCropRect({
      x: Math.max(0, Math.min(dragStart.x, x)),
      y: Math.max(0, Math.min(dragStart.y, y)),
      w: Math.abs(x - dragStart.x),
      h: Math.abs(y - dragStart.y),
    });
  }

  function handleMouseUp() { setCropping(false); }

  /** 裁切选区 → blob，弹出保存选项 */
  function doCrop() {
    if (cropRect.w < 20 || cropRect.h < 20) {
      setMsg("选区太小，请重新框选"); return;
    }
    const c = document.createElement("canvas");
    const realX = Math.round(cropRect.x / scale);
    const realY = Math.round(cropRect.y / scale);
    const realW = Math.round(cropRect.w / scale);
    const realH = Math.round(cropRect.h / scale);
    c.width = realW;
    c.height = realH;
    c.getContext("2d")!.drawImage(imgRef.current!, realX, realY, realW, realH, 0, 0, realW, realH);
    c.toBlob((b) => {
      if (!b) { setMsg("裁切失败：Canvas 导出为空"); return; }
      setCroppedBlob(b);
      setSaveMode("new");
      setSaveName(stem.replace(/\.[^.]+$/, "") + "_裁切");
      setMode("saveDialog");
      setMsg(null);
    }, "image/jpeg", 0.92);
  }

  /** 执行保存 */
  async function commitSave() {
    if (!croppedBlob) return;
    setSaving(true);
    setMsg(null);
    try {
      if (saveMode === "overwrite") {
        await onOverwrite(croppedBlob, materialId);
        setMsg("✓ 已覆盖原图");
      } else {
        const name = saveName.trim() || stem;
        await onSaveAsNew(croppedBlob, `${name}.jpg`);
        setMsg(`✓ 已另存为「${name}.jpg」`);
      }
      setMode("view");
      setCropRect({ x: 0, y: 0, w: 0, h: 0 });
      setCroppedBlob(null);
    } catch (e) {
      setMsg(`保存失败: ${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setSaving(false);
    }
  }

  /** 执行重命名 */
  async function commitRename() {
    const v = renameValue.trim();
    if (!v || v === stem) { setMode("view"); return; }
    setRenaming(true);
    setMsg(null);
    try {
      await onRename(materialId, v);
      setStem(v);
      setMsg("✓ 已重命名");
      setMode("view");
    } catch (e) {
      setMsg(`重命名失败: ${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setRenaming(false);
    }
  }

  // ── render ──
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
            <ButtonSecondary className="h-7 text-xs px-3" onClick={() => { setMode("view"); setCropRect({ x: 0, y: 0, w: 0, h: 0 }); }}>取消裁切</ButtonSecondary>
            <Button className="h-7 text-xs px-3" onClick={doCrop}>确认裁切</Button>
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
      {mode === "crop" && cropRect.w > 10 ? (
        <span className="text-accent">选区 {Math.round(cropRect.w / scale)} × {Math.round(cropRect.h / scale)}</span>
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

        {/* rename input */}
        {mode === "rename" ? (
          <div className="flex items-center gap-3 border-b border-subtle px-5 py-3">
            <span className="text-xs text-tertiary whitespace-nowrap">新名称（不含扩展名）</span>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setMode("view"); }}
              className="h-8 flex-1 rounded-btn border border-subtle bg-raised px-3 text-[13px] text-primary focus:border-accent focus:outline-none"
              autoFocus
            />
          </div>
        ) : null}

        {/* save dialog */}
        {mode === "saveDialog" ? (
          <div className="flex flex-col gap-3 border-b border-subtle px-5 py-4">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-[13px] text-primary cursor-pointer">
                <input type="radio" name="saveMode" checked={saveMode === "overwrite"} onChange={() => setSaveMode("overwrite")} className="accent-[#E5484D]" />
                覆盖原图
              </label>
              <label className="flex items-center gap-2 text-[13px] text-primary cursor-pointer">
                <input type="radio" name="saveMode" checked={saveMode === "new"} onChange={() => setSaveMode("new")} className="accent-[#E5484D]" />
                另存为新图片
              </label>
            </div>
            {saveMode === "new" ? (
              <div className="flex items-center gap-3">
                <span className="text-xs text-tertiary whitespace-nowrap">文件名</span>
                <input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  className="h-8 flex-1 rounded-btn border border-subtle bg-raised px-3 text-[13px] text-primary focus:border-accent focus:outline-none"
                />
                <span className="text-xs text-tertiary whitespace-nowrap">.jpg</span>
              </div>
            ) : (
              <p className="text-xs text-plat-toutiao">⚠ 覆盖后原图将被替换，不可恢复</p>
            )}
            <div className="flex gap-2">
              <Button className="h-8 text-xs px-4" onClick={commitSave} disabled={saving}>{saving ? "保存中…" : "确认保存"}</Button>
              <ButtonSecondary className="h-8 text-xs px-4" onClick={() => { setMode("crop"); setCroppedBlob(null); }}>返回裁切</ButtonSecondary>
            </div>
          </div>
        ) : null}

        {/* canvas */}
        <div className="flex min-h-0 flex-1 items-center justify-center bg-[#0a0a0c] p-2">
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className={mode === "crop" ? "cursor-crosshair" : "cursor-default"}
            style={{ maxWidth: "100%", maxHeight: "60vh", objectFit: "contain" }}
          />
        </div>

        {infoBar}
      </div>
    </div>
  );
}
