import { AppShell, Section } from "@/components/AppShell";
import { Chip } from "@/components/Chip";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { IconFolder } from "@/components/icons";
import { SEED_FILES, SEED_FILE_SORTS } from "@/lib/seed";

export const dynamic = "force-dynamic";

export default function FilesPage() {
  return (
    <AppShell title="项目文件" subtitle="设计稿 / 文档 / 规则源" actionLabel="上传文件">
      <Section
        title="全部文件"
        hint={`共 ${SEED_FILES.length} 项`}
        action={<ButtonSecondary>在 Finder 中打开</ButtonSecondary>}
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {SEED_FILE_SORTS.map((s, i) => (
            <Chip key={s.key} label={s.label} active={i === 0} />
          ))}
        </div>

        <div className="flex h-9 w-full items-center gap-4 px-4 text-xs text-tertiary">
          <span className="min-w-0 flex-1">名称</span>
          <span className="w-[96px] shrink-0">类型</span>
          <span className="w-[88px] shrink-0 text-right">大小</span>
          <span className="w-[140px] shrink-0 text-right">更新时间</span>
        </div>

        <div className="flex flex-col gap-2">
          {SEED_FILES.map((file) => (
            <div
              key={file.name}
              className="flex h-[52px] w-full items-center gap-4 rounded-row border border-subtle bg-card px-4 transition-colors hover:bg-raised"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <span className="text-tertiary">
                  <IconFolder size={18} />
                </span>
                <span className="truncate text-sm text-primary">{file.name}</span>
              </div>
              <span className="w-[96px] shrink-0 text-[13px] text-secondary">{file.kind}</span>
              <span className="w-[88px] shrink-0 text-right text-[13px] tabular-nums text-secondary">
                {file.size}
              </span>
              <span className="w-[140px] shrink-0 text-right text-[13px] tabular-nums text-tertiary">
                {file.updatedAt}
              </span>
            </div>
          ))}
        </div>
      </Section>
    </AppShell>
  );
}
