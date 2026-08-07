import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: { article_id: string } },
) {
  return proxyRequest(req, `/articles/${params.article_id}/generate`);
}
