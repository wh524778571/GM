import { Card } from "./Card";
import type { Kpi } from "@/lib/types";

/** 4-up KPI 网格：每卡 232px，间距 gap4(16px)，恰好铺满 976px 主列。 */
export function KpiGrid({ items }: { items: Kpi[] }) {
  return (
    <div className="flex gap-gap4">
      {items.map((kpi) => (
        <Card key={kpi.label} {...kpi} />
      ))}
    </div>
  );
}
