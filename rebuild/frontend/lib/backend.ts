import "server-only";

/**
 * 服务端唯一出口：所有后端调用都从这里走。
 * 浏览器永远只访问同源 /api/*，不直连 FastAPI —— 免 CORS，且任何密钥（如 ZHIPU_API_KEY）都留在后端。
 */
export const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL ?? "http://localhost:8000";

const DEFAULT_TIMEOUT_MS = 2500;

/** 调后端；失败（未启动 / 超时 / 非 2xx）不抛错，返回 null 让上层回落 seed。 */
export async function backendGet<T>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BACKEND_BASE_URL}${path}`, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
