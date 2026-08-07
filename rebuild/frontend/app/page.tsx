import { DashboardScreen } from "@/components/screens/DashboardScreen";
import { getArticles, getDashboardKpis } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [kpis, articles] = await Promise.all([getDashboardKpis(), getArticles()]);
  return (
    <DashboardScreen
      initialKpis={kpis.data}
      initialRows={articles.data}
      kpiSource={kpis.source}
      rowSource={articles.source}
    />
  );
}
