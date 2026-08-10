"use client";

import { useEffect, useRef, useState } from "react";

import { ButtonSecondary } from "./ButtonSecondary";

/** 后端 GET /jobs/{id} 的返回结构。 */
export interface JobSnapshot {
  job_id: string;
  kind: string;
  status: "running" | "done" | "error";
  stage: string;
  percent: number;
  message: string;
  result?: { article_id?: string; ok?: boolean } | null;
  error?: { code?: string; message?: string } | null;
  elapsed_ms: number;
}

/** 与后端 generation.py 的上报阶段一一对应，at = 该阶段起始百分比。 */
const STEPS = [
  { key: "core", label: "撰写母稿", hint: "最久的一步，约 1–2 分钟", at: 8 },
  { key: "rewrite", label: "改写四平台", hint: "头条/百家/B站/小红书并行", at: 55 },
  { key: "titles", label: "派生四平台标题", hint: "", at: 86 },
  { key: "images", label: "匹配配图", hint: "", at: 90 },
  { key: "render", label: "生成平台预览", hint: "", at: 94 },
  { key: "qa", label: "质检并保存草稿", hint: "", at: 97 },
];

function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

/**
 * 阶段内平滑爬行：后端百分比是跳变的（例如 55% 会停 60 秒不动），
 * 光靠它进度条看起来仍像卡死。这里让显示值在「当前阶段 → 下一阶段阈值」之间
 * 极缓慢爬升，收到新的真实进度时立刻对齐。
 *
 * 诚实性保证：爬行上限永远压在下一阶段阈值之下，绝不会虚假冲到 100%。
 */
function useCreepingPercent(target: number, running: boolean): number {
  const [display, setDisplay] = useState(target);
  const targetRef = useRef(target);

  useEffect(() => {
    // 真实进度到达即刻对齐，并且只进不退
    targetRef.current = target;
    setDisplay((d) => (target > d ? target : d));
  }, [target]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setDisplay((d) => {
        const real = targetRef.current;
        const next = STEPS.find((s) => s.at > real);
        // 爬行天花板：下一阶段阈值前 2 个点；已是最后阶段则封顶 99
        const ceiling = next ? next.at - 2 : 99;
        if (d >= ceiling) return d;
        return Math.min(d + 0.25, ceiling);
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  return display;
}

interface Props {
  open: boolean;
  topicTitle: string;
  job: JobSnapshot | null;
  /** 本地实时计时（后端 elapsed_ms 只在上报时刷新，本地更跟手） */
  startedAt: number | null;
  onBackground: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}

export function GenerationProgress({
  open,
  topicTitle,
  job,
  startedAt,
  onBackground,
  onRetry,
  onDismiss,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const running = job?.status === "running" || (open && !job);
  const failed = job?.status === "error";
  const done = job?.status === "done";

  // 秒级刷新已耗时：即使百分比不动，用户也能看到「它还活着」
  useEffect(() => {
    if (!open || !running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [open, running]);

  const realPercent = done ? 100 : job?.percent ?? 0;
  const percent = useCreepingPercent(realPercent, running);

  if (!open) return null;

  const elapsed = startedAt ? now - startedAt : job?.elapsed_ms ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-lg rounded-card border border-subtle bg-card p-5 shadow-xl">
        <h3 className="text-[16px] font-semibold text-primary">
          {failed ? "生成失败" : done ? "生成完成" : "正在生成四平台草稿"}
        </h3>
        <p className="mt-1 line-clamp-2 text-[13px] text-secondary">{topicTitle}</p>

        {/* 进度条 */}
        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[13px] text-secondary">
              {failed ? "已中断" : job?.message ?? "正在提交任务…"}
            </span>
            <span className="text-[13px] font-semibold tabular-nums text-primary">
              {Math.round(failed ? realPercent : percent)}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-root">
            <div
              className={`h-full rounded-full transition-[width] duration-700 ease-out ${
                failed ? "bg-plat-toutiao" : "bg-accent"
              }`}
              style={{ width: `${Math.max(2, failed ? realPercent : percent)}%` }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[12px] text-tertiary">
            <span>已用 {fmtDuration(elapsed)}</span>
            {running ? <span>整篇通常需要 3–5 分钟</span> : null}
          </div>
        </div>

        {/* 阶段清单 */}
        <ul className="mt-4 flex flex-col gap-1.5">
          {STEPS.map((step, i) => {
            const nextAt = STEPS[i + 1]?.at ?? 100;
            const isDone = done || realPercent >= nextAt;
            const isActive = !done && !isDone && realPercent >= step.at;
            return (
              <li key={step.key} className="flex items-center gap-2 text-[13px]">
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                    isDone
                      ? "bg-accent text-white"
                      : isActive
                        ? "bg-accent/20 text-accent"
                        : "bg-root text-tertiary"
                  }`}
                >
                  {isDone ? "✓" : isActive ? "•" : i + 1}
                </span>
                <span className={isActive ? "text-primary" : isDone ? "text-secondary" : "text-tertiary"}>
                  {step.label}
                </span>
                {step.hint && isActive ? (
                  <span className="text-[12px] text-tertiary">· {step.hint}</span>
                ) : null}
              </li>
            );
          })}
        </ul>

        {failed ? (
          <p className="mt-3 rounded-row border border-subtle bg-root px-3 py-2 text-[13px] text-plat-toutiao">
            {job?.error?.message || "生成失败，请稍后重试"}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          {failed ? (
            <>
              <ButtonSecondary onClick={onDismiss}>关闭</ButtonSecondary>
              <ButtonSecondary onClick={onRetry}>重试</ButtonSecondary>
            </>
          ) : done ? (
            <ButtonSecondary onClick={onDismiss}>关闭</ButtonSecondary>
          ) : (
            <ButtonSecondary onClick={onBackground}>转入后台（继续生成）</ButtonSecondary>
          )}
        </div>

        {running ? (
          <p className="mt-2 text-right text-[12px] text-tertiary">
            关掉页面也不会中断，回到本页会自动接着显示进度
          </p>
        ) : null}
      </div>
    </div>
  );
}
