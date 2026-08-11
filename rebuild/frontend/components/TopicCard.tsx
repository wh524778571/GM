"use client";

import { Button } from "./Button";

interface TopicCardProps {
  id: number;
  title: string;
  topic_type: string;
  summary: string;
  angle: string;
  viral_genes: string[];
  viral_why: string;
  generated: boolean;
  writing: boolean;
  onWrite: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onBlacklist: () => void;
}

const TYPE_COLOR: Record<string, string> = {
  一线资讯: "text-plat-toutiao", 最新剧情: "text-plat-toutiao",
  小众剧情: "text-plat-bilibili", 趣事: "text-plat-xhs",
  人物生日: "text-plat-baijia", 大事记: "text-accent",
  常青候选: "text-secondary",
};

const GENE_COLOR: Record<string, string> = {
  情绪钩子: "border-plat-toutiao/40 text-plat-toutiao bg-plat-toutiao/10",
  信息差: "border-plat-baijia/40 text-plat-baijia bg-plat-baijia/10",
  身份标签: "border-plat-xhs/40 text-plat-xhs bg-plat-xhs/10",
  行动触发: "border-plat-bilibili/40 text-plat-bilibili bg-plat-bilibili/10",
};
const GENE_FALLBACK = "border-subtle text-secondary bg-raised";

export function TopicCard({
  title, topic_type, summary, angle, viral_genes, viral_why,
  generated, writing, onWrite, onEdit, onDelete, onBlacklist,
}: TopicCardProps) {
  return (
    <div className={`flex flex-col rounded-card border bg-card p-4 ${
      generated ? "border-success/30 bg-success/5" : "border-subtle"
    }`}>
      <div className="flex items-start gap-2">
        <span className={`shrink-0 rounded-row border border-subtle px-2 py-0.5 text-[11px] ${
          TYPE_COLOR[topic_type] ?? "text-secondary"
        }`}>
          {topic_type}
        </span>
        {generated ? (
          <span className="shrink-0 rounded-row border border-success/30 px-2 py-0.5 text-[11px] text-success">
            已生成
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1 text-[13px]">
          <button type="button" onClick={onEdit} title="编辑"
            className="px-1 text-tertiary transition-colors hover:text-accent">✎</button>
          <button type="button" onClick={onDelete} title="删除"
            className="px-1 text-tertiary transition-colors hover:text-plat-toutiao">🗑</button>
          <button type="button" onClick={onBlacklist} title="不再推荐"
            className="px-1 text-tertiary transition-colors hover:text-plat-toutiao">✕</button>
        </div>
      </div>
      <h3 className="mt-2 text-[15px] font-semibold leading-6 text-primary">{title}</h3>
      {summary ? <p className="mt-1 text-[13px] leading-5 text-secondary">{summary}</p> : null}
      {angle ? <p className="mt-1 text-xs leading-5 text-tertiary">为什么现在写：{angle}</p> : null}
      {viral_genes.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {viral_genes.map((g) => (
            <span key={g} className={`rounded-row border px-2 py-0.5 text-[11px] ${GENE_COLOR[g] ?? GENE_FALLBACK}`}>
              {g}
            </span>
          ))}
        </div>
      ) : null}
      {viral_why ? (
        <p className="mt-1.5 text-xs leading-5 text-accent">
          <span className="text-tertiary">为什么能爆 · </span>{viral_why}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button onClick={onWrite} disabled={writing}>
          {writing ? "生成中…" : generated ? "重新生成" : "生成并编辑"}
        </Button>
      </div>
    </div>
  );
}
