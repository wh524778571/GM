import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** 组装四平台发布包（纯读，不改任何发布状态）。 */
export async function GET(req: Request, { params }: { params: { article_id: string } }) {
  return proxyRequest(
    req,
    `/articles/${encodeURIComponent(params.article_id)}/publish/packets`,
  );
}
