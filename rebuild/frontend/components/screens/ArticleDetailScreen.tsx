"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AppShell, Section } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { StatusPill } from "@/components/StatusPill";
import { PublishButton } from "@/components/PublishModal";
import { Chip } from "@/components/Chip";
import { KpiGrid } from "@/components/KpiGrid";
import { PLATFORMS } from "@/lib/platforms";
import { formatCompact } from "@/lib/format";
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

interface ArticleAnalytics {
  article_id: string;
  has_tracking: boolean;
  totals: {
    impress: number;
    views: number;
    likes: number;
    comments: number;
    bookmarks: number;
    engagement: number;
    engagement_rate: number | null;
    revenue_cents: number;
    rows: number;
  };
  platforms: Record<
    string,
    { views: number; likes: number; comments: number; bookmarks: number; revenue_cents: number }
  >;
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
      // 已绑定：渲染真图；不在读者视图展示「配图N：描述」这类内部作者标记
      nodes.push(
        <figure key={key++} className="my-2 overflow-hidden rounded-row border border-subtle">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={description} className="max-h-80 w-full object-cover" />
        </figure>,
      );
    }
    // 未绑定素材的占位符是内部作者标记，不在读者视图渲染，避免泄漏「配图N：描述」
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
  const [stats, setStats] = useState<ArticleAnalytics | null>(null);
  const [activePlatform, setActivePlatform] = useState<PlatformKey>("xhs");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    Promise.all([
      apiGet<ArticleOut>(`/articles/${articleId}`),
      apiGet<ArticleAnalytics>(`/analytics/article/${articleId}`),
    ])
      .then(([a, s]) => {
        if (!alive) return;
        setArticle(a);
        setStats(s);
      })
      .catch((e) => alive && setError((e as ApiError).message || "加载失败"));
    return () => {
      alive = false;
    };
  }, [articleId]);

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
          <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold text-primary">
            {article?.title}
          </h2>
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
          {article ? (
            <Button onClick={() => router.push(`/writer?articleId=${article.article_id}`)}>
              去编辑
            </Button>
          ) : null}
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

      <Section
        title="发布数据"
        hint={stats?.has_tracking ? "按追踪记录汇总" : "发布后 24h 到「数据看板」回填"}
      >
        {!stats || !stats.has_tracking ? (
          <div className="rounded-card border border-dashed border-subtle px-4 py-10 text-center text-[13px] text-tertiary">
            暂无发布数据 · 发布后录入追踪即可在此查看阅读 / 互动 / 收益
          </div>
        ) : (
          <>
            <KpiGrid
              items={[
                { label: "阅读量", value: formatCompact(stats.totals.views), tone: "success" },
                { label: "点赞", value: formatCompact(stats.totals.likes) },
                { label: "评论", value: formatCompact(stats.totals.comments) },
                { label: "收藏", value: formatCompact(stats.totals.bookmarks) },
              ]}
            />
            <div className="mt-4 rounded-card border border-subtle bg-card p-4">
              <h3 className="mb-2 text-[14px] font-semibold text-primary">分平台互动</h3>
              <ul className="divide-y divide-subtle">
                {PLATFORM_ORDER.filter((k) => stats.platforms[k]).map((k) => {
                  const p = stats.platforms[k];
                  return (
                    <li
                      key={k}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]"
                    >
                      <span className="w-20 shrink-0 text-secondary">{PLATFORMS[k].name}</span>
                      <span className="text-primary">阅读 {formatCompact(p.views)}</span>
                      <span className="text-tertiary">
                        赞 {p.likes} · 评 {p.comments} · 藏 {p.bookmarks}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
      </Section>
    </AppShell>
  );
}
