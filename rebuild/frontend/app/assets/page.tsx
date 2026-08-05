import { AppShell, Section } from "@/components/AppShell";
import { KpiGrid } from "@/components/KpiGrid";
import { Chip } from "@/components/Chip";
import { MaterialTile } from "@/components/MaterialTile";
import { DataSourceNote } from "@/components/DataSourceNote";
import { SEED_ASSET_FILTERS } from "@/lib/seed";
import { getAssetKpis, getMaterials } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function AssetsPage() {
  const [kpis, materials] = await Promise.all([getAssetKpis(), getMaterials()]);

  return (
    <AppShell title="配图管理" subtitle="命名规则 作品名_用途 · 缩略图由 Pillow 生成" actionLabel="导入素材">
      <Section title="素材概览">
        <KpiGrid items={kpis.data} />
      </Section>

      <Section title="素材库" hint="展示前 12 张">
        <div className="mb-4 flex flex-wrap gap-2">
          {SEED_ASSET_FILTERS.map((f, i) => (
            <Chip key={f.key} label={f.label} count={f.count} active={i === 0} />
          ))}
        </div>

        <div className="flex flex-wrap gap-gap4">
          {materials.data.map((item) => (
            <MaterialTile key={item.id} item={item} />
          ))}
        </div>
      </Section>

      <DataSourceNote sources={[kpis.source, materials.source]} />
    </AppShell>
  );
}
