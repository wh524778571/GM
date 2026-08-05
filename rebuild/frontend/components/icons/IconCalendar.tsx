import { ICON_BASE, type IconProps } from "./types";

/** ic-calendar · 周计划 */
export function IconCalendar({ className, size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} aria-hidden="true">
      <rect x="2.5" y="4" width="15" height="13.5" rx="2" {...ICON_BASE} />
      <path d="M2.5 8h15" {...ICON_BASE} />
      <path d="M6.5 2.5v3M13.5 2.5v3" {...ICON_BASE} />
      <path d="M6.5 11.5h2M11.5 11.5h2M6.5 14.5h2" {...ICON_BASE} />
    </svg>
  );
}
