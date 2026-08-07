import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: { article_id: string } },
) {
  return proxyRequest(req, `/articles/${params.article_id}`);
}

export async function PATCH(
  req: Request,
  { params }: { params: { article_id: string } },
) {
  return proxyRequest(req, `/articles/${params.article_id}`);
}
