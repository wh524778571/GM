import { ICON_BASE, type IconProps } from "./types";

/** ic-chart · 数据看板 */
export function IconChart({ className, size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} aria-hidden="true">
      <path d="M3 17h14" {...ICON_BASE} />
      <path d="M5.5 17V11M10 17V5M14.5 17V8.5" {...ICON_BASE} />
    </svg>
  );
}
