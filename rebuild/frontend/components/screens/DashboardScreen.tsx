"use client";

import { useState } from "react";
import Link from "next/link";
import { AppShell, Section } from "@/components/AppShell";
import { KpiGrid } from "@/components/KpiGrid";
import { TableHeader, TableRow } from "@/components/TableRow";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { StatusPill } from "@/components/StatusPill";
import { DataSourceNote } from "@/components/DataSourceNote";
import { PublishButton } from "@/components/PublishModal";
import { PLATFORMS } from "@/lib/platforms";
import type { ArticleRow, DataSource, Kpi } from "@/lib/types";

export function DashboardScreen({
  initialKpis,
  initialRows,
  kpiSource,
  rowSource,
}: {
  initialKpis: Kpi[];
  initialRows: ArticleRow[];
  kpiSource: DataSource;
  rowSource: DataSource;
}) {
  const [query, setQuery] = useState("");

  const recent = (() => {
    const base = initialRows.slice(0, 3);
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (r) => r.title.toLowerCase().includes(q) || r.work.toLowerCase().includes(q),
    );
  })();

  const queue = initialRows
    .filter((a) => a.status === "pending" || a.status === "draft")
    .slice(0, 2);

  return (
    <AppShell
      title="工作台"
      subtitle="本周内容进度总览 · 小红书主战场"
      onSearch={(q) => setQuery(q)}
    >
      <Section title="本周概览" hint="KPI 4-up">
        <KpiGrid items={initialKpis} />
      </Section>

      <Section
        title="近期文章"
        hint={query ? `关键词「${query}」` : `共 ${initialRows.length} 篇`}
        action={
          <Link href="/articles">
            <ButtonSecondary>查看全部</ButtonSecondary>
          </Link>
        }
      >
        <TableHeader />
        <div className="flex flex-col gap-2">
          {recent.map((row) => (
            <TableRow key={row.articleId} row={row} />
          ))}
          {recent.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-tertiary">没有匹配的文章</p>
          ) : null}
        </div>
      </Section>

      <Section title="待发布队列" hint="严禁静默成功 · 发布前需人工确认">
        {queue.length === 0 ? (
          <p className="py-6 text-[13px] text-tertiary">暂无待发布文章</p>
        ) : (
          <div className="flex flex-wrap gap-gap4">
            {queue.map((item) => {
              const platform = PLATFORMS[item.platform];
              return (
                <div
                  key={item.articleId}
                  className="flex min-w-0 flex-1 flex-col gap-2 rounded-card border border-subtle bg-card p-4"
                >
                  <div className="flex items-center gap-2">
                    <StatusPill status={item.status} />
                    <span className={`text-xs ${platform.text}`}>{platform.name}</span>
                    <span className="ml-auto text-xs text-tertiary">{item.date}</span>
                  </div>
                  <div className="truncate text-sm font-medium text-primary">{item.title}</div>
                  <div className="text-xs text-tertiary">{item.work} · 待人工确认后发布</div>
                  <div className="mt-1 flex gap-2">
                    <PublishButton
                      articleId={item.articleId}
                      articleTitle={item.title}
                      label="预览四平台"
                      className="h-8 px-3"
                    />
                    <PublishButton
                      articleId={item.articleId}
                      articleTitle={item.title}
                      label="标记已发布"
                      className="h-8 px-3"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <DataSourceNote sources={[kpiSource, rowSource]} />
    </AppShell>
  );
}
