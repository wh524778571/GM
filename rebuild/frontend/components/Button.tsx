import type { ButtonHTMLAttributes, ReactNode } from "react";

/** comp-button（画布 6:69）：accent 填充 + 深色文字，圆角 8，14/Medium。 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export function Button({ children, className = "", type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex h-9 items-center justify-center rounded-btn bg-accent px-4 text-sm font-medium text-root transition-opacity hover:opacity-90 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
