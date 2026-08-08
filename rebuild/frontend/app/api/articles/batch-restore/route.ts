import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

// 静态段优先于 /articles/[article_id]，确保批量恢复不被当成单篇 article_id
export async function POST(req: Request) {
  return proxyRequest(req, "/articles/batch-restore");
}
