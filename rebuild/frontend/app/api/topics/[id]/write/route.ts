import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

// POST /api/topics/{id}/write  →  用该选题写四平台草稿，返回 {article_id,...}
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return proxyRequest(req, `/topics/${params.id}/write`);
}
