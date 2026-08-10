import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

// PUT → 写入单个 AI 密钥到 .env（后端白名单受限，绝不回显值）
export async function PUT(req: Request) {
  return proxyRequest(req, "/settings/api-keys");
}
