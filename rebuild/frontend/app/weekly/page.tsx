import { AppShell, Section } from "@/components/AppShell";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { DataSourceNote } from "@/components/DataSourceNote";
import { PLATFORMS } from "@/lib/platforms";
import { WEEKDAY_LABELS } from "@/lib/seed";
import { getWeeklyTasks } from "@/lib/data";
import type { WeeklyTask } from "@/lib/types";

export const dynamic = "force-dynamic";

const FRIDAY = 4;

const TASK_STATUS: Record<WeeklyTask["status"], { label: string; className: string }> = {
  planned: { label: "计划", className: "text-tertiary" },
  doing: { label: "进行中", className: "text-warning" },
  done: { label: "已完成", className: "text-success" },
  skipped: { label: "跳过", className: "text-tertiary" },
};

export default async function WeeklyPage() {
  const weekly = await getWeeklyTasks();
  const byDay = WEEKDAY_LABELS.map((_, i) => weekly.data.filter((t) => t.weekday === i));

  return (
    <AppShell title="周计划" subtitle="周看板 7 列 · 周五=沧元图专属日" actionLabel="新建任务">
      <Section
        title="本周排期"
        hint="周五为沧元图专属更新日"
        action={<ButtonSecondary>复制上周排期</ButtonSecondary>}
      >
        <div className="flex gap-3">
          {WEEKDAY_LABELS.map((day, i) => {
            const isFriday = i === FRIDAY;
            return (
              <div
                key={day}
                className={[
                  "flex min-w-0 flex-1 flex-col gap-2 rounded-card border p-3",
                  isFriday
                    ? "border-accent bg-[var(--weekly-friday-bg)]"
                    : "border-subtle bg-card",
                ].join(" ")}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[13px] font-medium ${isFriday ? "text-accent" : "text-secondary"}`}
                  >
                    {day}
                  </span>
                  <span className="text-xs text-tertiary">{byDay[i].length}</span>
                </div>

                {byDay[i].length === 0 ? (
                  <div className="rounded-row border border-dashed border-subtle px-2 py-4 text-center text-xs text-tertiary">
                    暂无任务
                  </div>
                ) : (
                  byDay[i].map((task) => {
                    const platform = task.platform ? PLATFORMS[task.platform] : null;
                    const status = TASK_STATUS[task.status];
                    return (
                      <div
                        key={task.id}
                        className="rounded-row border border-subtle bg-raised px-2.5 py-2.5"
                      >
                        <p className="text-xs leading-5 text-primary">{task.title}</p>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          {platform ? (
                            <span className={`text-[11px] ${platform.text}`}>{platform.name}</span>
                          ) : (
                            <span className="text-[11px] text-tertiary">通用</span>
                          )}
                          <span className={`ml-auto text-[11px] ${status.className}`}>
                            {status.label}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="周五专属 · 沧元图" hint="固定栏目，不占用常规选题池">
        <div className="rounded-card border border-accent bg-card p-4">
          <p className="text-sm text-primary">沧元图 S2 第 21 集解析：孟川破境，元神境的代价是什么</p>
          <p className="mt-1 text-xs text-tertiary">
            平台：B站 + 小红书 · 配图 6 张（孟川立绘 / 破境瞬间）· 状态：待发布
          </p>
        </div>
      </Section>

      <DataSourceNote sources={[weekly.source]} />
    </AppShell>
  );
}
