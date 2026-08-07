import { AssetsScreen } from "@/components/screens/AssetsScreen";
import { getAssetKpis, getMaterials, getMaterialWorks } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function AssetsPage() {
  const [kpis, materials, works] = await Promise.all([
    getAssetKpis(),
    getMaterials(24),
    getMaterialWorks(),
  ]);

  return (
    <AssetsScreen
      initialKpis={kpis.data}
      initialMaterials={materials.data}
      initialWorks={works}
      kpiSource={kpis.source}
      materialSource={materials.source}
    />
  );
}
