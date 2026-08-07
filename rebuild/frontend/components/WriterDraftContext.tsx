"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { SEED_WRITER_TOPIC } from "@/lib/seed";
import type { GenResult, PlatformKey } from "@/lib/types";

export const DEFAULT_REQUIREMENT =
  "保留账号调性：口语化、有观点、少形容词堆砌；结尾抛互动问题。";

interface WriterDraftValue {
  topic: string;
  articleType: "depth" | "info";
  platforms: PlatformKey[];
  requirement: string;
  articleId: string | null;
  activePlatform: PlatformKey;
  result: GenResult | null;
  hydrated: boolean;
  setTopic: (v: string) => void;
  setArticleType: (v: "depth" | "info") => void;
  setPlatforms: (v: PlatformKey[]) => void;
  setRequirement: (v: string) => void;
  setArticleId: (v: string | null) => void;
  setActivePlatform: (v: PlatformKey) => void;
  setResult: (v: GenResult | null) => void;
  reset: () => void;
}

const STORAGE_KEY = "writer:draft:v1";

const DEFAULTS = {
  topic: SEED_WRITER_TOPIC,
  articleType: "depth" as const,
  platforms: ["xhs"] as PlatformKey[],
  requirement: DEFAULT_REQUIREMENT,
  articleId: null as string | null,
  activePlatform: "xhs" as PlatformKey,
  result: null as GenResult | null,
};

const WriterDraftContext = createContext<WriterDraftValue | null>(null);

export function WriterDraftProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [topic, setTopic] = useState(DEFAULTS.topic);
  const [articleType, setArticleType] = useState<"depth" | "info">(DEFAULTS.articleType);
  const [platforms, setPlatforms] = useState<PlatformKey[]>(DEFAULTS.platforms);
  const [requirement, setRequirement] = useState(DEFAULTS.requirement);
  const [articleId, setArticleId] = useState<string | null>(DEFAULTS.articleId);
  const [activePlatform, setActivePlatform] = useState<PlatformKey>(DEFAULTS.activePlatform);
  const [result, setResult] = useState<GenResult | null>(DEFAULTS.result);

  // 挂载后从 localStorage 恢复（仅客户端，避免 SSR/CSR 不一致）
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const d = JSON.parse(raw) as Partial<typeof DEFAULTS>;
        if (typeof d.topic === "string") setTopic(d.topic);
        if (d.articleType === "depth" || d.articleType === "info") setArticleType(d.articleType);
        if (Array.isArray(d.platforms)) setPlatforms(d.platforms as PlatformKey[]);
        if (typeof d.requirement === "string") setRequirement(d.requirement);
        if (typeof d.articleId === "string" || d.articleId === null) setArticleId(d.articleId);
        if (typeof d.activePlatform === "string") setActivePlatform(d.activePlatform as PlatformKey);
        if (d.result && typeof d.result === "object") setResult(d.result as GenResult);
      }
    } catch {
      /* 损坏的存储直接忽略，回落默认 */
    }
    setHydrated(true);
  }, []);

  // 恢复完成后再持久化，避免首次渲染就用默认值覆盖已存草稿
  useEffect(() => {
    if (!hydrated) return;
    const payload = { topic, articleType, platforms, requirement, articleId, activePlatform, result };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* 隐私模式 / 配额不足时静默跳过，不影响使用 */
    }
  }, [hydrated, topic, articleType, platforms, requirement, articleId, activePlatform, result]);

  const reset = () => {
    setTopic(DEFAULTS.topic);
    setArticleType(DEFAULTS.articleType);
    setPlatforms(DEFAULTS.platforms);
    setRequirement(DEFAULTS.requirement);
    setArticleId(null);
    setActivePlatform(DEFAULTS.activePlatform);
    setResult(null);
  };

  const value: WriterDraftValue = {
    topic,
    articleType,
    platforms,
    requirement,
    articleId,
    activePlatform,
    result,
    hydrated,
    setTopic,
    setArticleType,
    setPlatforms,
    setRequirement,
    setArticleId,
    setActivePlatform,
    setResult,
    reset,
  };

  return <WriterDraftContext.Provider value={value}>{children}</WriterDraftContext.Provider>;
}

export function useWriterDraft(): WriterDraftValue {
  const ctx = useContext(WriterDraftContext);
  if (!ctx) throw new Error("useWriterDraft 必须在 WriterDraftProvider 内使用");
  return ctx;
}
