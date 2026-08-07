import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ article_id: string }> },
) {
  const { article_id } = await params;
  return proxyRequest(req, `/articles/${encodeURIComponent(article_id)}/polish`);
}
