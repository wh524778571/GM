import { describe, it, expect, vi, afterEach } from "vitest";
import { apiGet, ApiError } from "@/lib/clientApi";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockFetch(status: number, body: unknown) {
  const res = new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  vi.stubGlobal("fetch", vi.fn(async () => res));
}

describe("apiGet 错误处理 / ApiError 解析", () => {
  it("解析 {detail:{message, code}} 结构，并是 ApiError 实例", async () => {
    mockFetch(400, { detail: { message: "参数错误", code: "BAD_PARAM" } });
    let caught: unknown;
    try {
      await apiGet("/topics");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    const err = caught as ApiError;
    expect(err.status).toBe(400);
    expect(err.code).toBe("BAD_PARAM");
    expect(err.message).toBe("参数错误");
  });

  it("兼容 detail 为纯字符串", async () => {
    mockFetch(404, { detail: "资源不存在" });
    let caught: unknown;
    try {
      await apiGet("/x");
    } catch (e) {
      caught = e;
    }
    const err = caught as ApiError;
    expect(err.status).toBe(404);
    expect(err.message).toBe("资源不存在");
  });

  it("无 detail 时回退到 statusText", async () => {
    const res = new Response("", { status: 500, statusText: "Internal Server Error" });
    vi.stubGlobal("fetch", vi.fn(async () => res));
    let caught: unknown;
    try {
      await apiGet("/x");
    } catch (e) {
      caught = e;
    }
    const err = caught as ApiError;
    expect(err.status).toBe(500);
    expect(err.message).toBe("Internal Server Error");
  });

  it("200 正常返回解析后的 JSON", async () => {
    mockFetch(200, { items: [1, 2], needs_generation: false });
    const data = await apiGet<{ items: number[]; needs_generation: boolean }>("/topics");
    expect(data.items).toEqual([1, 2]);
    expect(data.needs_generation).toBe(false);
  });

  it("POST 类错误同样走 ApiError 解析", async () => {
    mockFetch(409, { detail: { message: "选题已存在", code: "CONFLICT" } });
    let caught: unknown;
    try {
      await apiGet("/topics");
    } catch (e) {
      caught = e;
    }
    const err = caught as ApiError;
    expect(err.status).toBe(409);
    expect(err.code).toBe("CONFLICT");
  });
});
