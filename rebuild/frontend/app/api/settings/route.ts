import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

// GET  → 读取用户设置（账号名 / 平台开关 / 变现状态 / 偏好 / 密钥配置状态）
// PUT  → 更新账号名 / 平台开关 / 变现状态 / 偏好
export async function GET(req: Request) {
  return proxyRequest(req, "/settings");
}

export async function PUT(req: Request) {
  return proxyRequest(req, "/settings");
}
