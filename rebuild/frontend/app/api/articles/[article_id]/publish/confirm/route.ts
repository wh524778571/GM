import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/**
 * 人工确认某平台已发布。前端只负责转发，`confirmed` 由用户点击产生，
 * 这里不补默认值 —— 后端缺少 confirmed=true 会返回 422 confirmation_required。
 */
export async function POST(req: Request, { params }: { params: { article_id: string } }) {
  return proxyRequest(req, `/articles/${encodeURIComponent(params.article_id)}/publish/confirm`);
}
