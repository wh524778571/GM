"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { ButtonSecondary } from "@/components/ButtonSecondary";

interface ImageEditorProps {
  src: string;
  stem: string;
  width?: number;
  height?: number;
  format?: string;
  sizeBytes?: number;
  onClose: () => void;
  onSaveCropped: (blob: Blob, filename: string) => Promise<void>;
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
  stem,
  width,
  height,
  format,
  sizeBytes,
  onClose,
  onSaveCropped,
  onCopyPath,
  onDelete,
}: ImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [mode, setMode] = useState<"view" | "crop">("view");
  const [cropping, setCropping] = useState(false);
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // load image and draw
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

  function drawCropOverlay(c: HTMLCanvasElement, img: HTMLImageElement, s: number) {
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    // darken outside crop rect
    const { x, y, w, h } = cropRect;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, c.width, y);
    ctx.fillRect(0, y + h, c.width, c.height - y - h);
    ctx.fillRect(0, y, x, h);
    ctx.fillRect(x + w, y, c.width - x - w, h);
    // border
    ctx.strokeStyle = "#E5484D";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    // size label
    const realW = Math.round(w / s);
    const realH = Math.round(h / s);
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
      drawCropOverlay(c, img, scale);
    } else {
      drawView(c, img, scale);
    }
  }, [mode, cropRect, scale]);

  // redraw when mode/crop change
  useEffect(() => {
    redraw();
  }, [redraw]);

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
    const x1 = Math.max(0, Math.min(dragStart.x, x));
    const y1 = Math.max(0, Math.min(dragStart.y, y));
    const x2 = Math.min(c.width, Math.max(dragStart.x, x));
    const y2 = Math.min(c.height, Math.max(dragStart.y, y));
    setCropRect({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  }

  function handleMouseUp() {
    setCropping(false);
  }

  async function doCrop() {
    if (cropRect.w < 20 || cropRect.h < 20) {
      setMsg("选区太小，请重新框选");
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const c = document.createElement("canvas");
      const realX = Math.round(cropRect.x / scale);
      const realY = Math.round(cropRect.y / scale);
      const realW = Math.round(cropRect.w / scale);
      const realH = Math.round(cropRect.h / scale);
      c.width = realW;
      c.height = realH;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(imgRef.current!, realX, realY, realW, realH, 0, 0, realW, realH);
      const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/jpeg", 0.92));
      // generate filename: stem + _crop suffix
      const base = stem.replace(/\.[^.]+$/, "");
      const filename = `${base}_裁切.jpg`;
      await onSaveCropped(blob, filename);
      setMsg("✓ 裁切已保存为新素材");
      setMode("view");
      setCropRect({ x: 0, y: 0, w: 0, h: 0 });
    } catch (e) {
      setMsg(`裁切失败: ${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[90vh] w-full max-w-[960px] flex-col rounded-lg border border-subtle bg-card shadow-2xl">
        {/* header */}
        <div className="flex items-center gap-3 border-b border-subtle px-5 py-3">
          <h3 className="truncate text-[15px] font-semibold text-primary">{stem}</h3>
          <div className="ml-auto flex items-center gap-2">
            {mode === "view" ? (
              <ButtonSecondary className="h-7 text-xs px-3" onClick={() => setMode("crop")}>
                裁切
              </ButtonSecondary>
            ) : (
              <>
                <ButtonSecondary className="h-7 text-xs px-3" onClick={() => { setMode("view"); setCropRect({ x: 0, y: 0, w: 0, h: 0 }); }}>
                  取消裁切
                </ButtonSecondary>
                <Button className="h-7 text-xs px-3" onClick={doCrop} disabled={saving}>
                  {saving ? "保存中…" : "确认裁切"}
                </Button>
              </>
            )}
            <button
              className="ml-2 text-lg text-tertiary hover:text-primary transition"
              onClick={onClose}
              title="关闭"
            >
              ✕
            </button>
          </div>
        </div>

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

        {/* footer info bar */}
        <div className="flex flex-wrap items-center gap-3 border-t border-subtle px-5 py-2.5 text-xs text-tertiary">
          {width && height ? <span>{width} × {height}</span> : null}
          {format ? <span className="uppercase">{format}</span> : null}
          {sizeBytes ? <span>{fmtSize(sizeBytes)}</span> : null}
          {mode === "crop" && cropRect.w > 10 ? (
            <span className="text-accent ml-auto">
              选区 {Math.round(cropRect.w / scale)} × {Math.round(cropRect.h / scale)}
            </span>
          ) : null}
          {msg ? (
            <span className={msg.startsWith("✓") ? "text-success" : "text-plat-toutiao"}>
              {msg}
            </span>
          ) : null}
          <div className="ml-auto flex gap-2">
            <ButtonSecondary className="h-7 text-xs px-2" onClick={() => { navigator.clipboard.writeText(stem); onCopyPath(stem); }}>
              复制路径
            </ButtonSecondary>
            {onDelete ? (
              <ButtonSecondary className="h-7 text-xs px-2 text-plat-toutiao" onClick={onDelete}>
                删除
              </ButtonSecondary>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
