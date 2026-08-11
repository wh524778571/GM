"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ButtonSecondary } from "./ButtonSecondary";
import { PLATFORMS, normalizePlatform } from "@/lib/platforms";
import { copyPlainText } from "@/lib/clipboard";
import { toImageProxyUrl } from "@/lib/media";
import type {
  PublishPacket,
  PublishPacketsResponse,
  PublishState,
  PublishStatusResponse,
} from "@/lib/types";

/**
 * 人工发布弹窗 —— Phase 4 的「诚实闭环」在界面上的落点。
 *
 * 这里**没有**「一键发布」按钮，这是刻意的：系统不持有任何平台登录态，
 * 也不会替你打开浏览器。它只做三件事：
 *   1) 把四个平台各自的可复制正文 + 配图清单 + 人工步骤摆出来；
 *   2) 在你亲手点「我已在 XX 发布」之前，状态一直显示「待人工发布」；
 *   3) 你点了才写库；失败也必须写原因，不许静默。
 */

const STATE_BADGE: Record<PublishState, string> = {
  pending: "border-warning/40 bg-warning/10 text-warning",
  published: "border-success/40 bg-success/10 text-success",
  failed: "border-plat-toutiao/40 bg-plat-toutiao/10 text-plat-toutiao",
};

interface ErrorBody {
  detail?: { code?: string; message?: string } | string;
  error?: string;
}

