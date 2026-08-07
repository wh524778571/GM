import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

// GET  → 今日选题列表（去重+黑名单过滤）
// POST → 触发生成今日 5 个选题
export async function GET(req: Request) {
  return proxyRequest(req, "/topics/today");
}

export async function POST(req: Request) {
  return proxyRequest(req, "/topics/generate");
}
