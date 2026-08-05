import type { ButtonHTMLAttributes, ReactNode } from "react";

/** comp-button-secondary（画布 6:71）：透明底 + border-subtle 描边，文字 text-primary，圆角 8。 */
export interface ButtonSecondaryProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export function ButtonSecondary({
  children,
  className = "",
  type = "button",
  ...rest
}: ButtonSecondaryProps) {
  return (
    <button
      type={type}
      className={`inline-flex h-9 items-center justify-center rounded-btn border border-subtle bg-transparent px-4 text-sm font-medium text-primary transition-colors hover:bg-raised ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