function errorText(status: number, body: unknown): string {
  const b = body as ErrorBody | null;
  const detail = b?.detail;
  if (detail && typeof detail === "object" && detail.message) {
    return `${detail.message}（${detail.code ?? status}）`;
  }
  if (typeof detail === "string") return `${detail}（${status}）`;
  return `请求失败：HTTP ${status}`;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function PublishModal({
  articleId,
  articleTitle,
  onClose,
}: {
  articleId: string;
  articleTitle: string;
  onClose: () => void;
}) {
  const [packets, setPackets] = useState<PublishPacket[] | null>(null);
  const [status, setStatus] = useState<PublishStatusResponse | null>(null);
  const [active, setActive] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [postedUrl, setPostedUrl] = useState("");
  const [failReason, setFailReason] = useState("");

  const load = useCallback(async () => {
    setLoadError(null);
    const res = await fetch(
      `/api/articles/${encodeURIComponent(articleId)}/publish/packets?include_html=true`,
      { cache: "no-store" },
    );
    const body = await readJson(res);
    if (!res.ok) {
      setLoadError(errorText(res.status, body));
      return;
    }
    const data = body as PublishPacketsResponse;
    setPackets(data.packets ?? []);
  }, [articleId]);

  const loadStatus = useCallback(async () => {
    const res = await fetch(`/api/articles/${encodeURIComponent(articleId)}/publish/status`, {
      cache: "no-store",
    });
    const body = await readJson(res);
    if (res.ok) setStatus(body as PublishStatusResponse);
  }, [articleId]);

  useEffect(() => {
    void load();
    void loadStatus();
  }, [load, loadStatus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const packet = packets?.[active] ?? null;

  // 状态以 /publish/status 为准（确认后即时刷新），发布包只提供内容。
  const liveState: PublishState = packet
    ? (status?.platforms?.[packet.platform]?.state ?? packet.state)
    : "pending";
  const liveLabel = packet
    ? (status?.platforms?.[packet.platform]?.state_label ?? packet.state_label)
    : "待人工发布";

  async function post(path: "confirm" | "fail", payload: Record<string, unknown>) {
    setBusy(true);
    setActionError(null);
    setActionOk(null);
    try {
      const res = await fetch(`/api/articles/${encodeURIComponent(articleId)}/publish/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await readJson(res);
      if (!res.ok) {
        // 失败就是失败：不刷新成功文案，也不把状态改成已发布。
        setActionError(errorText(res.status, body));
        return;
      }
      const ok = body as { status?: PublishStatusResponse };
      if (ok.status) setStatus(ok.status);
      setActionOk(
        path === "confirm"
          ? `已记录：${packet?.platform_name ?? ""} 由你确认发布`
          : `已登记失败：${packet?.platform_name ?? ""}`,
      );
      setPostedUrl("");
      setFailReason("");
    } catch {
      setActionError("网络异常，状态未改变（仍是待人工发布）");
    } finally {
      setBusy(false);
    }
  }

  async function copyBody() {
    if (!packet) return;
    const bodyEl = bodyRef.current?.querySelector(".publish-body-inner");
    const html = bodyEl?.innerHTML ?? packet.html ?? "";
    // 纯文本：去除 HTML 标签后的正文
    const plain = (bodyEl?.textContent ?? packet.copy_text).trim();
    const label = packet.platform_name;

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      setCopied(`b-${packet.platform}`);
      window.setTimeout(() => setCopied(null), 1600);
      setActionOk(`已复制「${label}」图文，去平台编辑器直接粘贴`);
    } catch {
      // 富文本复制失败 → 降级纯文字
      try {
        await copyPlainText(plain);
        setCopied(`b-${packet.platform}`);
        window.setTimeout(() => setCopied(null), 1600);
        setActionOk(`已复制「${label}」文字（浏览器不支持图文复制）`);
      } catch {
        setActionError("复制失败，请手动选中正文复制");
      }
    }
  }

  const bodyRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-root/80 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="人工发布"
    >
      <div className="w-full max-w-[900px] rounded-card border border-subtle bg-card">
        {/* 头部 */}
        <div className="flex items-start gap-3 border-b border-subtle px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[18px] font-semibold text-primary">发布 · {articleTitle}</h2>
            <p className="mt-1 text-xs text-tertiary">
              系统不会替你发布，也不持有任何平台账号。下面是四平台的可复制内容和人工步骤；
              你在对应平台发完后回来点确认，状态才会变。
            </p>
          </div>
          <ButtonSecondary className="h-8 px-3" onClick={onClose}>
            关闭
          </ButtonSecondary>
        </div>

        {loadError ? (
          <div className="px-5 py-8">
            <p className="text-[13px] text-plat-toutiao">{loadError}</p>
            <ButtonSecondary className="mt-3 h-8 px-3" onClick={() => void load()}>
              重试
            </ButtonSecondary>
          </div>
        ) : !packets ? (
          <p className="px-5 py-8 text-[13px] text-tertiary">正在组装发布包…</p>
        ) : packets.length === 0 ? (
          <p className="px-5 py-8 text-[13px] text-warning">该文章还没有任何平台内容，先去生成正文。</p>
        ) : (
          <>
            {/* 平台切换 */}
            <div className="flex flex-wrap gap-2 border-b border-subtle px-5 py-3">
              {packets.map((p, i) => {
                const st = status?.platforms?.[p.platform]?.state ?? p.state;
                const key = normalizePlatform(p.platform);
                return (
                  <button
                    key={p.platform}
                    type="button"
                    onClick={() => {
                      setActive(i);
                      setActionError(null);
                      setActionOk(null);
                    }}
                    className={`inline-flex h-8 items-center gap-2 rounded-pill border px-3 text-[13px] transition-colors ${
                      i === active
                        ? "border-accent bg-accent-bg text-primary"
                        : "border-subtle bg-raised text-secondary hover:text-primary"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-pill ${PLATFORMS[key].bg}`} />
                    {p.platform_name}
                    <span
                      className={`rounded-pill border px-1.5 text-[11px] ${STATE_BADGE[st as PublishState]}`}
                    >
                      {st === "published" ? "已发布" : st === "failed" ? "失败" : "待人工发布"}
                    </span>
                  </button>
                );
              })}
              <span className="ml-auto self-center text-xs text-tertiary">
                已确认 {status?.published_count ?? 0}/{status?.total_platforms ?? packets.length}
                {" · 文章状态 "}
                {status?.article_status ?? "draft"}
              </span>
            </div>

            {packet ? (
              <div className="flex flex-col gap-4 px-5 py-4">
                {/* 状态 + 阻断/提醒 */}
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex h-6 items-center rounded-pill border px-3 text-xs font-medium ${STATE_BADGE[liveState]}`}
                  >
                    {liveLabel}
                  </span>
                  <span className="text-xs text-tertiary">
                    标题 {packet.title_char_count}/{packet.title_max_chars} 字 · 正文{" "}
                    {packet.body_char_count}
                    {packet.body_max_chars ? `/${packet.body_max_chars}` : ""} 字 ·{" "}
                    {packet.images_allowed ? "可配图" : "纯文字无图"}
                  </span>
                </div>

                {packet.blockers.length > 0 && (
                  <ul className="rounded-row border border-plat-toutiao/40 bg-plat-toutiao/10 px-3 py-2 text-[13px] text-plat-toutiao">
                    {packet.blockers.map((b) => (
                      <li key={b}>阻断：{b}</li>
                    ))}
                  </ul>
                )}
                {packet.warnings.length > 0 && (
                  <ul className="rounded-row border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-warning">
                    {packet.warnings.map((w) => (
                      <li key={w}>提醒：{w}</li>
                    ))}
                  </ul>
                )}

                {/* 可复制内容 */}
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-[13px] font-medium text-primary">可直接复制的内容</h3>
                    <ButtonSecondary
                      className="h-7 px-2.5 text-xs"
                      onClick={() => {
                        if (!packet) return;
                        void copyPlainText(packet.title).then(() => {
                          setCopied(`t-${packet.platform}`);
                          window.setTimeout(() => setCopied(null), 1600);
                        });
                      }}
                    >
                      {copied === `t-${packet.platform}` ? "标题已复制" : "复制标题"}
                    </ButtonSecondary>
                    <ButtonSecondary
                      className="h-7 px-2.5 text-xs"
                      onClick={() => void copyBody()}
                    >
                      {copied === `b-${packet.platform}` ? "正文已复制" : "复制正文（含图）"}
                    </ButtonSecondary>
                    {packet.console_url ? (
                      <a
                        href={packet.console_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-accent hover:underline"
                      >
                        打开{packet.platform_name}后台 ↗
                      </a>
                    ) : null}
                  </div>
                  <div className="mt-2 rounded-row border border-subtle bg-raised px-3 py-2 text-[13px] text-primary">
                    {packet.title || "（该平台无标题）"}
                  </div>
                  <div
                    ref={bodyRef}
                    dangerouslySetInnerHTML={{
                      __html: (packet.html || "").replace(
                        /<img\s+src="([^"]+)"/g,
                        (_m: string, src: string) => {
                          const proxy = toImageProxyUrl(src);
                          return proxy ? `<img src="${proxy}"` : _m;
                        },
                      ),
                    }}
                    className="publish-body mt-2 rounded-row border border-subtle bg-raised px-4 py-3 text-[15px] leading-relaxed text-primary [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:mt-3 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_p]:my-2 [&_strong]:font-semibold [&_img]:max-w-full [&_img]:my-3 [&_img]:rounded [&_blockquote]:border-l-2 [&_blockquote]:border-accent/60 [&_blockquote]:pl-3 [&_blockquote]:my-2 [&_blockquote]:text-secondary [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2 [&_li]:my-1"
                  />
                </div>

                {/* 配图清单 */}
                {packet.images_allowed && packet.image_tasks.length > 0 && (
                  <div>
                    <h3 className="text-[13px] font-medium text-primary">
                      配图清单（需你在后台逐张上传）
                    </h3>
                    <ul className="mt-2 flex flex-col gap-1">
                      {packet.image_tasks.map((t) => (
                        <li
                          key={t.index}
                          className="flex items-center gap-2 rounded-row border border-subtle bg-raised px-3 py-1.5 text-xs"
                        >
                          <span className="text-tertiary">#{t.index}</span>
                          <span className="min-w-0 flex-1 truncate text-secondary">
                            {t.description}
                          </span>
                          <span className="truncate text-tertiary">{t.suggested_filename}</span>
                          <span className={t.matched ? "text-success" : "text-warning"}>
                            {t.matched ? "素材库已匹配" : "未匹配，需手动挑图"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 人工步骤 */}
                <div>
                  <h3 className="text-[13px] font-medium text-primary">人工步骤</h3>
                  <ol className="mt-2 flex flex-col gap-1">
                    {packet.manual_steps.map((s, i) => (
                      <li key={s} className="flex gap-2 text-[13px] leading-6 text-secondary">
                        <span className="text-tertiary">{i + 1}.</span>
                        <span className="min-w-0 flex-1">{s}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                {/* 确认 / 失败 */}
                <div className="rounded-row border border-subtle bg-raised px-3 py-3">
                  {liveState === "published" ? (
                    <p className="text-[13px] text-success">
                      已由 {status?.platforms?.[packet.platform]?.confirmed_by ?? "human"} 于{" "}
                      {status?.platforms?.[packet.platform]?.confirmed_at ?? "—"} 确认发布
                      {status?.platforms?.[packet.platform]?.posted_url ? (
                        <>
                          {" · "}
                          <a
                            href={status.platforms[packet.platform].posted_url ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent hover:underline"
                          >
                            查看链接 ↗
                          </a>
                        </>
                      ) : null}
                    </p>
                  ) : (
                    <>
                      <label
                        className="block text-xs text-tertiary"
                        htmlFor={`url-${packet.platform}`}
                      >
                        作品链接（可选，填了必须是 http/https）
                      </label>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        <input
                          id={`url-${packet.platform}`}
                          value={postedUrl}
                          onChange={(e) => setPostedUrl(e.target.value)}
                          placeholder="https://…"
                          className="h-9 min-w-[240px] flex-1 rounded-btn border border-subtle bg-card px-3 text-[13px] text-primary focus:border-accent focus:outline-none"
                        />
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void post("confirm", {
                              platform: packet.platform,
                              confirmed: true,
                              posted_url: postedUrl.trim() || null,
                              confirmed_by: "human",
                            })
                          }
                          className="inline-flex h-9 items-center justify-center rounded-btn bg-accent px-4 text-sm font-medium text-root transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          我已在{packet.platform_name}发布
                        </button>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <input
                          value={failReason}
                          onChange={(e) => setFailReason(e.target.value)}
                          placeholder="发布失败原因（登记失败时必填）"
                          aria-label="发布失败原因"
                          className="h-9 min-w-[240px] flex-1 rounded-btn border border-subtle bg-card px-3 text-[13px] text-primary focus:border-accent focus:outline-none"
                        />
                        <ButtonSecondary
                          disabled={busy || failReason.trim().length === 0}
                          className="disabled:opacity-50"
                          onClick={() =>
                            void post("fail", {
                              platform: packet.platform,
                              reason: failReason.trim(),
                            })
                          }
                        >
                          登记失败
                        </ButtonSecondary>
                      </div>

                      <p className="mt-2 text-xs text-tertiary">
                        在你点击之前，这个平台的状态一直是「待人工发布」——系统不会自动变绿。
                      </p>
                    </>
                  )}

                  {actionError ? (
                    <p className="mt-2 text-[13px] text-plat-toutiao">{actionError}</p>
                  ) : null}
                  {actionOk ? <p className="mt-2 text-[13px] text-success">{actionOk}</p> : null}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** 列表页/写作页共用的入口按钮。 */
export function PublishButton({
  articleId,
  articleTitle,
  className = "",
  label = "发布",
}: {
  articleId: string;
  articleTitle: string;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ButtonSecondary className={className} onClick={() => setOpen(true)}>
        {label}
      </ButtonSecondary>
      {open ? (
        <PublishModal
          articleId={articleId}
          articleTitle={articleTitle}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
