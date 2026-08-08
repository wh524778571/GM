import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

// 静态段优先于 /topics/[id]，确保导入不被当成单篇 topic_id
export async function POST(req: Request) {
  return proxyRequest(req, "/topics/import");
}
