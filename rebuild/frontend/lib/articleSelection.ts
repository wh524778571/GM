"use client";

import { useSyncExternalStore } from "react";

// 全局文章选中状态（跨路由切换保留）。
//
// 之前 selected 是 ArticlesScreen 的本地 useState：切到其它路由时该组件被卸载、
// 本地状态随之清空，切回来选中就消失了（与选题丢失是同一类问题）。
// 这里改为 module 级 store —— 组件卸载不影响它，所以切走再切回选中依然保留。
//
// 用 useSyncExternalStore 而非 useState，保证 SSR 水合一致（getServerSnapshot 返回
// 稳定的 EMPTY 常量）且订阅精准，避免无谓重渲染。

const EMPTY: Set<string> = new Set<string>();
let selected: Set<string> = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  Array.from(listeners).forEach((l) => l());
}

export function toggleArticleSelection(id: string): void {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected = next;
  emit();
}

export function setArticleSelection(ids: string[]): void {
  const next = new Set(ids);
  const same =
    next.size === selected.size && Array.from(next).every((v) => selected.has(v));
  if (same) return;
  selected = next;
  emit();
}

export function clearArticleSelection(): void {
  if (selected.size === 0) return;
  selected = EMPTY;
  emit();
}

export function removeArticleSelection(ids: string[]): void {
  if (ids.length === 0 || selected.size === 0) return;
  const next = new Set(selected);
  let changed = false;
  for (const id of ids) {
    if (next.delete(id)) changed = true;
  }
  if (changed) {
    selected = next;
    emit();
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Set<string> {
  return selected;
}

// 首屏（SSR / 水合）返回稳定常量 EMPTY，避免 hydration mismatch。
function getServerSnapshot(): Set<string> {
  return EMPTY;
}

export function useArticleSelection(): Set<string> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
