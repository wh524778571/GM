import type { MaterialItem } from "@/lib/types";

/**
 * 素材卡：真实配图未由后端静态服务时，用占位块兜底（交接清单 §4）。
 * 约束：占位块不含任何内联 onclick；文案全部走 React 插值（自动转义），无 XSS。
 * 展示名遵循「作品名_用途」命名规则。
 */
export function MaterialTile({ item }: { item: MaterialItem }) {
  return (
    <figure className="flex w-[232px] flex-col gap-2">
      <div className="flex h-[130px] w-full flex-col items-center justify-center gap-1 rounded-row border border-subtle bg-raised px-3">
        <span className="text-[13px] text-secondary">占位图</span>
        <span className="text-xs text-tertiary">请从素材库选择</span>
      </div>
      <figcaption className="min-w-0">
        <div className="truncate text-[13px] text-primary">{item.stem}.jpeg</div>
        <div className="truncate text-xs text-tertiary">
          {item.work}
          {item.episode ? ` · ${item.episode}` : ""}
        </div>
      </figcaption>
    </figure>
  );
}
