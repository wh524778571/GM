"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { StatusPill } from "@/components/StatusPill";
import { PublishButton } from "@/components/PublishModal";
import { Chip } from "@/components/Chip";
import { PLATFORMS } from "@/lib/platforms";
import { apiGet, apiPatch, ApiError } from "@/lib/clientApi";
import { toImageProxyUrl } from "@/lib/media";
import type { PlatformKey } from "@/lib/types";

const PLATFORM_ORDER: PlatformKey[] = ["xhs", "toutiao", "baijia", "bilibili"];

interface ArticleOut {
  article_id: string;
  title: string;
  status: string;
  content_text?: string | null;
  titles?: Record<string, string> | null;
  contents?: Record<string, string> | null;
  image_sources?: Record<string, unknown> | null;
}

const PLACEHOLDER_RE = /【配图(\d+)[:：](.*?)】/g;

/** 把正文里的【配图N：描述】渲染成真图（来自 image_sources 绑定的素材）。 */
function renderContentWithImages(
  text: string,
  imgMap: Record<string, string | null>,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
    const placeholder = m[0];
    const index = m[1];
    const description = m[2].trim();
    const before = text.slice(last, m.index);
    if (before.trim()) {
      nodes.push(
        <p key={key++} className="whitespace-pre-wrap text-[14px] leading-7 text-secondary">
          {before}
        </p>,
      );
    }
    const url = imgMap[placeholder];
    if (url) {
      nodes.push(
        <figure key={key++} className="my-2 overflow-hidden rounded-row border border-subtle">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={description} className="max-h-80 w-full object-cover" />
          <figcaption className="bg-raised px-3 py-1.5 text-xs text-tertiary">
            配图{index}：{description}
          </figcaption>
        </figure>,
      );
    } else {
      nodes.push(
        <p
          key={key++}
          className="rounded-row border border-dashed border-subtle bg-raised px-3 py-2 text-[13px] text-tertiary"
        >
          配图{index}：{description}（未绑定素材）
        </p>,
      );
    }
    last = m.index + placeholder.length;
  }
  const after = text.slice(last);
  if (after.trim()) {
    nodes.push(
      <p key={key++} className="whitespace-pre-wrap text-[14px] leading-7 text-secondary">
        {after}
      </p>,
    );
  }
  return nodes;
}

export function ArticleDetailScreen({ articleId }: { articleId: string }) {
  const router = useRouter();
  const [article, setArticle] = useState<ArticleOut | null>(null);
  const [title, setTitle] = useState("");
  const [activePlatform, setActivePlatform] = useState<PlatformKey>("xhs");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiGet<ArticleOut>(`/articles/${articleId}`)
      .then((a) => {
        if (!alive) return;
        setArticle(a);
        setTitle(a.title);
      })
      .catch((e) => alive && setError((e as ApiError).message || "加载失败"));
    return () => {
      alive = false;
    };
  }, [articleId]);

  async function saveTitle() {
    setBusy(true);
    setError(null);
    try {
      const a = await apiPatch<ArticleOut>(`/articles/${articleId}`, { title });
      setArticle(a);
      setOk("标题已保存");
    } catch (e) {
      setError((e as ApiError).message || "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("确认删除该文章？（软删，可恢复）")) return;
    setBusy(true);
    try {
      await apiPatch(`/articles/${articleId}`, { status: "deleted" });
      router.push("/articles");
    } catch (e) {
      setError((e as ApiError).message || "删除失败");
      setBusy(false);
    }
  }

  const platformContent =
    article?.contents?.[activePlatform] ?? article?.content_text ?? "（无正文）";

  const imgMap: Record<string, string | null> = {};
  for (const [ph, val] of Object.entries(article?.image_sources ?? {})) {
    const raw = typeof val === "string" ? val : "";
    if (!raw) continue;
    const url = raw.startsWith("/") || /^https?:/i.test(raw) ? raw : `/images/${raw}`;
    imgMap[ph] = toImageProxyUrl(url);
  }

  return (
    <AppShell
      title="文章详情"
      subtitle={articleId}
      actionLabel="返回列表"
      onAction={() => router.push("/articles")}
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

      <div className="flex flex-col gap-4 rounded-card border border-subtle bg-card p-5">
        <div className="flex items-center gap-3">
          {article ? <StatusPill status={article.status as never} /> : null}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="min-w-0 flex-1 rounded-btn border border-subtle bg-raised px-3 py-2 text-[15px] font-medium text-primary focus:border-accent focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {PLATFORM_ORDER.map((key) => (
            <Chip
              key={key}
              label={PLATFORMS[key].name}
              active={activePlatform === key}
              onClick={() => setActivePlatform(key)}
            />
          ))}
        </div>

        <div className="min-h-[160px] rounded-row border border-subtle bg-raised px-4 py-3">
          {renderContentWithImages(platformContent, imgMap)}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={saveTitle} disabled={busy}>
            保存标题
          </Button>
          {article ? (
            <PublishButton
              articleId={article.article_id}
              articleTitle={article.title}
              className="h-9"
            />
          ) : null}
          <ButtonSecondary className="ml-auto" onClick={remove} disabled={busy}>
            删除
          </ButtonSecondary>
        </div>
      </div>
    </AppShell>
  );
}
