import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

// POST /api/topics/{id}/blacklist  →  标记「不再推荐」（body: {blacklisted:true|false}）
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return proxyRequest(req, `/topics/${params.id}/blacklist`);
}
