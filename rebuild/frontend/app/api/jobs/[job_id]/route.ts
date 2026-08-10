import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

// GET /api/jobs/{job_id}  →  后台任务真实进度（四平台生成要 3–5 分钟，靠它驱动进度条）
export async function GET(req: Request, { params }: { params: { job_id: string } }) {
  return proxyRequest(req, `/jobs/${params.job_id}`);
}
