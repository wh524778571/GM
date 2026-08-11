/** 编辑器本地草稿缓存：刷新 / 崩溃 / 切走兜底，保证编辑内容不丢。 */

import type { ImgMap } from "./articleMarkdown";

const lsKey = (id: string) => `guoman:draft:${id}`;

export interface LocalDraft {
  texts: Record<string, string>;
  imgMap: ImgMap;
  titles: Record<string, string>;
  ts: number;
}

export function persistLocal(
  id: string,
  texts: Record<string, string>,
  imgMap: ImgMap,
  titles: Record<string, string>,
): void {
  try {
    const payload: LocalDraft = { texts, imgMap, titles, ts: Date.now() };
    localStorage.setItem(lsKey(id), JSON.stringify(payload));
  } catch {
    /* 隐私模式 / 存储满时静默降级 */
  }
}

export function loadLocal(id: string): LocalDraft | null {
  try {
    const raw = localStorage.getItem(lsKey(id));
    if (!raw) return null;
    const d = JSON.parse(raw) as LocalDraft;
    if (Date.now() - (d.ts ?? 0) > 7 * 24 * 3600 * 1000) return null;
    return d;
  } catch {
    return null;
  }
}

export function removeLocal(id: string): void {
  try {
    localStorage.removeItem(lsKey(id));
  } catch {
    /* noop */
  }
}
