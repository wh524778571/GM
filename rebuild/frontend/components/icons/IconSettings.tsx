import { ICON_BASE, type IconProps } from "./types";

/** ic-settings · 设置 */
export function IconSettings({ className, size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="2.6" {...ICON_BASE} />
      <path
        d="M10 2.6v2.1M10 15.3v2.1M17.4 10h-2.1M4.7 10H2.6M15.4 4.6l-1.5 1.5M6.1 13.9l-1.5 1.5M15.4 15.4l-1.5-1.5M6.1 6.1 4.6 4.6"
        {...ICON_BASE}
      />
    </svg>
  );
}
