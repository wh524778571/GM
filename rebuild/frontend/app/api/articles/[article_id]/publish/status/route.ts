import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** 四平台真实状态；未经人工确认永远是 pending。 */
export async function GET(req: Request, { params }: { params: { article_id: string } }) {
  return proxyRequest(req, `/articles/${encodeURIComponent(params.article_id)}/publish/status`);
}
