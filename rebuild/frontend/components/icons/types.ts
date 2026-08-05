/** 图标统一约定：20×20，stroke=currentColor，随父级文字色变（非 active 为 secondary，active 为 accent）。 */
export interface IconProps {
  className?: string;
  size?: number;
}

export const ICON_BASE = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
