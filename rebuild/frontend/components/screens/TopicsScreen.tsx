"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppShell, Section } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { DataSourceNote } from "@/components/DataSourceNote";
import { apiGet, apiPost, ApiError } from "@/lib/clientApi";

interface Topic {
  id: number;
  date: string;
  title: string;
  topic_type: string;
  summary: string;
  angle: string;
  article_type: string;
  blacklisted: boolean;
  recommend_count: number;
  fresh: boolean;
  viral_genes: string[];
  viral_why: string;
}

// 选题类型 → 配色（复用平台色，未命中则用 accent）
const TYPE_COLOR: Record<string, string> = {
  一线资讯: "text-plat-toutiao",
  最新剧情: "text-plat-toutiao",
  小众剧情: "text-plat-bilibili",
  趣事: "text-plat-xhs",
  人物生日: "text-plat-baijia",
  大事记: "text-accent",
  常青候选: "text-secondary",
};

// 爆款基因 → 配色（情绪红 / 信息差蓝 / 身份粉 / 行动绿）
const GENE_COLOR: Record<string, string> = {
  情绪钩子: "border-plat-toutiao/40 text-plat-toutiao bg-plat-toutiao/10",
  信息差: "border-plat-baijia/40 text-plat-baijia bg-plat-baijia/10",
  身份标签: "border-plat-xhs/40 text-plat-xhs bg-plat-xhs/10",
  行动触发: "border-plat-bilibili/40 text-plat-bilibili bg-plat-bilibili/10",
};
const GENE_FALLBACK = "border-subtle text-secondary bg-raised";

