"use client";

import { useSyncExternalStore } from "react";

// 当前正在编辑的文章 id（跨路由切换保留）。
//
// 之前 /writer 只在 URL 带 ?articleId= 时才加载；从侧栏「文章编辑」点回来是
// /writer（无参数）→ 组件卸载后本地状态全丢 → 文章"没了"。这里用 module 级
// store 记住"正在编辑哪篇"，/writer 无参数时回退到这里重新拉取，切走再切回不丢。
//
// 用 useSyncExternalStore 而非 useState：保证 SSR 水合一致（getServerSnapshot 返回
// 稳定的 EMPTY 常量），且订阅精准，避免无谓重渲染。

let currentId: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  Array.from(listeners).forEach((l) => l());
}

export function setCurrentArticleId(id: string | null): void {
  if (currentId === id) return;
  currentId = id;
  emit();
}

export function getCurrentArticleId(): string | null {
  return currentId;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): string | null {
  return currentId;
}

function getServerSnapshot(): string | null {
  return null;
}

export function useCurrentArticleId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
