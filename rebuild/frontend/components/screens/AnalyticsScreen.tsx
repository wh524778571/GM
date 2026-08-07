"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell, Section } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { Chip } from "@/components/Chip";
import { KpiGrid } from "@/components/KpiGrid";
import { TrendChart } from "@/components/TrendChart";
import { PlatformBars } from "@/components/PlatformBars";
import { DataSourceNote } from "@/components/DataSourceNote";
import { PLATFORMS } from "@/lib/platforms";
import { apiGet, apiPost, ApiError } from "@/lib/clientApi";
import { formatCny, formatCompact } from "@/lib/format";
import type { ArticleRow, DataSource, Kpi, PlatformKey, PlatformShare, TrendPoint } from "@/lib/types";

const RANGES = [7, 14, 30] as const;
type Range = (typeof RANGES)[number];

const PLATFORM_ORDER: PlatformKey[] = ["xhs", "toutiao", "baijia", "bilibili"];

interface DailyRow {
  date: string;
  views: number;
  likes: number;
  comments: number;
  bookmarks: number;
  revenue_cents: number;
}

interface PlatformRow {
  platform: string;
  platform_name: string;
  views: number;
  likes: number;
  comments: number;
  bookmarks: number;
  revenue_cents: number;
  estimated_revenue_cents: number;
}

interface TopArticleRow {
  article_id: string;
  title?: string | null;
  views: number;
  likes?: number;
  comments?: number;
  bookmarks?: number;
  revenue_cents?: number;
}

interface SummaryResponse {
  totals: Record<string, number>;
  platforms: Record<string, PlatformRow>;
  top_articles: TopArticleRow[];
  daily: DailyRow[];
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const EMPTY_FORM = {
  article_id: "",
  platform: "xhs" as PlatformKey,
  date: today(),
  impress: "",
  views: "",
  likes: "",
  comments: "",
  bookmarks: "",
  revenue_yuan: "",
};

function toInt(v: string): number {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function AnalyticsScreen({
  initialKpis,
  initialArticles,
  kpiSource,
}: {
  initialKpis: Kpi[];
  initialArticles: ArticleRow[];
  kpiSource: DataSource;
}) {
  const [range, setRange] = useState<Range>(14);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM, article_id: initialArticles[0]?.articleId ?? "" });

