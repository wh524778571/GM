"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/Button";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { MaterialPicker } from "@/components/MaterialPicker";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/clientApi";
import { toImageProxyUrl } from "@/lib/media";
import { setCurrentArticleId, useCurrentArticleId } from "@/lib/currentArticle";

interface ArticleOut {
  article_id: string;
  title: string;
  status: string;
  content_text?: string | null;
  contents?: Record<string, string> | null;
  titles?: Record<string, string> | null;
  image_sources?: Record<string, string> | null;
}

const PLATFORMS = [
  { key: "toutiao", label: "头条" },
  { key: "baijia", label: "百家" },
  { key: "bilibili", label: "B站" },
  { key: "xhs", label: "小红书" },
] as const;
type PlatformKey = (typeof PLATFORMS)[number]["key"];

const PLACEHOLDER_RE = /【配图(\d+)[:：](.*?)】/g;

/** 把浏览器显示用的代理 url 还原成后端存储用的 /images/... 路径。 */
function toRawSrc(src: string): string {
  if (src.startsWith("/api/images/")) return src.slice("/api".length);
  return src;
}
/** 把后端存储的 /images/... 路径转成浏览器可加载的代理 url。 */
function safeProxy(src: string): string {
  return toImageProxyUrl(src) ?? src;
}

/** 把正文里的【配图N：描述】标记替换成内联 <img>（仅当 image_sources 里有对应素材）。 */
function markersToImages(html: string, imgMap: Record<string, string>): string {
  return html.replace(PLACEHOLDER_RE, (_m, idx, desc) => {
    const ph = `【配图${idx}：${desc.trim()}】`;
    const stem = imgMap[ph];
    if (!stem) return ph; // 没绑素材先保留标记
    const src = safeProxy(stem.startsWith("/") ? stem : `/images/${stem}`);
    return `<img src="${src}" data-index="${idx}" data-stem="${stem}" alt="${desc.trim()}" />`;
  });
}

/** 当前正文中下一个配图序号（标记 + 内联图片都算）。 */
function nextImageIndex(html: string): number {
  const markers = html.match(/【配图\d+[:：]/g) ?? [];
  const imgs = html.match(/data-index="(\d+)"/g) ?? [];
  const nums = [
    ...markers.map((m) => parseInt(m.replace(/\D/g, ""), 10)),
    ...imgs.map((m) => parseInt(m.replace(/\D/g, ""), 10)),
  ].filter((n) => !Number.isNaN(n));
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

/** 把富文本 DOM 转回「含【配图N】标记」的纯文本，供复制/存储。 */
function htmlToPlainWithMarkers(root: HTMLElement): string {
  let out = "";
  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
    } else if (node.nodeName === "IMG") {
      const el = node as HTMLImageElement;
      const idx = el.dataset.index ?? "?";
      const stem = (el.dataset.stem ?? "").split("/").pop() ?? "";
      out += `【配图${idx}：${stem}】`;
    } else if (node.nodeName === "BR") {
      out += "\n";
    } else if (node.nodeName === "DIV" || node.nodeName === "P") {
      out += htmlToPlainWithMarkers(node as HTMLElement) + "\n";
    } else {
      out += htmlToPlainWithMarkers(node as HTMLElement);
    }
  });
  return out;
}

