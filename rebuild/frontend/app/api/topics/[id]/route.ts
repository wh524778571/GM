import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

// PATCH / DELETE 单条选题（编辑 / 删除），透传到后端 /topics/{id}
// 注意：该动态段名必须与同级的 blacklist/write 子路由一致，均为 [id]。
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  return proxyRequest(req, `/topics/${params.id}`);
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  return proxyRequest(req, `/topics/${params.id}`);
}
