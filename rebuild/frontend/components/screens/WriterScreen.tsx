"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { Chip } from "@/components/Chip";
import { MaterialPicker } from "@/components/MaterialPicker";
import { PLATFORMS } from "@/lib/platforms";
import { apiPatch, apiPost, ApiError } from "@/lib/clientApi";
import { toImageProxyUrl } from "@/lib/media";
import { SEED_WRITER_OUTLINE, SEED_WRITER_PREVIEW } from "@/lib/seed";
import type { ImageSuggestion, PlatformKey } from "@/lib/types";
import { useWriterDraft } from "@/components/WriterDraftContext";

const PLATFORM_ORDER: PlatformKey[] = ["xhs", "toutiao", "baijia", "bilibili"];

// 与后端 config/platforms.yaml 的 placeholder.pattern 保持一致，确保占位符原文
// 能精确匹配 image_suggestions[].placeholder，命中的素材才显示真图。
const PLACEHOLDER_RE = /【配图(\d+)[:：](.*?)】/g;

/** 行内渲染：把 **加粗** 渲染成 <strong>，行内换行转 <br/>。 */
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={`${keyBase}-b-${i}`} className="font-semibold text-primary">
          {part.slice(2, -2)}
        </strong>
      );
    }
    const lines = part.split("\n");
    return (
      <span key={`${keyBase}-t-${i}`}>
        {lines.map((ln, j) => (
          <span key={j}>
            {ln}
            {j < lines.length - 1 ? <br /> : null}
          </span>
        ))}
      </span>
    );
  });
}

function ImageBlock({
  index,
  description,
  suggestion,
  onPick,
}: {
  index: string;
  description: string;
  suggestion?: ImageSuggestion;
  onPick?: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const showImage = suggestion?.matched && suggestion?.url && !broken;
  if (showImage) {
    const src = toImageProxyUrl(suggestion!.url);
    return (
      <figure className="my-1 overflow-hidden rounded-row border border-subtle">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src ?? ""}
          alt={description}
          className="max-h-80 w-full object-cover"
          onError={() => setBroken(true)}
        />
        <figcaption className="flex items-center justify-between bg-raised px-3 py-1.5 text-xs text-tertiary">
          <span>配图{index}：{description}</span>
          {onPick ? (
            <button
              type="button"
              onClick={onPick}
              className="ml-2 shrink-0 text-accent hover:underline"
            >
              重新选择
            </button>
          ) : null}
        </figcaption>
      </figure>
    );
  }
  return (
    <div className="my-1 rounded-row border border-dashed border-subtle bg-raised px-3 py-6 text-center">
      <div className="text-[13px] text-secondary">配图{index}：{description}</div>
      <div className="mt-1 text-xs text-tertiary">
        {suggestion?.matched ? "图片加载失败，请从素材库重新选择" : "素材库暂无匹配，请从素材库选择"}
      </div>
      {onPick ? (
        <button
          type="button"
          onClick={onPick}
          className="mt-3 rounded-btn border border-accent px-3 py-1.5 text-[13px] text-accent hover:bg-accent/10"
        >
          从素材库选择
        </button>
      ) : null}
    </div>
  );
}

/** 把一段文字按 markdown 块渲染：## 小标题 / ### 子标题 / - 列表 / 普通段落。 */
function renderMarkdown(text: string, keyBase: string): React.ReactNode[] {
  const blocks = text.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  const nodes: React.ReactNode[] = [];
  blocks.forEach((block, bi) => {
    const key = `${keyBase}-blk-${bi}`;
    if (block.startsWith("### ")) {
      nodes.push(
        <h4 key={key} className="mt-3 text-[15px] font-semibold text-primary">
          {renderInline(block.slice(4), key)}
        </h4>,
      );
    } else if (block.startsWith("## ")) {
      nodes.push(
        <h3 key={key} className="mt-4 text-[16px] font-semibold text-primary">
          {renderInline(block.slice(3), key)}
        </h3>,
      );
    } else if (/^[-·*]\s+/.test(block.split("\n")[0] || "")) {
      const items = block.split("\n").map((l) => l.replace(/^[-·*]\s+/, "")).filter(Boolean);
      nodes.push(
        <ul key={key} className="ml-4 flex list-disc flex-col gap-1 text-[14px] leading-7 text-secondary">
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it, `${key}-li-${ii}`)}</li>
          ))}
        </ul>,
      );
    } else {
      nodes.push(
        <p key={key} className="text-[14px] leading-7 text-secondary">
          {renderInline(block, key)}
        </p>,
      );
    }
  });
  return nodes;
}

