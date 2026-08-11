"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppShell, Section } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { DataSourceNote } from "@/components/DataSourceNote";
import { GenerationProgress, type JobSnapshot } from "@/components/GenerationProgress";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "@/lib/clientApi";
import { setCurrentArticleId } from "@/lib/currentArticle";

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
  /** 是否已生成过文章 */
  generated: boolean;
  /** 已生成文章的状态: draft/published/"" */
  article_status: string;
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

/** 未完成的生成任务落 localStorage：切走再回来（甚至刷新）仍能接着看进度。 */
const JOB_STORAGE_KEY = "guoman.writeJob";

interface PersistedJob {
  jobId: string;
  topicId: number;
  title: string;
  startedAt: number;
}

function persistJob(v: PersistedJob) {
  try {
    window.localStorage.setItem(JOB_STORAGE_KEY, JSON.stringify(v));
  } catch {
    // localStorage 不可用（隐私模式等）不影响主流程，只是丢失跨页恢复能力
  }
}

function readPersistedJob(): PersistedJob | null {
  try {
    const raw = window.localStorage.getItem(JOB_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedJob) : null;
  } catch {
    return null;
  }
}

function clearPersistedJob() {
  try {
    window.localStorage.removeItem(JOB_STORAGE_KEY);
  } catch {
    // 同上
  }
}

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

  // 生成任务（异步 + 轮询）状态
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [jobStartedAt, setJobStartedAt] = useState<number | null>(null);
  const [writingTitle, setWritingTitle] = useState("");
  const [progressOpen, setProgressOpen] = useState(false);

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

  // 进入本页时恢复未完成的生成任务（用户可能切走过或刷新过）
  useEffect(() => {
    const saved = readPersistedJob();
    if (!saved) return;
    setJobId(saved.jobId);
    setJobStartedAt(saved.startedAt);
    setWritingTitle(saved.title);
    setWritingId(saved.topicId);
    setProgressOpen(true);
  }, []);

  // 轮询任务进度：1.5s 一次（任务要跑数分钟，这个频率足够跟手又不压后端）
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    async function poll() {
      try {
        const snap = await apiGet<JobSnapshot>(`/jobs/${jobId}`);
        if (cancelled) return;
        setJob(snap);
        if (snap.status === "done") {
          clearPersistedJob();
          const aid = snap.result?.article_id;
          if (aid) {
            setOk("草稿已生成，正在打开编辑器…");
            setCurrentArticleId(aid);
            router.push(`/writer?articleId=${aid}`);
          } else {
            setError("生成完成但未返回文章 ID");
          }
        } else if (snap.status === "error") {
          clearPersistedJob();
        }
      } catch (e) {
        if (cancelled) return;
        // 404 = 后端重启导致内存任务丢失：明确告知并停止轮询，不无限转圈
        const err = e as ApiError;
        if (err.status === 404) {
          clearPersistedJob();
          setJob({
            job_id: jobId ?? "",
            kind: "topic_write",
            status: "error",
            stage: "error",
            percent: 0,
            message: "任务已失效",
            error: { message: "任务已失效（后端可能重启过），请重新生成" },
            elapsed_ms: 0,
          });
        }
      }
    }

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobId, router]);

  // 任务终态后停止轮询：把 jobId 置空即可解绑上面的 interval
  useEffect(() => {
    if (job && job.status !== "running") {
      setJobId(null);
    }
  }, [job]);

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

  /**
   * 生成四平台草稿：走异步任务 + 进度轮询。
   *
   * 为什么不用同步 /write：整篇要跑 5 次 LLM 调用，实测 3–5 分钟。
   * 同步请求期间界面毫无反馈，用户会以为卡死并重复点击。
   */
  async function writeTopic(t: Topic) {
    setWritingId(t.id);
    setError(null);
    setOk(null);
    setJob(null);
    setProgressOpen(true);
    const startedAt = Date.now();
    setJobStartedAt(startedAt);
    setWritingTitle(t.title);
    try {
      const res = await apiPost<{ job_id: string }>(`/topics/${t.id}/write-async`);
      if (!res?.job_id) throw new ApiError("未返回任务 ID", 500);
      setJobId(res.job_id);
      persistJob({ jobId: res.job_id, topicId: t.id, title: t.title, startedAt });
    } catch (e) {
      setProgressOpen(false);
      setWritingId(null);
      setJobStartedAt(null);
      setError((e as ApiError).message || "写文章失败");
    }
  }

  /** 关闭进度弹层但任务继续在后台跑（顶部横幅仍显示进度）。 */
  function backgroundJob() {
    setProgressOpen(false);
  }

  /** 关闭并彻底忘掉当前任务（用于失败/完成后收尾）。 */
  function dismissJob() {
    setProgressOpen(false);
    setJobId(null);
    setJob(null);
    setJobStartedAt(null);
    setWritingId(null);
    clearPersistedJob();
  }

  function retryJob() {
    const t = topics.find((x) => x.id === writingId);
    clearPersistedJob();
    setJobId(null);
    setJob(null);
    if (t) void writeTopic(t);
    else setProgressOpen(false);
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
            {topics
              .filter((t) => t.article_status !== "published")
              .map((t) => (
              <div
                key={t.id}
                className={`flex flex-col rounded-card border bg-card p-4 ${
                  t.generated ? "border-success/30 bg-success/5" : "border-subtle"
                }`}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`shrink-0 rounded-row border border-subtle px-2 py-0.5 text-[11px] ${
                      TYPE_COLOR[t.topic_type] ?? "text-secondary"
                    }`}
                  >
                    {t.topic_type}
                  </span>
                  {t.generated ? (
                    <span className="shrink-0 rounded-row border border-success/30 px-2 py-0.5 text-[11px] text-success">
                      已生成
                    </span>
                  ) : null}
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
                    {writingId === t.id
                      ? "生成中…"
                      : t.generated
                      ? "重新生成"
                      : "生成并编辑"}
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

      {/* 生成进度弹层 */}
      <GenerationProgress
        open={progressOpen}
        topicTitle={writingTitle}
        job={job}
        startedAt={jobStartedAt}
        onBackground={backgroundJob}
        onRetry={retryJob}
        onDismiss={dismissJob}
      />

      {/* 转入后台后的常驻小横幅：任务还在跑，点一下能重新展开 */}
      {!progressOpen && job?.status === "running" ? (
        <button
          type="button"
          onClick={() => setProgressOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-3 rounded-card border border-subtle bg-card px-4 py-3 text-left shadow-xl hover:border-accent"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          <span className="flex flex-col">
            <span className="text-[13px] text-primary">
              正在后台生成 · {job.percent}%
            </span>
            <span className="text-[12px] text-tertiary">{job.message}</span>
          </span>
        </button>
      ) : null}

      <DataSourceNote sources={["backend"]} />
    </AppShell>
  );
}
