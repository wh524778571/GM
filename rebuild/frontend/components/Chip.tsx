import Link from "next/link";

/** 筛选 / 排序 chips：圆角 20，active 用 accent-bg + accent。可点击或跳转。 */
export interface ChipProps {
  label: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
}

export function Chip({ label, count, active = false, onClick, href, disabled = false }: ChipProps) {
  const cls = [
    "inline-flex h-8 items-center gap-1.5 rounded-pill border px-3.5 text-[13px] font-medium transition-colors",
    active
      ? "border-accent/40 bg-accent-bg text-accent"
      : "border-subtle bg-card text-secondary hover:border-accent/30 hover:text-primary",
    disabled ? "opacity-50" : "",
    onClick || href ? "cursor-pointer" : "cursor-default",
  ].join(" ");

  const inner = (
    <>
      {label}
      {count !== undefined ? (
        <span className={active ? "text-accent" : "text-tertiary"}>{count}</span>
      ) : null}
    </>
  );

  if (href && !disabled) {
    return (
      <Link href={href} className={cls} aria-pressed={active}>
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
    >
      {inner}
    </button>
  );
}
