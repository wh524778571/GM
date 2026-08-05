import { AppShell, Section } from "@/components/AppShell";
import { KpiGrid } from "@/components/KpiGrid";
import { TableHeader, TableRow } from "@/components/TableRow";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { StatusPill } from "@/components/StatusPill";
import { PLATFORMS } from "@/lib/platforms";
import { getArticles, getDashboardKpis } from "@/lib/data";
import { DataSourceNote } from "@/components/DataSourceNote";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [kpis, articles] = await Promise.all([getDashboardKpis(), getArticles()]);
  const recent = articles.data.slice(0, 3);
  const queue = articles.data.filter((a) => a.status === "pending" || a.status === "draft").slice(0, 2);

  return (
    <AppShell title="工作台" subtitle="本周内容进度总览 · 小红书主战场">
      <Section title="本周概览" hint="KPI 4-up">
        <KpiGrid items={kpis.data} />
      </Section>

      <Section title="近期文章" action={<ButtonSecondary>查看全部</ButtonSecondary>}>
        <TableHeader />
        <div className="flex flex-col gap-2">
          {recent.map((row) => (
            <TableRow key={row.articleId} row={row} />
          ))}
        </div>
      </Section>

      <Section title="待发布队列" hint="严禁静默成功 · 发布前需人工确认">
        <div className="flex gap-gap4">
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
                  <ButtonSecondary className="h-8 px-3">预览四平台</ButtonSecondary>
                  <ButtonSecondary className="h-8 px-3">标记已发布</ButtonSecondary>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <DataSourceNote sources={[kpis.source, articles.source]} />
    </AppShell>
  );
}
