import type { HTMLAttributes, ReactNode } from "react";

/**
 * 通用面板容器（设计系统 · 对应画布 Panel 标本）。
 * 统一样式：rounded-card · border-subtle · bg-card。
 * 4 屏里原先散落的 `rounded-card border border-subtle bg-card` 内联面板，
 * 后续统一改用 <Panel>，新增屏幕直接复用，杜绝重复类名。
 */
export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** 是否加默认内边距 p-5；传 false 可自控（如表格/列表类面板） */
  padded?: boolean;
}

export function Panel({ children, className = "", padded = true, ...rest }: PanelProps) {
  return (
    <div
      className={`rounded-card border border-subtle bg-card ${padded ? "p-5" : ""} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
