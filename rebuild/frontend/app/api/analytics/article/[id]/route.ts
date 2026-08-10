import { proxyRequest } from "@/lib/proxy";

export const dynamic = "force-dynamic";

// GET → 单篇文章的发布/互动数据（阅读·点赞·评论·收益），按平台与按日拆分
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return proxyRequest(req, `/analytics/article/${params.id}`);
}
