import { AnalyticsScreen } from "@/components/screens/AnalyticsScreen";
import { getAnalyticsKpis, getArticles } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const [kpis, articles] = await Promise.all([getAnalyticsKpis(), getArticles()]);

  return (
    <AnalyticsScreen
      initialKpis={kpis.data}
      kpiSource={kpis.source}
      initialArticles={articles.data}
    />
  );
}
