"use client";

import { useState } from "react";
import { AppShell, Section } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { Chip } from "@/components/Chip";
import { DataSourceNote } from "@/components/DataSourceNote";
import { PLATFORMS } from "@/lib/platforms";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/clientApi";
import { WEEKDAY_LABELS } from "@/lib/seed";
import type { PlatformKey, WeeklyTask } from "@/lib/types";

const WEEKDAYS = WEEKDAY_LABELS;
const FRIDAY = 4;

type TaskStatus = "planned" | "doing" | "done" | "skipped";
const STATUS_CYCLE: TaskStatus[] = ["planned", "doing", "done", "skipped"];
const STATUS_LABEL: Record<TaskStatus, { label: string; className: string }> = {
  planned: { label: "计划", className: "text-tertiary" },
  doing: { label: "进行中", className: "text-warning" },
  done: { label: "已完成", className: "text-success" },
  skipped: { label: "跳过", className: "text-tertiary" },
};

const PLATFORM_ORDER: PlatformKey[] = ["xhs", "toutiao", "baijia", "bilibili"];

function mondayOfThisWeek(): string {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

interface WeeklyItem {
  id: number;
  week_start: string;
  weekday: number;
  title: string;
  article_id?: string | null;
  platform?: string | null;
  status: string;
  note?: string | null;
}

function normalize(items: WeeklyItem[]): WeeklyTask[] {
  return items.map((t) => ({
    id: t.id,
    weekday: t.weekday,
    title: t.title,
    platform: (t.platform as PlatformKey) ?? null,
    status: (STATUS_CYCLE.includes(t.status as TaskStatus) ? t.status : "planned") as WeeklyTask["status"],
    note: t.note ?? null,
  }));
}

export function WeeklyScreen({ initialTasks }: { initialTasks: WeeklyTask[] }) {
  const [tasks, setTasks] = useState<WeeklyTask[]>(initialTasks);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newWeekday, setNewWeekday] = useState(0);
  const [newPlatform, setNewPlatform] = useState<PlatformKey | null>(null);

  const byDay = WEEKDAYS.map((_, i) => tasks.filter((t) => t.weekday === i));
  const fridayTasks = byDay[FRIDAY];

  async function reload() {
    try {
      const res = await apiGet<{ items: WeeklyItem[] }>("/weekly-plan");
      setTasks(normalize(res.items ?? []));
    } catch {
      /* 保留现有 */
    }
  }

  async function createTask() {
    if (!newTitle.trim()) {
      setError("请填写任务标题");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPost("/weekly-plan", {
        week_start: mondayOfThisWeek(),
        weekday: newWeekday,
        title: newTitle.trim(),
        platform: newPlatform ?? null,
        status: "planned",
      });
      setOk("任务已创建");
      setNewTitle("");
      setShowForm(false);
      await reload();
    } catch (e) {
      setError((e as ApiError).message || "创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function cycleStatus(task: WeeklyTask) {
    const idx = STATUS_CYCLE.indexOf(task.status as TaskStatus);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    setBusy(true);
    try {
      await apiPatch(`/weekly-plan/${task.id}`, { status: next });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: next } : t)));
    } catch (e) {
      setError((e as ApiError).message || "更新失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeTask(id: number | string) {
    if (!window.confirm("确认删除该任务？")) return;
    setBusy(true);
    try {
      await apiDelete(`/weekly-plan/${id}`);
      setOk("已删除");
      await reload();
    } catch (e) {
      const err = e as ApiError;
      setError(
        err.status === 404 || err.status === 405
          ? "删除功能后端尚未启用"
          : err.message || "删除失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyLastWeek() {
    setBusy(true);
    setError(null);
    try {
      const weekStart = mondayOfThisWeek();
      for (const t of tasks) {
        await apiPost("/weekly-plan", {
          week_start: weekStart,
          weekday: t.weekday,
          title: t.title,
          platform: t.platform ?? null,
          status: t.status,
        });
      }
      setOk(`已复制 ${tasks.length} 条到本周`);
      await reload();
    } catch (e) {
      setError((e as ApiError).message || "复制失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="周计划"
      subtitle="周看板 7 列 · 周五=沧元图专属日"
      actionLabel="新建任务"
      onAction={() => setShowForm((v) => !v)}
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
          <h2 className="text-[15px] font-semibold text-primary">新建任务</h2>
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="任务标题"
            className="mt-2 h-9 w-full rounded-btn border border-subtle bg-raised px-3 text-[13px] text-primary focus:border-accent focus:outline-none"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-secondary">周几</span>
            {WEEKDAYS.map((d, i) => (
              <Chip key={d} label={d} active={newWeekday === i} onClick={() => setNewWeekday(i)} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-secondary">平台</span>
            {PLATFORM_ORDER.map((k) => (
              <Chip
                key={k}
                label={PLATFORMS[k].name}
                active={newPlatform === k}
                onClick={() => setNewPlatform((p) => (p === k ? null : k))}
              />
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={createTask} disabled={busy}>
              创建
            </Button>
            <ButtonSecondary onClick={() => setShowForm(false)} disabled={busy}>
              取消
            </ButtonSecondary>
          </div>
        </div>
      ) : null}

      <Section
        title="本周排期"
        hint="周五为沧元图专属更新日"
        action={<ButtonSecondary onClick={copyLastWeek} disabled={busy}>复制上周排期</ButtonSecondary>}
      >
        <div className="flex gap-3">
          {WEEKDAYS.map((day, i) => {
            const isFriday = i === FRIDAY;
            return (
              <div
                key={day}
                className={[
                  "flex min-w-0 flex-1 flex-col gap-2 rounded-card border p-3",
                  isFriday ? "border-accent bg-[var(--weekly-friday-bg)]" : "border-subtle bg-card",
                ].join(" ")}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-[13px] font-medium ${isFriday ? "text-accent" : "text-secondary"}`}>
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
                    const status = STATUS_LABEL[task.status as TaskStatus];
                    return (
                      <div
                        key={task.id}
                        className="group rounded-row border border-subtle bg-raised px-2.5 py-2.5"
                      >
                        <p className="text-xs leading-5 text-primary">{task.title}</p>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          {platform ? (
                            <span className={`text-[11px] ${platform.text}`}>{platform.name}</span>
                          ) : (
                            <span className="text-[11px] text-tertiary">通用</span>
                          )}
                          <button
                            type="button"
                            onClick={() => cycleStatus(task)}
                            className={`ml-auto text-[11px] ${status.className} hover:underline`}
                          >
                            {status.label}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeTask(task.id)}
                            className="text-[11px] text-tertiary hover:text-plat-toutiao"
                            title="删除"
                          >
                            ✕
                          </button>
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
          {fridayTasks.length === 0 ? (
            <p className="text-sm text-tertiary">
              本周五暂无沧元图任务，点击「新建任务」并选「周五」添加。
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {fridayTasks.map((t) => (
                <li key={t.id} className="text-sm text-primary">
                  {t.title} {t.platform ? `· ${PLATFORMS[t.platform].name}` : ""} ·{" "}
                  <span className={STATUS_LABEL[t.status as TaskStatus].className}>
                    {STATUS_LABEL[t.status as TaskStatus].label}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      <DataSourceNote sources={["backend"]} />
    </AppShell>
  );
}
