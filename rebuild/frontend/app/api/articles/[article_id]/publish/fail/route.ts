import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** 人工登记发布失败（原因必填，失败同样留痕）。 */
export async function POST(req: Request, { params }: { params: { article_id: string } }) {
  return proxyRequest(req, `/articles/${encodeURIComponent(params.article_id)}/publish/fail`);
}
