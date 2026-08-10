import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

// POST /api/topics/{id}/write-async  →  立即返回 {job_id}，进度轮询 /api/jobs/{job_id}
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return proxyRequest(req, `/topics/${params.id}/write-async`);
}
