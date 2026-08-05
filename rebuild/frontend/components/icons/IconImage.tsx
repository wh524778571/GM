import { ICON_BASE, type IconProps } from "./types";

/** ic-image · 配图管理 */
export function IconImage({ className, size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} aria-hidden="true">
      <rect x="2.5" y="3.5" width="15" height="13" rx="2" {...ICON_BASE} />
      <circle cx="7" cy="8" r="1.4" {...ICON_BASE} />
      <path d="M3.2 14.2l4-3.6 3.3 3 2.4-2 3.9 3.4" {...ICON_BASE} />
    </svg>
  );
}
