"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppShell, Section } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { DataSourceNote } from "@/components/DataSourceNote";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "@/lib/clientApi";

interface Topic {
  id: number;
  date: string;
  title: string;
  topic_type: string;
  summary: string;
  angle: string;
  article_type: string;
  blacklisted: boolean;
  recommend_count: number;
  fresh: boolean;
  viral_genes: string[];
  viral_why: string;
}

const TOPIC_TYPES = [
  "一线资讯",
  "小众剧情",
  "趣事",
  "人物生日",
  "大事记",
  "常青候选",
];

// 选题类型 → 配色（复用平台色，未命中则用 accent）
const TYPE_COLOR: Record<string, string> = {
  一线资讯: "text-plat-toutiao",
  最新剧情: "text-plat-toutiao",
  小众剧情: "text-plat-bilibili",
  趣事: "text-plat-xhs",
  人物生日: "text-plat-baijia",
  大事记: "text-accent",
  常青候选: "text-secondary",
};

// 爆款基因 → 配色（情绪红 / 信息差蓝 / 身份粉 / 行动绿）
const GENE_COLOR: Record<string, string> = {
  情绪钩子: "border-plat-toutiao/40 text-plat-toutiao bg-plat-toutiao/10",
  信息差: "border-plat-baijia/40 text-plat-baijia bg-plat-baijia/10",
  身份标签: "border-plat-xhs/40 text-plat-xhs bg-plat-xhs/10",
  行动触发: "border-plat-bilibili/40 text-plat-bilibili bg-plat-bilibili/10",
};
const GENE_FALLBACK = "border-subtle text-secondary bg-raised";

interface TopicForm {
  title: string;
  topic_type: string;
  summary: string;
  angle: string;
  article_type: string;
  viral_genes: string;
  viral_why: string;
}

const EMPTY_FORM: TopicForm = {
  title: "",
  topic_type: "常青候选",
  summary: "",
  angle: "",
  article_type: "depth",
  viral_genes: "",
  viral_why: "",
};

