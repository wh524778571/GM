import { describe, it, expect } from "vitest";
import { normalizePlatform, platformName } from "@/lib/platforms";

describe("normalizePlatform", () => {
  it("精确 key 直接返回", () => {
    expect(normalizePlatform("toutiao")).toBe("toutiao");
    expect(normalizePlatform("xhs")).toBe("xhs");
    expect(normalizePlatform("bilibili")).toBe("bilibili");
    expect(normalizePlatform("baijia")).toBe("baijia");
  });

  it("中文别名归一", () => {
    expect(normalizePlatform("今日头条")).toBe("toutiao");
    expect(normalizePlatform("头条")).toBe("toutiao");
    expect(normalizePlatform("小红书")).toBe("xhs");
    expect(normalizePlatform("B站")).toBe("bilibili");
    expect(normalizePlatform("百家号")).toBe("baijia");
  });

  it("大小写不敏感", () => {
    expect(normalizePlatform("XHS")).toBe("xhs");
    expect(normalizePlatform("Bilibili")).toBe("bilibili");
    expect(normalizePlatform("TOUTIAO")).toBe("toutiao");
  });

  it("非字符串 → 默认兜底 xhs", () => {
    expect(normalizePlatform(undefined)).toBe("xhs");
    expect(normalizePlatform(123)).toBe("xhs");
    expect(normalizePlatform(null)).toBe("xhs");
    expect(normalizePlatform({})).toBe("xhs");
  });

  it("未知字符串 → 兜底（默认 xhs，可自定义）", () => {
    expect(normalizePlatform("抖音")).toBe("xhs");
    expect(normalizePlatform("random-text")).toBe("xhs");
    expect(normalizePlatform("抖音", "toutiao")).toBe("toutiao");
  });
});

describe("platformName", () => {
  it("返回平台展示名", () => {
    expect(platformName("toutiao")).toBe("今日头条");
    expect(platformName("xhs")).toBe("小红书");
    expect(platformName("bilibili")).toBe("B站");
    expect(platformName("baijia")).toBe("百家号");
  });
});
