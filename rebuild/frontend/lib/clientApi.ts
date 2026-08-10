// 浏览器侧 API 封装：所有请求走同源 /api/*（服务端代理转发到 FastAPI）。
// 与 lib/backend.ts（server-only，仅供 SSR 取数）区分：本文件专供 "use client" 组件使用。

export class ApiError extends Error {
  code: string | null;
  status: number;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let detail: unknown = null;
  try {
    detail = await res.json();
  } catch {
    /* ignore */
  }
  const d = (detail as { detail?: unknown })?.detail;
  const message =
    (typeof d === "object" && d !== null
      ? (d as { message?: string; msg?: string }).message ??
        (d as { msg?: string }).msg
      : null) ??
    (typeof d === "string" ? d : null) ??
    res.statusText;
  const code =
    typeof d === "object" && d !== null ? (d as { code?: string }).code ?? null : null;
  return new ApiError(String(message), res.status, code);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    cache: "no-store",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? (JSON.parse(text) as T) : undefined) as T;
}

export const apiGet = <T,>(path: string) => request<T>("GET", path);
export const apiPost = <T,>(path: string, body?: unknown) => request<T>("POST", path, body);
export const apiPatch = <T,>(path: string, body?: unknown) => request<T>("PATCH", path, body);
export const apiPut = <T,>(path: string, body?: unknown) => request<T>("PUT", path, body);
export const apiDelete = <T,>(path: string) => request<T>("DELETE", path);
