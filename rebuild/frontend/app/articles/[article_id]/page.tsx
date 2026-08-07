import { ArticleDetailScreen } from "@/components/screens/ArticleDetailScreen";

export const dynamic = "force-dynamic";

export default function ArticleDetailPage({
  params,
}: {
  params: { article_id: string };
}) {
  return <ArticleDetailScreen articleId={params.article_id} />;
}
