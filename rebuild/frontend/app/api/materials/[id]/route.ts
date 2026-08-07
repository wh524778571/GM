import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  return proxyRequest(req, `/materials/${params.id}`);
}
