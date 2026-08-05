import type { PlatformKey } from "./types";

/** 平台展示名 + Token 类名映射（颜色只能来自 tailwind token，禁止裸 hex）。 */
export const PLATFORMS: Record<
  PlatformKey,
  { name: string; text: string; bg: string; border: string }
> = {
  toutiao: {
    name: "今日头条",
    text: "text-plat-toutiao",
    bg: "bg-plat-toutiao",
    border: "border-plat-toutiao",
  },
  baijia: {
    name: "百家号",
    text: "text-plat-baijia",
    bg: "bg-plat-baijia",
    border: "border-plat-baijia",
  },
  bilibili: {
    name: "B站",
    text: "text-plat-bilibili",
    bg: "bg-plat-bilibili",
    border: "border-plat-bilibili",
  },
  xhs: {
    name: "小红书",
    text: "text-plat-xhs",
    bg: "bg-plat-xhs",
    border: "border-plat-xhs",
  },
};

const ALIASES: Record<string, PlatformKey> = {
  toutiao: "toutiao",
  今日头条: "toutiao",
  头条: "toutiao",
  baijia: "baijia",
  baijiahao: "baijia",
  百家号: "baijia",
  百家: "baijia",
  bilibili: "bilibili",
  bili: "bilibili",
  b站: "bilibili",
  B站: "bilibili",
  xhs: "xhs",
  xiaohongshu: "xhs",
  小红书: "xhs",
};

export function normalizePlatform(raw: unknown, fallback: PlatformKey = "xhs"): PlatformKey {
  if (typeof raw !== "string") return fallback;
  const key = ALIASES[raw] ?? ALIASES[raw.toLowerCase()];
  return key ?? fallback;
}

export function platformName(key: PlatformKey): string {
  return PLATFORMS[key].name;
}
