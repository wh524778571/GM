import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  return proxyRequest(req, `/materials/${params.id}/replace`);
}