export function TopicsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [blacklisted, setBlacklisted] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [writingId, setWritingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const loadToday = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ items: Topic[]; needs_generation: boolean; blacklisted_count: number }>(
        "/topics",
      );
      setTopics(res?.items ?? []);
    } catch (e) {
      setError((e as ApiError).message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // 切回本页（pathname 变化回到 /topics）时重新拉取今日选题，
  // 避免 App Router 软导航复用组件实例、mount effect 不重跑导致选题「切走再切回就没了」
  useEffect(() => {
    void loadToday();
  }, [pathname, loadToday]);

  async function generate() {
    setGenerating(true);
    setError(null);
    setOk(null);
    try {
      const res = await apiPost<{ items: Topic[]; generated: number }>("/topics");
      // 去重后可能无新选题（generated=0 且 items 为空）：保留当前列表，不盲目清空
      if (res?.items && res.items.length > 0) {
        setTopics(res.items);
        setBlacklisted([]);
        setOk(`已生成 ${res.generated ?? 0} 个今日选题`);
      } else {
        setOk("今日选题已存在，无需重复生成");
      }
    } catch (e) {
      setError((e as ApiError).message || "生成失败");
    } finally {
      setGenerating(false);
    }
  }

  async function writeTopic(t: Topic) {
    setWritingId(t.id);
    setError(null);
    setOk(null);
    try {
      const res = await apiPost<{ article_id: string }>(`/topics/${t.id}/write`);
      const aid = res?.article_id;
      if (!aid) throw new ApiError("未返回文章 ID", 500);
      router.push(`/writer?articleId=${aid}`);
    } catch (e) {
      setError((e as ApiError).message || "写文章失败");
      setWritingId(null);
    }
  }

  async function blacklistTopic(t: Topic) {
    setError(null);
    try {
      await apiPost(`/topics/${t.id}/blacklist`, { blacklisted: true });
      setTopics((prev) => prev.filter((x) => x.id !== t.id));
      setBlacklisted((prev) => [{ ...t, blacklisted: true }, ...prev]);
      setOk(`已拉黑「${t.title}」，后续不再推荐`);
    } catch (e) {
      setError((e as ApiError).message || "拉黑失败");
    }
  }

  async function restoreTopic(t: Topic) {
    setError(null);
    try {
      await apiPost(`/topics/${t.id}/blacklist`, { blacklisted: false });
      setBlacklisted((prev) => prev.filter((x) => x.id !== t.id));
      setOk(`已恢复「${t.title}」`);
    } catch (e) {
      setError((e as ApiError).message || "恢复失败");
    }
  }

  return (
    <AppShell
      title="今日推荐选题"
      subtitle="AI 按你的标准每天挑 5 个 · 点一下就出文 · 不想要可拉黑"
      actionLabel="生成今日选题"
      onAction={generate}
    >
      {error ? (
        <div className="mb-4 rounded-row border border-plat-toutiao/40 bg-plat-toutiao/10 px-4 py-2.5 text-[13px] text-plat-toutiao">
          {error}
        </div>
      ) : null}
      {ok ? (
        <div className="mb-4 rounded-row border border-success/40 bg-success/10 px-4 py-2.5 text-[13px] text-success">
          {ok}
        </div>
      ) : null}

      <Section
        title="今日 5 选"
        hint="选题为 AI 建议，写作前请自行核实事实"
        action={
          <ButtonSecondary onClick={generate} disabled={generating}>
            {generating ? "生成中…" : "重新生成"}
          </ButtonSecondary>
        }
      >
        {loading ? (
          <div className="rounded-card border border-dashed border-subtle px-4 py-10 text-center text-sm text-tertiary">
            加载中…
          </div>
        ) : topics.length === 0 ? (
          <div className="rounded-card border border-dashed border-subtle px-4 py-10 text-center">
            <p className="text-sm text-tertiary">今天还没有选题</p>
            <Button className="mt-4" onClick={generate} disabled={generating}>
              {generating ? "生成中…" : "生成今日选题"}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {topics.map((t) => (
              <div
                key={t.id}
                className="flex flex-col rounded-card border border-subtle bg-card p-4"
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`shrink-0 rounded-row border border-subtle px-2 py-0.5 text-[11px] ${
                      TYPE_COLOR[t.topic_type] ?? "text-secondary"
                    }`}
                  >
                    {t.topic_type}
                  </span>
                  <button
                    type="button"
                    onClick={() => blacklistTopic(t)}
                    title="不再推荐"
                    className="ml-auto text-[13px] text-tertiary transition-colors hover:text-plat-toutiao"
                  >
                    ✕
                  </button>
                </div>
                <h3 className="mt-2 text-[15px] font-semibold leading-6 text-primary">{t.title}</h3>
                {t.summary ? (
                  <p className="mt-1 text-[13px] leading-5 text-secondary">{t.summary}</p>
                ) : null}
                {t.angle ? (
                  <p className="mt-1 text-xs leading-5 text-tertiary">为什么现在写：{t.angle}</p>
                ) : null}
                {t.viral_genes && t.viral_genes.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {t.viral_genes.map((g) => (
                      <span
                        key={g}
                        className={`rounded-row border px-2 py-0.5 text-[11px] ${
                          GENE_COLOR[g] ?? GENE_FALLBACK
                        }`}
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                ) : null}
                {t.viral_why ? (
                  <p className="mt-1.5 text-xs leading-5 text-accent">
                    <span className="text-tertiary">为什么能爆 · </span>
                    {t.viral_why}
                  </p>
                ) : null}
                <div className="mt-3 flex gap-2">
                  <Button onClick={() => writeTopic(t)} disabled={writingId === t.id}>
                    {writingId === t.id ? "生成中…" : "生成并编辑"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {blacklisted.length > 0 ? (
        <Section title={`已屏蔽（${blacklisted.length}）`} hint="拉黑后永久不推，可随时恢复">
          <div className="flex flex-col gap-2">
            {blacklisted.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 rounded-row border border-subtle bg-raised px-3 py-2"
              >
                <span className="text-xs text-tertiary line-through">{t.title}</span>
                <button
                  type="button"
                  onClick={() => restoreTopic(t)}
                  className="ml-auto text-[12px] text-accent hover:underline"
                >
                  恢复
                </button>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <DataSourceNote sources={["backend"]} />
    </AppShell>
  );
}
