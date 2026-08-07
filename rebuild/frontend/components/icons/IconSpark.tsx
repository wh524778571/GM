import { ICON_BASE, type IconProps } from "./types";

/** ic-spark · 今日推荐选题 */
export function IconSpark({ className, size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} aria-hidden="true">
      <path
        d="M10 2.5l1.7 4.1L16 8.2l-4.3 1.6L10 14l-1.7-4.2L4 8.2l4.3-1.6z"
        {...ICON_BASE}
      />
      <path d="M15 13.5l.7 1.7L17.4 16l-1.7.8L15 18.5l-.7-1.7L12.6 16l1.7-.8z" {...ICON_BASE} />
    </svg>
  );
}