export function ArticleEditorScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const initialId = params.get("articleId");
  const storedId = useCurrentArticleId();
  const articleId = initialId ?? storedId ?? null;

  const [active, setActive] = useState<PlatformKey>("toutiao");
  const [titles, setTitles] = useState<Record<string, string>>({});
  const htmls = useRef<Record<string, string>>({});
  const [loading, setLoading] = useState(Boolean(articleId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [imgCount, setImgCount] = useState(0);

  const editorRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  function setOkMsg(msg: string) {
    setOk(msg);
    setError(null);
  }
  function setErr(msg: string) {
    setError(msg);
    setOk(null);
  }

  /** 把当前编辑区内容捕获进 htmls（转回存储格式），并标记脏。 */
  const captureCurrent = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    let html = el.innerHTML;
    // 存储用 /images/... 原始路径
    html = html.replace(/src="\/api\/images\//g, 'src="/images/');
    htmls.current[active] = html;
    dirty.current = true;
  }, [active]);

  /** 把某平台内容载入编辑区（转成可显示的代理 url）。 */
  const loadPlatform = useCallback(
    (key: PlatformKey) => {
      const el = editorRef.current;
      if (!el) return;
      let html = htmls.current[key] ?? "";
      html = html.replace(/src="\/images\//g, 'src="/api/images/');
      el.innerHTML = html;
      setImgCount(el.querySelectorAll("img").length);
    },
    [],
  );

  // 加载文章（带 articleId 或无参回退全局 store）
  useEffect(() => {
    if (!articleId) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setCurrentArticleId(articleId);
    apiGet<ArticleOut>(`/articles/${articleId}`)
      .then((a) => {
        if (!alive) return;
        const imgMap: Record<string, string> = {};
        for (const [ph, val] of Object.entries(a.image_sources ?? {})) {
          if (typeof val === "string" && val) imgMap[ph] = val;
        }
        const contents = a.contents ?? {};
        const built: Record<string, string> = {};
        for (const p of PLATFORMS) {
          const raw = contents[p.key] ?? a.content_text ?? "";
          built[p.key] = markersToImages(raw, imgMap);
        }
        htmls.current = built;
        setTitles(a.titles ?? { toutiao: a.title });
        setActive("toutiao");
        requestAnimationFrame(() => loadPlatform("toutiao"));
      })
      .catch((e) => alive && setErr((e as ApiError).message || "加载失败"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // 仅在 articleId 变化时重载（切换平台不重拉）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId]);

  // 切换平台：先捕获当前，再载入目标
  function switchPlatform(key: PlatformKey) {
    if (key === active) return;
    captureCurrent();
    setActive(key);
    loadPlatform(key);
  }

  function scheduleSave() {
    dirty.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void flushSave();
    }, 900);
  }

  async function flushSave() {
    if (!articleId || !dirty.current) return;
    captureCurrent();
    const payload = {
      title: titles.toutiao?.trim() || "未命名文章",
      titles,
      contents: { ...htmls.current },
      status: "draft",
    };
    try {
      await apiPatch<ArticleOut>(`/articles/${articleId}`, payload);
      dirty.current = false;
      setOkMsg("已自动保存");
    } catch (e) {
      setErr((e as ApiError).message || "自动保存失败");
    }
  }

  function onTitleChange(key: PlatformKey, value: string) {
    setTitles((prev) => ({ ...prev, [key]: value }));
    scheduleSave();
  }

  function onEdit() {
    setImgCount(editorRef.current?.querySelectorAll("img").length ?? 0);
    scheduleSave();
  }

  function insertImage() {
    setPickerOpen(true);
  }

  function handlePick(m: { id: number; stem: string; url: string | null }) {
    const el = editorRef.current;
    if (!el) return;
    const n = nextImageIndex(el.innerHTML);
    const raw = m.stem.startsWith("/") ? m.stem : `/images/${m.stem}`;
    const src = m.url ?? safeProxy(raw);
    const img = document.createElement("img");
    img.src = src;
    img.setAttribute("data-index", String(n));
    img.setAttribute("data-stem", raw);
    img.alt = m.stem;
    img.className = "max-h-80 my-2 w-full cursor-pointer rounded object-cover";
    img.onclick = (e) => {
      e.stopPropagation();
      void copyImage(img);
    };

    const markerRe = new RegExp(`【配图${n}[:：][^】]*】`);
    const html = el.innerHTML;
    if (markerRe.test(html)) {
      // 自动替换同序号占位标记，省去手动删标记
      el.innerHTML = html.replace(markerRe, img.outerHTML);
    } else {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(img);
        range.setStartAfter(img);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        el.appendChild(img);
      }
    }
    setPickerOpen(false);
    setImgCount(el.querySelectorAll("img").length);
    onEdit();
  }

  async function copyPlatform(key: PlatformKey) {
    const el = editorRef.current;
    if (!el || key !== active) {
      // 复制非当前平台时，临时载入该平台内容
      const tmp = document.createElement("div");
      tmp.innerHTML = (htmls.current[key] ?? "").replace(/src="\/images\//g, 'src="/api/images/');
      await copyFromElement(tmp, PLATFORMS.find((p) => p.key === key)!.label);
      return;
    }
    await copyFromElement(el, PLATFORMS.find((p) => p.key === key)!.label);
  }

  async function copyFromElement(el: HTMLElement, label: string) {
    const html = el.innerHTML.replace(/src="\/images\//g, 'src="/api/images/');
    const plain = htmlToPlainWithMarkers(el);
    try {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      setOkMsg(`已复制「${label}」图文，去平台直接粘贴（能粘图的编辑器图片直出）`);
    } catch {
      await navigator.clipboard.writeText(plain);
      setOkMsg(`已复制「${label}」文本（图片请单张复制后再粘）`);
    }
  }

  /** 单张图片复制（二进制，粘贴到多数平台编辑器直出）。 */
  async function copyImage(img: HTMLImageElement) {
    const url = img.getAttribute("src");
    if (!url) return;
    try {
      const blob = await (await fetch(url)).blob();
      const Ctor = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (!navigator.clipboard || typeof Ctor === "undefined") throw new Error("unsupported");
      await navigator.clipboard.write([new Ctor({ [blob.type || "image/png"]: blob })]);
      setOkMsg(`已复制图片，可在平台编辑器直接粘贴`);
    } catch {
      const a = document.createElement("a");
      a.href = url;
      a.download = `${img.dataset.stem?.split("/").pop() ?? "image"}.png`;
      a.click();
      setOkMsg("浏览器不支持直接复制图片，已改为下载");
    }
  }

  /** 去 AI 味：润色当前平台文本，保留已插入图片位置。 */
  async function humanize() {
    const el = editorRef.current;
    if (!el || !articleId) return;
    setBusy(true);
    setErr("");
    try {
      // 用 [IMG{i}] 占位保留图片顺序，避免被润色改掉
      const clone = el.cloneNode(true) as HTMLElement;
      const imgs = Array.from(clone.querySelectorAll("img"));
      imgs.forEach((img, i) => {
        img.replaceWith(document.createTextNode(`[IMG${i}]`));
      });
      const text = clone.innerText;
      const res = await apiPost<{ polished: string }>(`/articles/${articleId}/polish`, {
        text,
        persist: false,
      });
      let polished = res.polished;
      imgs.forEach((img, i) => {
        polished = polished.replace(`[IMG${i}]`, img.outerHTML);
      });
      el.innerHTML = polished.replace(/src="\/images\//g, 'src="/api/images/');
      setImgCount(el.querySelectorAll("img").length);
      onEdit();
      setOkMsg("已去 AI 味（图片位置保留）");
    } catch (e) {
      setErr((e as ApiError).message || "去AI味失败");
    } finally {
      setBusy(false);
    }
  }

  /** 一键重生成四平台特色标题。 */
  async function regenerateTitles() {
    if (!articleId) return;
    setBusy(true);
    setErr("");
    try {
      const a = await apiPost<ArticleOut>(`/articles/${articleId}/titles`);
      setTitles(a.titles ?? titles);
      setOkMsg("已重生成四平台特色标题");
      scheduleSave();
    } catch (e) {
      setErr((e as ApiError).message || "重生成标题失败");
    } finally {
      setBusy(false);
    }
  }

  if (!articleId) {
    return (
      <AppShell
        title="文章编辑"
        subtitle="从「今日选题」生成，或在文章管理里点开一篇，就能在这里编辑"
        actionLabel="去今日选题"
        onAction={() => router.push("/topics")}
      >
        <div className="rounded-card border border-subtle bg-card p-8 text-center text-sm text-tertiary">
          还没有打开的文章。去「今日选题」点「生成并编辑」，或在「文章管理」里点开一篇。
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="文章编辑"
      subtitle="四平台分栏 · 图片内联 · 一键复制当前平台图文去平台粘贴发布"
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

      {/* 平台分栏标签 */}
      <div className="mb-3 flex flex-wrap gap-2">
        {PLATFORMS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => switchPlatform(p.key)}
            className={
              "h-9 rounded-btn px-4 text-[13px] font-medium transition " +
              (active === p.key
                ? "bg-accent text-white"
                : "border border-subtle bg-card text-secondary hover:border-accent")
            }
          >
            {p.label}
            {titles[p.key] ? "" : " · 未命名"}
          </button>
        ))}
      </div>

      {/* 工具条 */}
      <div className="flex flex-wrap items-center gap-2 rounded-card border border-subtle bg-card px-4 py-3">
        <Button className="h-9" onClick={() => void flushSave()} disabled={busy}>
          {busy ? "处理中…" : "保存"}
        </Button>
        <ButtonSecondary className="h-9" onClick={() => void copyPlatform(active)}>
          复制「{PLATFORMS.find((p) => p.key === active)?.label}」图文
        </ButtonSecondary>
        <ButtonSecondary className="h-9" onClick={insertImage}>
          插入图片
        </ButtonSecondary>
        <ButtonSecondary className="h-9" onClick={() => void humanize()} disabled={busy}>
          去AI味
        </ButtonSecondary>
        <ButtonSecondary className="h-9" onClick={() => void regenerateTitles()} disabled={busy}>
          重生成平台标题
        </ButtonSecondary>
        <span className="ml-auto text-xs text-tertiary">
          {imgCount} 张图 · 自动保存开启
        </span>
      </div>

      {/* 当前平台：标题 + 富文本（编辑复制合一） */}
      <div className="mt-4 rounded-card border border-subtle bg-card p-4">
        <label className="mb-1.5 block text-[13px] text-secondary">
          {PLATFORMS.find((p) => p.key === active)?.label}标题
        </label>
        <input
          value={titles[active] ?? ""}
          onChange={(e) => onTitleChange(active, e.target.value)}
          placeholder="该平台特色标题"
          className="mb-3 h-9 w-full rounded-btn border border-subtle bg-raised px-3 text-[14px] font-medium text-primary focus:border-accent focus:outline-none"
        />
        {loading ? (
          <div className="min-h-[460px] rounded-btn border border-subtle bg-raised px-3 py-3 text-[13px] text-tertiary">
            加载中…
          </div>
        ) : (
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={onEdit}
            onBlur={captureCurrent}
            className="min-h-[460px] w-full overflow-auto rounded-btn border border-subtle bg-raised px-3 py-2.5 text-[14px] leading-7 text-primary focus:border-accent focus:outline-none"
            style={{ wordBreak: "break-word" }}
          />
        )}
        <p className="mt-3 text-xs text-tertiary">
          直接在这里编辑，点「插入图片」把配图放到光标处；「复制图文」按当前平台导出（能粘图的编辑器图片直出）。
          点图片可选中后单独复制。
        </p>
      </div>

      <MaterialPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={handlePick}
      />
    </AppShell>
  );
}