/** 把正文拆成「文字块 + 配图」交替的节点；命中素材库的显示真图，未命中的给选择框。 */
function renderArticleBody(
  text: string,
  suggestions: ImageSuggestion[] | undefined,
  onPick?: (placeholder: string, index: string, description: string) => void,
): React.ReactNode[] {
  const byPlaceholder = new Map<string, ImageSuggestion>();
  for (const s of suggestions ?? []) byPlaceholder.set(s.placeholder, s);

  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;

  while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
    const placeholder = m[0];
    const index = m[1];
    const description = m[2].trim();
    const before = text.slice(last, m.index);
    if (before.trim()) nodes.push(...renderMarkdown(before, `pre-${key++}`));
    nodes.push(
      <ImageBlock
        key={`img-${key++}`}
        index={index}
        description={description}
        suggestion={byPlaceholder.get(placeholder)}
        onPick={onPick ? () => onPick(placeholder, index, description) : undefined}
      />,
    );
    last = m.index + placeholder.length;
  }
  const after = text.slice(last);
  if (after.trim()) nodes.push(...renderMarkdown(after, `post-${key++}`));
  if (nodes.length === 0) {
    nodes.push(
      <p key="p-only" className="text-[14px] leading-7 text-secondary">
        {text}
      </p>,
    );
  }
  return nodes;
}

/** 合并自动匹配建议与用户手动绑定：手动绑定按占位符覆盖，优先级更高。 */
function mergeSuggestions(
  base: ImageSuggestion[] | undefined,
  bound: Record<string, ImageSuggestion> | undefined,
): ImageSuggestion[] {
  const map = new Map<string, ImageSuggestion>();
  for (const s of base ?? []) map.set(s.placeholder, s);
  for (const [ph, s] of Object.entries(bound ?? {})) map.set(ph, s);
  return Array.from(map.values());
}

