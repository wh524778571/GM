import { ICON_BASE, type IconProps } from "./types";

/** ic-dashboard · 工作台 */
export function IconDashboard({ className, size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} aria-hidden="true">
      <rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1.5" {...ICON_BASE} />
      <rect x="11" y="2.5" width="6.5" height="4" rx="1.5" {...ICON_BASE} />
      <rect x="11" y="8.5" width="6.5" height="9" rx="1.5" {...ICON_BASE} />
      <rect x="2.5" y="11" width="6.5" height="6.5" rx="1.5" {...ICON_BASE} />
    </svg>
  );
}
