import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return proxyRequest(req, "/weekly-plan");
}

export async function POST(req: Request) {
  return proxyRequest(req, "/weekly-plan");
}
