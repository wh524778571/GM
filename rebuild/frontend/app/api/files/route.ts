import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return proxyRequest(req, "/files");
}

export async function POST(req: Request) {
  return proxyRequest(req, "/files");
}

export async function DELETE(req: Request) {
  return proxyRequest(req, "/files");
}
