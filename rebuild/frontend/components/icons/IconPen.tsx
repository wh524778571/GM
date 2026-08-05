import { ICON_BASE, type IconProps } from "./types";

/** ic-pen · AI 写作 */
export function IconPen({ className, size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} aria-hidden="true">
      <path d="M13.4 2.9a1.9 1.9 0 0 1 2.7 2.7L7.4 14.3l-3.6 1 1-3.6z" {...ICON_BASE} />
      <path d="M12.1 4.2l3.7 3.7" {...ICON_BASE} />
      <path d="M3 17.5h14" {...ICON_BASE} />
    </svg>
  );
}