  const load = useCallback(async (days: Range) => {
    setLoading(true);
    try {
      const res = await apiGet<SummaryResponse>(`/analytics/summary?days=${days}&top_articles=8`);
      setSummary(res);
      setError(null);
    } catch (e) {
      setSummary(null);
      setError((e as ApiError).message || "看板数据读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [load, range]);

  // ── 趋势点：后端 daily 为倒序，这里升序并只取窗口内 ─────────────
  const daily = [...(summary?.daily ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const trend: TrendPoint[] = daily.map((d) => ({ date: d.date, views: d.views }));

  const platformShares: PlatformShare[] = PLATFORM_ORDER.map((key) => {
    const row = summary?.platforms?.[key];
    return {
      platform: key,
      name: row?.platform_name ?? PLATFORMS[key].name,
      views: row?.views ?? 0,
    };
  });

  const rangeViews = daily.reduce((s, d) => s + d.views, 0);
  const rangeRevenue = daily.reduce((s, d) => s + d.revenue_cents, 0);
  const hasTrend = trend.length >= 2;
  const hasShare = platformShares.some((p) => p.views > 0);

  async function submitTracking() {
    if (!form.article_id.trim()) {
      setError("请选择或填写 article_id");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const yuan = Number.parseFloat(form.revenue_yuan);
      await apiPost("/tracking", {
        article_id: form.article_id.trim(),
        platform: form.platform,
        date: form.date,
        impress: toInt(form.impress),
        views: toInt(form.views),
        likes: toInt(form.likes),
        comments: toInt(form.comments),
        bookmarks: toInt(form.bookmarks),
        revenue_cents: Number.isFinite(yuan) && yuan > 0 ? Math.round(yuan * 100) : 0,
      });
      setOk(`已录入 ${form.date} · ${PLATFORMS[form.platform].name}`);
      setShowForm(false);
      setForm((f) => ({
        ...EMPTY_FORM,
        article_id: f.article_id,
        platform: f.platform,
        date: f.date,
      }));
      await load(range);
    } catch (e) {
      const err = e as ApiError;
      setError(
        err.status === 404
          ? "该 article_id 不存在，请先在「文章管理」创建"
          : err.message || "录入失败",
      );
    } finally {
      setBusy(false);
    }
  }

  const field =
    "h-9 w-full rounded-btn border border-subtle bg-raised px-3 text-[13px] text-primary focus:border-accent focus:outline-none";

  return (
    <AppShell
      title="数据看板"
      subtitle="阅读 / 互动 / 收益 · 追踪数据汇总"
      actionLabel="录入追踪"
      onAction={() => {
        setShowForm((v) => !v);
        setOk(null);
      }}
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

      {showForm ? (
        <div className="mb-4 rounded-card border border-subtle bg-card p-4">
          <h2 className="text-[15px] font-semibold text-primary">录入追踪数据</h2>
          <p className="mt-1 text-xs text-tertiary">
            发布后 24 小时手动回填。收益填「元」，系统按分存储；预估与实收分列不合并。
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-secondary">平台</span>
            {PLATFORM_ORDER.map((k) => (
              <Chip
                key={k}
                label={PLATFORMS[k].name}
                active={form.platform === k}
                onClick={() => setForm((f) => ({ ...f, platform: k }))}
              />
            ))}
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-tertiary">文章</span>
              {initialArticles.length > 0 ? (
                <select
                  value={form.article_id}
                  onChange={(e) => setForm((f) => ({ ...f, article_id: e.target.value }))}
                  className={field}
                >
                  {initialArticles.map((a) => (
                    <option key={a.articleId} value={a.articleId}>
                      {a.title}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={form.article_id}
                  onChange={(e) => setForm((f) => ({ ...f, article_id: e.target.value }))}
                  placeholder="article_id"
                  className={field}
                />
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-tertiary">日期</span>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-tertiary">展现量</span>
              <input
                inputMode="numeric"
                value={form.impress}
                onChange={(e) => setForm((f) => ({ ...f, impress: e.target.value }))}
                placeholder="0"
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-tertiary">阅读量</span>
              <input
                inputMode="numeric"
                value={form.views}
                onChange={(e) => setForm((f) => ({ ...f, views: e.target.value }))}
                placeholder="0"
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-tertiary">点赞</span>
              <input
                inputMode="numeric"
                value={form.likes}
                onChange={(e) => setForm((f) => ({ ...f, likes: e.target.value }))}
                placeholder="0"
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-tertiary">评论</span>
              <input
                inputMode="numeric"
                value={form.comments}
                onChange={(e) => setForm((f) => ({ ...f, comments: e.target.value }))}
                placeholder="0"
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-tertiary">收藏</span>
              <input
                inputMode="numeric"
                value={form.bookmarks}
                onChange={(e) => setForm((f) => ({ ...f, bookmarks: e.target.value }))}
                placeholder="0"
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-tertiary">实收收益（元）</span>
              <input
                inputMode="decimal"
                value={form.revenue_yuan}
                onChange={(e) => setForm((f) => ({ ...f, revenue_yuan: e.target.value }))}
                placeholder="0.00"
                className={field}
              />
            </label>
          </div>

          <div className="mt-4 flex gap-2">
            <Button onClick={submitTracking} disabled={busy}>
              {busy ? "录入中…" : "保存"}
            </Button>
            <ButtonSecondary onClick={() => setShowForm(false)} disabled={busy}>
              取消
            </ButtonSecondary>
          </div>
        </div>
      ) : null}

      <Section title="核心指标" hint="小红书粉丝为代理值（赞+藏）">
        <KpiGrid items={initialKpis} />
      </Section>

      <Section
        title="时间范围"
        hint={
          loading
            ? "读取中…"
            : `近 ${range} 日：阅读 ${formatCompact(rangeViews)} · 实收 ${formatCny(rangeRevenue)}`
        }
      >
        <div className="flex gap-2">
          {RANGES.map((r) => (
            <Chip key={r} label={`近 ${r} 日`} active={range === r} onClick={() => setRange(r)} />
          ))}
        </div>
      </Section>

      <div className="mt-6 flex gap-gap4">
        <div className="min-w-0 flex-1 rounded-card border border-subtle bg-card p-4">
          <h2 className="mb-1 text-[18px] font-semibold text-primary">阅读趋势</h2>
          <p className="mb-3 text-xs text-tertiary">近 {range} 日全平台阅读量（按追踪记录汇总）</p>
          {hasTrend ? (
            <TrendChart points={trend} />
          ) : (
            <div className="flex h-[200px] items-center justify-center rounded-row border border-dashed border-subtle text-[13px] text-tertiary">
              {loading ? "读取中…" : "追踪记录不足 2 天，点右上「录入追踪」开始记录"}
            </div>
          )}
        </div>

        <div className="w-[336px] shrink-0 rounded-card border border-subtle bg-card p-4">
          <h2 className="mb-1 text-[18px] font-semibold text-primary">平台分布</h2>
          <p className="mb-3 text-xs text-tertiary">按累计阅读量（全量，不受时间范围影响）</p>
          {hasShare ? (
            <PlatformBars items={platformShares} />
          ) : (
            <div className="flex h-[140px] items-center justify-center rounded-row border border-dashed border-subtle text-[13px] text-tertiary">
              {loading ? "读取中…" : "暂无平台数据"}
            </div>
          )}
        </div>
      </div>

      <Section title="Top 文章" hint="按累计阅读量排序">
        <div className="rounded-card border border-subtle bg-card">
          {(summary?.top_articles ?? []).length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-tertiary">
              {loading ? "读取中…" : "暂无追踪记录"}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {(summary?.top_articles ?? []).map((a, i) => (
                <li key={a.article_id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-5 shrink-0 text-xs tabular-nums text-tertiary">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-primary">
                    {a.title || a.article_id}
                  </span>
                  <span className="shrink-0 text-[13px] tabular-nums text-secondary">
                    {formatCompact(a.views)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      <Section title="收益说明">
        <div className="rounded-card border border-subtle bg-card p-4 text-[13px] leading-6 text-secondary">
          预估收益按 <span className="text-primary">platforms.yaml</span> 的 revenue_rpm_cents 换算；
          头条原创权益待开通，开通后预估区间 ×3–5。实收与预估分列，不做合并显示，避免把预估当已到账。
        </div>
      </Section>

      <DataSourceNote sources={[kpiSource, summary ? "backend" : "seed"]} />
    </AppShell>
  );
}
