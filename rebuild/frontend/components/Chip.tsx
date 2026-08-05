/** 筛选 / 排序 chips：圆角 20，active 用 accent-bg + accent。 */
export interface ChipProps {
  label: string;
  count?: number;
  active?: boolean;
}

export function Chip({ label, count, active = false }: ChipProps) {
  return (
    <span
      className={[
        "inline-flex h-8 items-center gap-1.5 rounded-pill border px-3.5 text-[13px] font-medium",
        active
          ? "border-accent/40 bg-accent-bg text-accent"
          : "border-subtle bg-card text-secondary",
      ].join(" ")}
    >
      {label}
      {count !== undefined ? (
        <span className={active ? "text-accent" : "text-tertiary"}>{count}</span>
      ) : null}
    </span>
  );
}
