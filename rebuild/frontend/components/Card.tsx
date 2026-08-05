import type { Kpi } from "@/lib/types";

/**
 * comp-card（画布 2:273）：232×116 / 圆角 14。
 * label 13/Regular/text-secondary · value 30/SemiBold/text-primary · delta 12/语义色。
 */
export type CardProps = Kpi;

const TONE_CLASS: Record<NonNullable<Kpi["tone"]>, string> = {
  success: "text-success",
  warning: "text-warning",
  neutral: "text-secondary",
};

export function Card({ label, value, delta, tone = "neutral" }: CardProps) {
  return (
    <div className="flex h-[116px] w-[232px] flex-col justify-between rounded-card border border-subtle bg-card px-4 py-4">
      <span className="text-[13px] font-normal text-secondary">{label}</span>
      <span className="text-[30px] font-semibold leading-none text-primary">{value}</span>
      {delta ? <span className={`text-xs ${TONE_CLASS[tone]}`}>{delta}</span> : <span />}
    </div>
  );
}
