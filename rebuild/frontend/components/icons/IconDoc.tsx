import { ICON_BASE, type IconProps } from "./types";

/** ic-doc · 文章管理 */
export function IconDoc({ className, size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} aria-hidden="true">
      <path d="M4.5 2.5h7l4 4v11a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1z" {...ICON_BASE} />
      <path d="M11.5 2.5v4h4" {...ICON_BASE} />
      <path d="M7 11h6M7 14h4" {...ICON_BASE} />
    </svg>
  );
}
