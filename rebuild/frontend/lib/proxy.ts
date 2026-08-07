import "server-only";

import { NextResponse } from "next/server";
import { BACKEND_BASE_URL } from "./backend";

/**
 * 服务端反向代理：浏览器 → /api/* → FastAPI。
 * 好处：1) 免 CORS，后端 main.py 无需改动；2) 后端地址与任何密钥只存在于服务端。
 */
export async function proxyRequest(req: Request, backendPath: string): Promise<NextResponse> {
  const incoming = new URL(req.url);
  const target = `${BACKEND_BASE_URL}${backendPath}${incoming.search}`;

  // 透传原始 Content-Type：multipart 上传必须保留 boundary，写死 application/json 会让后端 422
  const contentType = req.headers.get("content-type");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (contentType) headers["Content-Type"] = contentType;

  const init: RequestInit = { method: req.method, cache: "no-store", headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    // 用 arrayBuffer 而非 text：二进制文件流经 text() 会被 UTF-8 解码破坏
    init.body = await req.arrayBuffer();
  }

  try {
    const res = await fetch(target, init);
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "backend_unreachable", detail: "后端未启动或不可达，界面已回落基线数据" },
      { status: 503 },
    );
  }
}