export function TopicsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [blacklisted, setBlacklisted] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [writingId, setWritingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // 模态表单状态：modal=null 关闭；editing 非空表示编辑该选题
  const [modal, setModal] = useState<{ open: boolean; editing: Topic | null }>({
    open: false,
    editing: null,
  });
  const [form, setForm] = useState<TopicForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadToday = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ items: Topic[]; needs_generation: boolean; blacklisted_count: number }>(
        "/topics",
      );
      setTopics(res?.items ?? []);
    } catch (e) {
      setError((e as ApiError).message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // 切回本页（pathname 变化回到 /topics）时重新拉取今日选题，
  // 避免 App Router 软导航复用组件实例、mount effect 不重跑导致选题「切走再切回就没了」
  useEffect(() => {
    void loadToday();
  }, [pathname, loadToday]);

  async function generate() {
    setGenerating(true);
    setError(null);
    setOk(null);
    try {
      const res = await apiPost<{ items: Topic[]; generated: number }>("/topics");
      // 去重后可能无新选题（generated=0 且 items 为空）：保留当前列表，不盲目清空
      if (res?.items && res.items.length > 0) {
        setTopics(res.items);
        setBlacklisted([]);
        setOk(`已生成 ${res.generated ?? 0} 个今日选题`);
      } else {
        setOk("今日选题已存在，无需重复生成");
      }
    } catch (e) {
      setError((e as ApiError).message || "生成失败");
    } finally {
      setGenerating(false);
    }
  }

  async function writeTopic(t: Topic) {
    setWritingId(t.id);
    setError(null);
    setOk(null);
    try {
      const res = await apiPost<{ article_id: string }>(`/topics/${t.id}/write`);
      const aid = res?.article_id;
      if (!aid) throw new ApiError("未返回文章 ID", 500);
      router.push(`/writer?articleId=${aid}`);
    } catch (e) {
      setError((e as ApiError).message || "写文章失败");
      setWritingId(null);
    }
  }

  async function blacklistTopic(t: Topic) {
    setError(null);
    try {
      await apiPost(`/topics/${t.id}/blacklist`, { blacklisted: true });
      setTopics((prev) => prev.filter((x) => x.id !== t.id));
      setBlacklisted((prev) => [{ ...t, blacklisted: true }, ...prev]);
      setOk(`已拉黑「${t.title}」，后续不再推荐`);
    } catch (e) {
      setError((e as ApiError).message || "拉黑失败");
    }
  }

  async function restoreTopic(t: Topic) {
    setError(null);
    try {
      await apiPost(`/topics/${t.id}/blacklist`, { blacklisted: false });
      setBlacklisted((prev) => prev.filter((x) => x.id !== t.id));
      setOk(`已恢复「${t.title}」`);
    } catch (e) {
      setError((e as ApiError).message || "恢复失败");
    }
  }

  // ── 新建 / 编辑 ──────────────────────────────────────────
  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setModal({ open: true, editing: null });
  }

  function openEdit(t: Topic) {
    setForm({
      title: t.title,
      topic_type: t.topic_type,
      summary: t.summary,
      angle: t.angle,
      article_type: t.article_type,
      viral_genes: (t.viral_genes ?? []).join("，"),
      viral_why: t.viral_why,
    });
    setFormError(null);
    setModal({ open: true, editing: t });
  }

  async function submitTopic() {
    const title = form.title.trim();
    if (!title) {
      setFormError("标题不能为空");
      return;
    }
    setSaving(true);
    setFormError(null);
    const payload = {
      title,
      topic_type: form.topic_type,
      summary: form.summary.trim(),
      angle: form.angle.trim(),
      article_type: form.article_type,
      viral_genes: form.viral_genes
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      viral_why: form.viral_why.trim(),
    };
    try {
      if (modal.editing) {
        await apiPatch(`/topics/${modal.editing.id}`, payload);
        setOk(`已更新「${title}」`);
      } else {
        await apiPost(`/topics/import`, payload);
        setOk(`已新建选题「${title}」`);
      }
      setModal({ open: false, editing: null });
      await loadToday();
    } catch (e) {
      setFormError((e as ApiError).message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTopic(t: Topic) {
    if (!window.confirm(`确认删除选题「${t.title}」？（删除后不可恢复，可重新生成）`)) return;
    setError(null);
    try {
      await apiDelete(`/topics/${t.id}`);
      setTopics((prev) => prev.filter((x) => x.id !== t.id));
      setOk(`已删除「${t.title}」`);
    } catch (e) {
      setError((e as ApiError).message || "删除失败");
    }
  }

  return (
    <AppShell
      title="今日推荐选题"
      subtitle="AI 按你的标准每天挑 5 个 · 也可手动新建/编辑 · 点一下就出文"
      actionLabel="生成今日选题"
      onAction={generate}
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

      <Section
        title="今日 5 选"
        hint="选题为 AI 建议，写作前请自行核实事实"
        action={
          <div className="flex items-center gap-2">
            <ButtonSecondary onClick={openCreate}>+ 新建选题</ButtonSecondary>
            <ButtonSecondary onClick={generate} disabled={generating}>
              {generating ? "生成中…" : "重新生成"}
            </ButtonSecondary>
          </div>
        }
      >
        {loading ? (
          <div className="rounded-card border border-dashed border-subtle px-4 py-10 text-center text-sm text-tertiary">
            加载中…
          </div>
        ) : topics.length === 0 ? (
          <div className="rounded-card border border-dashed border-subtle px-4 py-10 text-center">
            <p className="text-sm text-tertiary">今天还没有选题</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button onClick={openCreate}>+ 新建选题</Button>
              <Button onClick={generate} disabled={generating}>
                {generating ? "生成中…" : "生成今日选题"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {topics.map((t) => (
              <div
                key={t.id}
                className="flex flex-col rounded-card border border-subtle bg-card p-4"
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`shrink-0 rounded-row border border-subtle px-2 py-0.5 text-[11px] ${
                      TYPE_COLOR[t.topic_type] ?? "text-secondary"
                    }`}
                  >
                    {t.topic_type}
                  </span>
                  <div className="ml-auto flex items-center gap-1 text-[13px]">
                    <button
                      type="button"
                      onClick={() => openEdit(t)}
                      title="编辑"
                      className="px-1 text-tertiary transition-colors hover:text-accent"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteTopic(t)}
                      title="删除"
                      className="px-1 text-tertiary transition-colors hover:text-plat-toutiao"
                    >
                      🗑
                    </button>
                    <button
                      type="button"
                      onClick={() => blacklistTopic(t)}
                      title="不再推荐"
                      className="px-1 text-tertiary transition-colors hover:text-plat-toutiao"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <h3 className="mt-2 text-[15px] font-semibold leading-6 text-primary">{t.title}</h3>
                {t.summary ? (
                  <p className="mt-1 text-[13px] leading-5 text-secondary">{t.summary}</p>
                ) : null}
                {t.angle ? (
                  <p className="mt-1 text-xs leading-5 text-tertiary">为什么现在写：{t.angle}</p>
                ) : null}
                {t.viral_genes && t.viral_genes.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {t.viral_genes.map((g) => (
                      <span
                        key={g}
                        className={`rounded-row border px-2 py-0.5 text-[11px] ${
                          GENE_COLOR[g] ?? GENE_FALLBACK
                        }`}
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                ) : null}
                {t.viral_why ? (
                  <p className="mt-1.5 text-xs leading-5 text-accent">
                    <span className="text-tertiary">为什么能爆 · </span>
                    {t.viral_why}
                  </p>
                ) : null}
                <div className="mt-3 flex gap-2">
                  <Button onClick={() => writeTopic(t)} disabled={writingId === t.id}>
                    {writingId === t.id ? "生成中…" : "生成并编辑"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {blacklisted.length > 0 ? (
        <Section title={`已屏蔽（${blacklisted.length}）`} hint="拉黑后永久不推，可随时恢复">
          <div className="flex flex-col gap-2">
            {blacklisted.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 rounded-row border border-subtle bg-raised px-3 py-2"
              >
                <span className="text-xs text-tertiary line-through">{t.title}</span>
                <button
                  type="button"
                  onClick={() => restoreTopic(t)}
                  className="ml-auto text-[12px] text-accent hover:underline"
                >
                  恢复
                </button>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* 新建 / 编辑 模态 */}
      {modal.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-card border border-subtle bg-card p-5 shadow-xl">
            <h3 className="text-[16px] font-semibold text-primary">
              {modal.editing ? "编辑选题" : "新建选题"}
            </h3>
            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-[13px] text-secondary">
                标题 *
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="如：沧元图第X集名场面解析"
                  className="rounded-row border border-subtle bg-root px-3 py-2 text-[14px] text-primary outline-none focus:border-accent"
                />
              </label>
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1 text-[13px] text-secondary">
                  类型
                  <select
                    value={form.topic_type}
                    onChange={(e) => setForm({ ...form, topic_type: e.target.value })}
                    className="rounded-row border border-subtle bg-root px-3 py-2 text-[14px] text-primary outline-none focus:border-accent"
                  >
                    {TOPIC_TYPES.map((tp) => (
                      <option key={tp} value={tp}>
                        {tp}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-1 flex-col gap-1 text-[13px] text-secondary">
                  文章类型
                  <select
                    value={form.article_type}
                    onChange={(e) => setForm({ ...form, article_type: e.target.value })}
                    className="rounded-row border border-subtle bg-root px-3 py-2 text-[14px] text-primary outline-none focus:border-accent"
                  >
                    <option value="depth">深度 (depth)</option>
                    <option value="info">资讯 (info)</option>
                  </select>
                </label>
              </div>
              <label className="flex flex-col gap-1 text-[13px] text-secondary">
                一句话钩子
                <input
                  value={form.summary}
                  onChange={(e) => setForm({ ...form, summary: e.target.value })}
                  placeholder="选题的吸睛点"
                  className="rounded-row border border-subtle bg-root px-3 py-2 text-[14px] text-primary outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col gap-1 text-[13px] text-secondary">
                为什么现在写
                <input
                  value={form.angle}
                  onChange={(e) => setForm({ ...form, angle: e.target.value })}
                  placeholder="结合热点/痛点"
                  className="rounded-row border border-subtle bg-root px-3 py-2 text-[14px] text-primary outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col gap-1 text-[13px] text-secondary">
                爆款基因（逗号分隔）
                <input
                  value={form.viral_genes}
                  onChange={(e) => setForm({ ...form, viral_genes: e.target.value })}
                  placeholder="情绪钩子，信息差，身份标签"
                  className="rounded-row border border-subtle bg-root px-3 py-2 text-[14px] text-primary outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col gap-1 text-[13px] text-secondary">
                为什么能爆
                <input
                  value={form.viral_why}
                  onChange={(e) => setForm({ ...form, viral_why: e.target.value })}
                  placeholder="20-40字，结合热点或痛点"
                  className="rounded-row border border-subtle bg-root px-3 py-2 text-[14px] text-primary outline-none focus:border-accent"
                />
              </label>
            </div>

            {formError ? (
              <p className="mt-3 text-[13px] text-plat-toutiao">{formError}</p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <ButtonSecondary onClick={() => setModal({ open: false, editing: null })}>
                取消
              </ButtonSecondary>
              <Button onClick={submitTopic} disabled={saving}>
                {saving ? "保存中…" : modal.editing ? "保存修改" : "创建"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <DataSourceNote sources={["backend"]} />
    </AppShell>
  );
}
