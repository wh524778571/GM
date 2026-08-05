import { ICON_BASE, type IconProps } from "./types";

/** ic-folder · 项目文件 */
export function IconFolder({ className, size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} aria-hidden="true">
      <path
        d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.3l1.7 2h7.5a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5z"
        {...ICON_BASE}
      />
    </svg>
  );
}
