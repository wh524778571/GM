"use client";

import { useState } from "react";
import type { MaterialItem } from "@/lib/types";

/**
 * 素材卡：有后端图片服务时显示真实缩略图，加载失败/未配置素材根目录时回落占位块
 * （交接清单 §4）——不做「看起来有图」的假象。
 * 约束：文案全部走 React 插值（自动转义），无内联 onclick，无 XSS。
 * 展示名遵循「作品名_用途」命名规则。
 */
export function MaterialTile({
  item,
  onClick,
  selected = false,
  onDelete,
}: {
  item: MaterialItem;
  onClick?: () => void;
  selected?: boolean;
  onDelete?: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const src = item.url && !broken ? item.url : null;

  const frame = [
    "relative flex h-[130px] w-full items-center justify-center overflow-hidden rounded-row border bg-raised",
    selected ? "border-accent" : "border-subtle",
    onClick ? "cursor-pointer transition-colors hover:border-accent/50" : "",
  ].join(" ");

  return (
    <figure className="flex w-[232px] flex-col gap-2">
      <div className={frame} onClick={onClick} role={onClick ? "button" : undefined}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={item.stem}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="flex flex-col items-center gap-1 px-3">
            <span className="text-[13px] text-secondary">占位图</span>
            <span className="text-xs text-tertiary">
              {item.url ? "缩略图不可用" : "未配置素材目录"}
            </span>
          </div>
        )}
        {onDelete ? (
          <button
            type="button"
            aria-label="删除素材"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-[13px] leading-none text-white/90 transition-colors hover:bg-plat-toutiao"
          >
            ✕
          </button>
        ) : null}
      </div>
      <figcaption className="min-w-0">
        <div className="truncate text-[13px] text-primary">{item.stem}.jpeg</div>
        <div className="truncate text-xs text-tertiary">
          {item.work}
          {item.episode ? ` · ${item.episode}` : ""}
          {item.scene ? ` · ${item.scene}` : ""}
        </div>
      </figcaption>
    </figure>
  );
}
