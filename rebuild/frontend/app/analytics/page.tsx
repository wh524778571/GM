import { AppShell, Section } from "@/components/AppShell";
import { KpiGrid } from "@/components/KpiGrid";
import { TrendChart } from "@/components/TrendChart";
import { PlatformBars } from "@/components/PlatformBars";
import { DataSourceNote } from "@/components/DataSourceNote";
import { SEED_PLATFORM_SHARE, SEED_TREND } from "@/lib/seed";
import { getAnalyticsKpis } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const kpis = await getAnalyticsKpis();

  return (
    <AppShell title="数据看板" subtitle="阅读 / 互动 / 收益 · 追踪数据汇总" actionLabel="录入追踪">
      <Section title="核心指标" hint="小红书粉丝为代理值（赞+藏）">
        <KpiGrid items={kpis.data} />
      </Section>

      <div className="mt-6 flex gap-gap4">
        <div className="min-w-0 flex-1 rounded-card border border-subtle bg-card p-4">
          <h2 className="mb-1 text-[18px] font-semibold text-primary">阅读趋势</h2>
          <p className="mb-3 text-xs text-tertiary">近 14 日全平台阅读量</p>
          <TrendChart points={SEED_TREND} />
        </div>

        <div className="w-[336px] shrink-0 rounded-card border border-subtle bg-card p-4">
          <h2 className="mb-1 text-[18px] font-semibold text-primary">平台分布</h2>
          <p className="mb-3 text-xs text-tertiary">小红书为主战场</p>
          <PlatformBars items={SEED_PLATFORM_SHARE} />
        </div>
      </div>

      <Section title="收益说明">
        <div className="rounded-card border border-subtle bg-card p-4 text-[13px] leading-6 text-secondary">
          预估收益按 <span className="text-primary">platforms.yaml</span> 的 revenue_rpm_cents 换算；
          头条原创权益待开通，开通后预估区间 ×3–5。实收与预估分列，不做合并显示，避免把预估当已到账。
        </div>
      </Section>

      <DataSourceNote sources={[kpis.source]} />
    </AppShell>
  );
}
