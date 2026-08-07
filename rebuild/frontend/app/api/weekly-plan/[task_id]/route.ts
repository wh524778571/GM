import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { task_id: string } },
) {
  return proxyRequest(req, `/weekly-plan/${params.task_id}`);
}

export async function DELETE(
  req: Request,
  { params }: { params: { task_id: string } },
) {
  return proxyRequest(req, `/weekly-plan/${params.task_id}`);
}
