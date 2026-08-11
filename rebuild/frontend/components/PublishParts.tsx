"use client";

import type { PublishPacket } from "@/lib/types";

/** 发布弹窗 · 配图清单 */
export function ImageChecklist({ tasks }: { tasks: PublishPacket["image_tasks"] }) {
  if (!tasks.length) return null;
  return (
    <div>
      <h3 className="text-[13px] font-medium text-primary">配图清单（需你在后台逐张上传）</h3>
      <ul className="mt-2 flex flex-col gap-1">
        {tasks.map((t) => (
          <li key={t.index} className="flex items-center gap-2 rounded-row border border-subtle bg-raised px-3 py-1.5 text-xs">
            <span className="text-tertiary">#{t.index}</span>
            <span className="min-w-0 flex-1 truncate text-secondary">{t.description}</span>
            <span className="truncate text-tertiary">{t.suggested_filename}</span>
            <span className={t.matched ? "text-success" : "text-warning"}>
              {t.matched ? "素材库已匹配" : "未匹配，需手动挑图"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 发布弹窗 · 人工步骤 */
export function ManualSteps({ steps }: { steps: string[] }) {
  if (!steps.length) return null;
  return (
    <div>
      <h3 className="text-[13px] font-medium text-primary">人工步骤</h3>
      <ol className="mt-2 flex flex-col gap-1">
        {steps.map((s, i) => (
          <li key={s} className="flex gap-2 text-[13px] leading-6 text-secondary">
            <span className="text-tertiary">{i + 1}.</span>
            <span className="min-w-0 flex-1">{s}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
