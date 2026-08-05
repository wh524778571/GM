import { AppShell, Section } from "@/components/AppShell";
import { Chip } from "@/components/Chip";
import { TableHeader, TableRow } from "@/components/TableRow";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { DataSourceNote } from "@/components/DataSourceNote";
import { SEED_ARTICLE_FILTERS } from "@/lib/seed";
import { getArticles } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ArticlesPage() {
  const articles = await getArticles();

  return (
    <AppShell title="文章管理" subtitle="草稿 / 待发布 / 已发布 状态流">
      <Section
        title="全部文章"
        hint={`共 ${articles.data.length} 篇`}
        action={<ButtonSecondary>导出 CSV</ButtonSecondary>}
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {SEED_ARTICLE_FILTERS.map((f, i) => (
            <Chip key={f.key} label={f.label} count={f.count} active={i === 0} />
          ))}
        </div>

        <TableHeader />
        <div className="flex flex-col gap-2">
          {articles.data.map((row) => (
            <TableRow key={row.articleId} row={row} />
          ))}
        </div>

        <p className="mt-4 text-xs text-tertiary">
          点「发布」拿到四平台的可复制内容与人工步骤；系统不代发，状态在你亲手确认前一直是「待人工发布」。
        </p>
      </Section>

      <DataSourceNote sources={[articles.source]} />
    </AppShell>
  );
}
