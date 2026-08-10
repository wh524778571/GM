import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

// 手动新建选题 → 后端 /topics/import
export async function POST(req: Request) {
  return proxyRequest(req, "/topics/import");
}
