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

  const init: RequestInit = {
    method: req.method,
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
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
