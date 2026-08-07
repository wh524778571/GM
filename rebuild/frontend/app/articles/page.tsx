import { ArticlesScreen } from "@/components/screens/ArticlesScreen";
import { getArticles, getArticleStatusCounts } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ArticlesPage() {
  const [articles, counts] = await Promise.all([getArticles(), getArticleStatusCounts()]);
  return <ArticlesScreen initialRows={articles.data} initialCounts={counts} />;
}
