"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { MaterialPicker } from "@/components/MaterialPicker";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/clientApi";
import { toImageProxyUrl } from "@/lib/media";

interface ArticleOut {
  article_id: string;
  title: string;
  status: string;
  content_text?: string | null;
  contents?: Record<string, string> | null;
  image_sources?: Record<string, unknown> | null;
}

const PLACEHOLDER_RE = /【配图(\d+)[:：](.*?)】/g;

/** 把 image_sources 的存储值（可能是裸 path 或 /images/...）归一成可直连的代理 url。 */
function toProxy(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const url = raw.startsWith("/") || /^https?:/i.test(raw) ? raw : `/images/${raw}`;
  return toImageProxyUrl(url);
}

/** 解析 image_sources 成 { 占位符: 原始存储值 }。 */
function parseImgMap(src?: Record<string, unknown> | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [ph, val] of Object.entries(src ?? {})) {
    if (typeof val === "string" && val) out[ph] = val;
  }
  return out;
}

/** 取正文里下一个配图序号。 */
function nextImageIndex(body: string): number {
  const used = body.match(/【配图\d+[:：]/g) ?? [];
  return used.length + 1;
}

/** 把正文里的【配图N：描述】渲染成真图，并附带「复制图片」按钮。 */
function renderPreview(
  text: string,
  imgMap: Record<string, string>,
  onCopyImage: (ph: string) => void,
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
    const raw = imgMap[placeholder];
    const url = raw ? toProxy(raw) : null;
    if (url) {
      nodes.push(
        <figure key={key++} className="my-2 overflow-hidden rounded-row border border-subtle">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={description} className="max-h-80 w-full object-cover" />
          <figcaption className="flex items-center justify-between bg-raised px-3 py-1.5 text-xs text-tertiary">
            <span>配图{index}：{description}</span>
            <button
              type="button"
              onClick={() => onCopyImage(placeholder)}
              className="ml-2 shrink-0 text-accent hover:underline"
            >
              复制图片
            </button>
          </figcaption>
        </figure>,
      );
    } else {
      nodes.push(
        <p
          key={key++}
          className="rounded-row border border-dashed border-subtle bg-raised px-3 py-2 text-[13px] text-tertiary"
        >
          配图{index}：{description}（未绑定素材，可在左侧「插入图片」补上）
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
  if (nodes.length === 0) {
    nodes.push(
      <p key="empty" className="text-[13px] text-tertiary">
        正文为空。从「今日选题」选好题目可一键生成并进入这里；或直接在左侧输入、用「插入图片」加配图。
      </p>,
    );
  }
  return nodes;
}

export function ArticleEditorScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const initialId = params.get("articleId");

  const [articleId, setArticleId] = useState<string | null>(initialId);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imgMap, setImgMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialId));
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 挂载时若带 articleId，拉取文章正文与配图
  useEffect(() => {
    if (!initialId) return;
    let alive = true;
    setLoading(true);
    apiGet<ArticleOut>(`/articles/${initialId}`)
      .then((a) => {
        if (!alive) return;
        setTitle(a.title);
        setBody(a.content_text ?? a.contents?.toutiao ?? a.contents?.xhs ?? "");
        setImgMap(parseImgMap(a.image_sources));
        setArticleId(a.article_id);
      })
      .catch((e) => alive && setError((e as ApiError).message || "加载失败"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // 仅首次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setOkMsg(msg: string) {
    setOk(msg);
    setError(null);
  }
  function setErr(msg: string) {
    setError(msg);
    setOk(null);
  }

  async function save() {
    setBusy(true);
    setErr("");
    const finalTitle = title.trim() || "未命名文章";
    const payload = {
      title: finalTitle,
      content_text: body,
      image_sources: imgMap,
      status: "draft",
    };
    try {
      if (articleId) {
        await apiPatch<ArticleOut>(`/articles/${articleId}`, payload);
      } else {
        const id = `edit-${Date.now()}`;
        const a = await apiPost<ArticleOut>("/articles", { article_id: id, ...payload });
        setArticleId(a.article_id);
        router.replace(`/writer?articleId=${a.article_id}`);
      }
      setOkMsg("已保存");
    } catch (e) {
      setErr((e as ApiError).message || "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(body);
      setOkMsg("已复制全文，去平台直接粘贴即可");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = body;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setOkMsg("已复制全文（兼容模式）");
      } catch {
        setErr("复制失败，请手动选择正文复制");
      }
      document.body.removeChild(ta);
    }
  }

  async function copyImage(ph: string) {
    const raw = imgMap[ph];
    if (!raw) return;
    const url = toProxy(raw);
    if (!url) return;
    try {
      const blob = await (await fetch(url)).blob();
      const Ctor = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (!navigator.clipboard || typeof Ctor === "undefined") throw new Error("unsupported");
      await navigator.clipboard.write([new Ctor({ [blob.type || "image/png"]: blob })]);
      setOkMsg(`已复制${ph.match(/\d+/)?.[0] ?? ""}号配图，可在平台编辑器直接粘贴`);
    } catch {
      const a = document.createElement("a");
      a.href = url;
      a.download = `${ph}.png`;
      a.click();
      setOkMsg("浏览器不支持直接复制图片，已改为下载，请手动添加到平台");
    }
  }

  function insertImage() {
    setPickerOpen(true);
  }

  function handlePick(m: { id: number; stem: string; url: string | null }) {
    const n = nextImageIndex(body);
    const placeholder = `【配图${n}：${m.stem}】`;
    // 从素材 url 还原存储路径（去掉 /images/ 前缀，与后端 image_sources 约定一致）
    let raw = "";
    if (m.url) raw = m.url.startsWith("/images/") ? m.url.slice("/images/".length) : m.url;
    const ta = textareaRef.current;
    const start = ta ? ta.selectionStart : body.length;
    const end = ta ? ta.selectionEnd : body.length;
    const sep = start > 0 && !/\s/.test(body[start - 1]) ? "\n" : "";
    const insertText = `${sep}${placeholder}\n`;
    const newBody = body.slice(0, start) + insertText + body.slice(end);
    setBody(newBody);
    if (raw) setImgMap((prev) => ({ ...prev, [placeholder]: raw }));
    setOkMsg(`已插入配图${n}：${m.stem}`);
    setPickerOpen(false);
    // 让光标落在插入内容之后
    requestAnimationFrame(() => {
      if (ta) {
        const pos = start + insertText.length;
        ta.focus();
        ta.setSelectionRange(pos, pos);
      }
    });
  }

  return (
    <AppShell
      title="文章编辑"
      subtitle="今日选题选好题 → 一键生成进入这里 · 编辑、插图、复制走，平台自己粘"
      actionLabel="去今日选题"
      onAction={() => router.push("/topics")}
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

      <div className="flex flex-wrap items-center gap-2 rounded-card border border-subtle bg-card px-4 py-3">
        <Button className="h-9" onClick={save} disabled={busy}>
          {busy ? "保存中…" : "保存"}
        </Button>
        <ButtonSecondary className="h-9" onClick={copyText}>
          复制全文
        </ButtonSecondary>
        <ButtonSecondary className="h-9" onClick={insertImage}>
          插入图片
        </ButtonSecondary>
        <span className="ml-auto text-xs text-tertiary">
          {body.length} 字 · {Object.keys(imgMap).length} 张图已绑
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 左：编辑区 */}
        <div className="flex flex-col rounded-card border border-subtle bg-card p-4">
          <label className="mb-1.5 block text-[13px] text-secondary" htmlFor="editor-title">
            标题
          </label>
          <input
            id="editor-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="文章标题"
            className="mb-3 h-9 w-full rounded-btn border border-subtle bg-raised px-3 text-[14px] font-medium text-primary focus:border-accent focus:outline-none"
          />
          <label className="mb-1.5 block text-[13px] text-secondary" htmlFor="editor-body">
            正文（支持 Markdown；用「插入图片」加上【配图N：描述】占位符）
          </label>
          {loading ? (
            <div className="flex-1 rounded-btn border border-subtle bg-raised px-3 py-3 text-[13px] text-tertiary">
              加载中…
            </div>
          ) : (
            <textarea
              id="editor-body"
              ref={textareaRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="在这里写，或从「今日选题」生成后进来处理…"
              className="min-h-[460px] w-full flex-1 resize-y rounded-btn border border-subtle bg-raised px-3 py-2.5 text-[14px] leading-7 text-primary focus:border-accent focus:outline-none"
            />
          )}
        </div>

        {/* 右：实时预览 */}
        <div className="flex flex-col rounded-card border border-subtle bg-card p-4">
          <h2 className="mb-3 text-[15px] font-semibold text-primary">预览（含配图）</h2>
          <div className="flex flex-col gap-3 rounded-row border border-subtle bg-raised px-4 py-3">
            {title.trim() ? (
              <h3 className="text-base font-semibold text-primary">{title}</h3>
            ) : null}
            {renderPreview(body, imgMap, copyImage)}
          </div>
          <p className="mt-3 text-xs text-tertiary">
            「复制全文」复制纯文本（含【配图N】标记提醒配图位置）；每张配图下有「复制图片」可直接粘到平台。
          </p>
        </div>
      </div>

      <MaterialPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={handlePick}
      />
    </AppShell>
  );
}