export function WriterScreen() {
  const draft = useWriterDraft();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [picker, setPicker] = useState<{
    placeholder: string;
    index: string;
    description: string;
  } | null>(null);
  const [boundImages, setBoundImages] = useState<Record<string, ImageSuggestion>>({});

  function togglePlatform(key: PlatformKey) {
    draft.setPlatforms(
      draft.platforms.includes(key)
        ? draft.platforms.filter((k) => k !== key)
        : [...draft.platforms, key],
    );
  }

  async function handlePick(m: { id: number; stem: string; url: string | null }) {
    if (!picker) return;
    const ph = picker.placeholder;
    // 文章已落库则把绑定写回 image_sources（重载后仍在）；否则仅本地预览
    if (draft.articleId) {
      try {
        await apiPost(`/articles/${draft.articleId}/bind-image`, {
          placeholder: ph,
          material_id: m.id,
        });
      } catch {
        // 接口暂不可用 / 文章未落库：仍本地显示，不阻断
      }
    }
    setBoundImages((prev) => ({
      ...prev,
      [ph]: {
        placeholder: ph,
        index: Number(picker.index),
        description: picker.description,
        matched: true,
        url: m.url,
      },
    }));
    setOk(`已为「配图${picker.index}」选择素材：${m.stem}`);
    setPicker(null);
  }

  async function handleGenerate() {
    if (!draft.topic.trim()) {
      setError("请先填写选题");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    const id = draft.articleId ?? `gen-${Date.now()}`;
    draft.setArticleId(id);
    try {
      const res = await apiPost<{ article_id: string; persisted: boolean; result: typeof draft.result }>(
        `/articles/${id}/generate`,
        {
          topic: draft.topic,
          article_type: draft.articleType,
          requirement: draft.requirement,
          match_images: true,
          render: true,
          persist: true,
          include_html: false,
        },
      );
      draft.setResult(res.result);
      setOk("生成完成，已落库为草稿（可在「文章管理」查看）");
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 503) {
        setError("后端未配置 AI 密钥（ZHIPU_API_KEY），无法真实生成。演示可点「示例填充」。");
      } else if (err.status === 502) {
        setError("AI 服务限流或暂时不可用，请稍后重试。");
      } else if (err.status === 422) {
        setError(`质检未通过：${err.message}`);
      } else {
        setError(err.message || "生成失败");
      }
    } finally {
      setBusy(false);
    }
  }

  function fillSample() {
    draft.setResult({
      core: SEED_WRITER_PREVIEW,
      titles: {
        xhs: "沧元图孟川破境：元神境的代价",
        toutiao: "沧元图第21集：元神境代价全解析",
        baijia: "沧元图孟川破境深度解析",
        bilibili: "沧元图S2E21 元神境的代价",
      },
      contents: {
        xhs:
          "沧元图S2E21｜孟川破境那一刻，我直接坐直了\n\n· 这集把「破境」拍成献祭，拿走的每分力量都在别处扣回\n· 元神境来得晚，是因为代价还没攒够\n· 雪原那场消耗战，赢得难看但可信\n\n你也在追吗？评论区聊聊这集的「代价」值不值👇",
        toutiao:
          "沧元图第21集播完，弹幕里刷得最多的两个字是「值了」。\n\n这一集把孟川破境拍成了一场献祭——他拿走的每一分力量，都在别处被扣了回去。\n\n【配图1：沧元图_破境瞬间】\n\n先说结论：这集信息密度是本季最高，明面上是打，暗线全是代价。",
        baijia:
          "从数据看，沧元图S2第21集的完播率明显抬升，关键就在孟川破境这一段。\n\n【配图1：沧元图_破境瞬间】\n\n本集把「破境=失去」的母题第一次摆到台面，动画补了十一分钟心理戏，不是水，是铺垫。",
        bilibili:
          "沧元图这集最争议的其实是安海王那40秒——你觉得他是反转还是工具人？\n\n【配图1：沧元图_破境瞬间】\n\n评论区蹲一个深度解析，这40秒把前面十集铺垫全盘活了。",
      },
      image_sources: {},
      image_suggestions: [],
    });
    setOk("已用示例数据填充预览（演示用，不可发布）");
  }

  async function handleSaveDraft() {
    if (!draft.articleId) {
      await handleGenerate();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/articles/${draft.articleId}`, { title: draft.topic, status: "draft" });
      setOk("草稿已保存");
    } catch (e) {
      setError((e as ApiError).message || "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function handlePolish() {
    if (!draft.articleId) {
      setError("请先生成正文");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/articles/${draft.articleId}/polish`, {});
      setOk("润色完成（已去 AI 味）");
    } catch (e) {
      const err = e as ApiError;
      setError(err.status === 404 ? "润色功能后端尚未启用" : err.message || "润色失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    if (!draft.articleId) {
      setError("请先生成正文");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/articles/${draft.articleId}/export?format=docx`, {});
      setOk("已生成 docx（请前往下载）");
    } catch (e) {
      const err = e as ApiError;
      setError(err.status === 404 ? "导出功能后端尚未启用" : err.message || "导出失败");
    } finally {
      setBusy(false);
    }
  }

  const activeContent =
    draft.result?.contents?.[draft.activePlatform] ??
    draft.result?.core ??
    SEED_WRITER_PREVIEW;
  const charCount = activeContent.length;
  const activeTitle = draft.result?.titles?.[draft.activePlatform] ?? draft.topic;
  const suggestions = useMemo(
    () => mergeSuggestions(draft.result?.image_suggestions, boundImages),
    [draft.result?.image_suggestions, boundImages],
  );

  return (
    <AppShell
      title="AI 写作"
      subtitle="选题 → 大纲 → 生成 → 四平台预览 → 导出"
      actionLabel="新建选题"
      onAction={draft.reset}
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

      <div className="flex gap-gap4">
        {/* 左：创作设置 */}
        <div className="flex w-[336px] shrink-0 flex-col gap-4">
          <div className="rounded-card border border-subtle bg-card p-4">
            <h2 className="text-[18px] font-semibold text-primary">创作设置</h2>

            <label className="mt-3 block text-[13px] text-secondary" htmlFor="writer-topic">
              选题
            </label>
            <input
              id="writer-topic"
              value={draft.topic}
              onChange={(e) => draft.setTopic(e.target.value)}
              className="mt-1.5 h-9 w-full rounded-btn border border-subtle bg-raised px-3 text-[13px] text-primary focus:border-accent focus:outline-none"
            />

            <label className="mt-4 block text-[13px] text-secondary" htmlFor="writer-type">
              文体
            </label>
            <div id="writer-type" className="mt-1.5 flex gap-2">
              <Chip label="深度文" active={draft.articleType === "depth"} onClick={() => draft.setArticleType("depth")} />
              <Chip label="资讯速递" active={draft.articleType === "info"} onClick={() => draft.setArticleType("info")} />
            </div>

            <label className="mt-4 block text-[13px] text-secondary">目标平台</label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {PLATFORM_ORDER.map((key) => (
                <Chip
                  key={key}
                  label={PLATFORMS[key].name}
                  active={draft.platforms.includes(key)}
                  onClick={() => togglePlatform(key)}
                />
              ))}
            </div>

            <label className="mt-4 block text-[13px] text-secondary" htmlFor="writer-req">
              额外要求
            </label>
            <textarea
              id="writer-req"
              rows={3}
              value={draft.requirement}
              onChange={(e) => draft.setRequirement(e.target.value)}
              className="mt-1.5 w-full resize-none rounded-btn border border-subtle bg-raised px-3 py-2 text-[13px] leading-6 text-primary focus:border-accent focus:outline-none"
            />

            <div className="mt-4 flex gap-2">
              <Button className="flex-1" onClick={handleGenerate} disabled={busy}>
                {busy ? "生成中…" : "生成正文"}
              </Button>
              <ButtonSecondary onClick={handleSaveDraft} disabled={busy}>
                存草稿
              </ButtonSecondary>
            </div>
            <ButtonSecondary className="mt-2 w-full" onClick={fillSample} disabled={busy}>
              示例填充（演示用）
            </ButtonSecondary>
          </div>

          <div className="rounded-card border border-subtle bg-card p-4">
            <h2 className="text-[18px] font-semibold text-primary">大纲</h2>
            <ol className="mt-3 flex flex-col gap-2">
              {SEED_WRITER_OUTLINE.map((item, i) => (
                <li key={item} className="flex gap-2 text-[13px] leading-6 text-secondary">
                  <span className="text-tertiary">{i + 1}.</span>
                  <span className="min-w-0 flex-1">{item}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* 右：实时预览 */}
        <div className="flex min-w-0 flex-1 flex-col rounded-card border border-subtle bg-card">
          <div className="flex items-center gap-3 border-b border-subtle px-4 py-3">
            <h2 className="text-[18px] font-semibold text-primary">实时预览</h2>
            <span className="text-xs text-tertiary">
              约 {charCount} 字 · {PLATFORMS[draft.activePlatform].name}
              {draft.activePlatform === "xhs" ? "（纯文字无图 ≤1000 字）" : ""}
            </span>
            <div className="ml-auto flex gap-2">
              <ButtonSecondary className="h-8 px-3" onClick={handlePolish} disabled={busy}>
                润色去 AI 味
              </ButtonSecondary>
              <ButtonSecondary className="h-8 px-3" onClick={handleExport} disabled={busy}>
                导出 docx
              </ButtonSecondary>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-b border-subtle px-4 py-2.5">
            {PLATFORM_ORDER.map((key) => (
              <Chip
                key={key}
                label={PLATFORMS[key].name}
                active={draft.activePlatform === key}
                onClick={() => draft.setActivePlatform(key)}
              />
            ))}
          </div>

          <article className="flex flex-col gap-3 px-5 py-4">
            <h3 className="text-base font-semibold text-primary">{activeTitle || draft.topic}</h3>
            {renderArticleBody(activeContent, suggestions, (ph, idx, desc) =>
              setPicker({ placeholder: ph, index: idx, description: desc }),
            )}
          </article>
        </div>
      </div>

      <p className="mt-8 text-xs text-tertiary">
        生成走后端 /articles/&#123;id&#125;/generate（经同源 /api 代理）；智谱密钥仅存在于后端进程，前端不持有。
        离开本页再回来，草稿会自动保留（存于浏览器本地）。
      </p>

      <MaterialPicker
        open={picker !== null}
        initialQuery={picker?.description}
        onClose={() => setPicker(null)}
        onPick={handlePick}
      />
    </AppShell>
  );
}
