import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * 统一按钮组件（设计系统：variant 驱动）。
 * - primary：accent 填充 + 浅色文字（主操作）
 * - secondary：透明底 + border-subtle 描边（次操作）
 * - ghost：无底无框，仅 accent 文字（轻量操作）
 * 圆角 8（rounded-btn）· 高 36（h-9）· 14/Medium，全部走 Tailwind Token，禁止写死 hex。
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
}

const VARIANT_CLASS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-accent text-root hover:opacity-90",
  secondary: "border border-subtle bg-transparent text-primary hover:bg-raised",
  ghost: "bg-transparent text-accent hover:bg-accent-bg",
};

export function Button({
  children,
  className = "",
  type = "button",
  variant = "primary",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex h-9 items-center justify-center rounded-btn px-4 text-sm font-medium transition-colors ${VARIANT_CLASS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
