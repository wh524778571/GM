import "server-only";

import { NextResponse } from "next/server";
import { BACKEND_BASE_URL } from "@/lib/backend";

export const dynamic = "force-dynamic";

/**
 * 素材缩略图代理：浏览器 → /api/images/<相对路径> → FastAPI /images/<相对路径>。
 * 必须走二进制透传（arrayBuffer），不能复用 lib/proxy 的 text() 通道——那会毁掉图片字节。
 * 后端未挂载 /images（MATERIALS_ROOT 未配置）时按 404 原样返回，前端据此显示占位块。
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const incoming = new URL(req.url);
  const rel = path.map(encodeURIComponent).join("/");
  const target = `${BACKEND_BASE_URL}/images/${rel}${incoming.search}`;

  try {
    const res = await fetch(target, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ ok: false, status: res.status }, { status: res.status });
    }
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "backend_unreachable" }, { status: 503 });
  }
}
