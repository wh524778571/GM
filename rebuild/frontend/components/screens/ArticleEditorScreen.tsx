"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ButtonSecondary } from "@/components/ButtonSecondary";
import { MaterialPicker } from "@/components/MaterialPicker";
import { PublishButton } from "@/components/PublishModal";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/clientApi";
import { copyPlainText } from "@/lib/clipboard";
import { setCurrentArticleId, useCurrentArticleId } from "@/lib/currentArticle";
import {
  ImgMap,
  PH_RE,
  figureHtml,
  slotHtml,
  renderArticleMarkdown,
} from "@/lib/articleMarkdown";
import {
  serialize,
  looksLikeHtml,
  htmlToMarkerText,
  buildPlan,
  alignText,
} from "@/lib/editorUtils";
import {
  persistLocal,
  loadLocal,
} from "@/lib/editorDraft";

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
  { key: "toutiao", label: "头条", images: true },
  { key: "baijia", label: "百家", images: true },
  { key: "bilibili", label: "B站", images: true },
  { key: "xhs", label: "小红书", images: false },
] as const;
type PlatformKey = (typeof PLATFORMS)[number]["key"];

export function ArticleEditorScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const initialId = params.get("articleId");
  const storedId = useCurrentArticleId();
  const articleId = initialId ?? storedId ?? null;

  const [active, setActive] = useState<PlatformKey>("toutiao");
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(Boolean(articleId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [stat, setStat] = useState({ imgs: 0, slots: 0, chars: 0 });
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const texts = useRef<Record<string, string>>({});
  const imgMap = useRef<ImgMap>({});
  const editorRef = useRef<HTMLDivElement>(null);
  /** 实际文章 id：新建草稿创建成功后才会被填入；加载已有文章时等于 articleId */
  const effectiveId = useRef<string | null>(initialId ?? storedId ?? null);
  /** 文章母标题（用于发布弹窗头部），加载后设置 */
  const articleTitle = useRef<string>("");
  /** 触发重渲染的发布就绪 id（ref 不驱动 UI） */
  const [publishId, setPublishId] = useState<string | null>(initialId ?? storedId ?? null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  /** 正在等待选图的目标：占位卡片 / 要换的图 / 光标插入 */
  const pending = useRef<{ mode: "slot" | "change" | "cursor"; el?: HTMLElement }>({
    mode: "cursor",
  });
  /** 编辑区里最后一次光标所在的块（用于「在光标处插图」精确落位） */
  const lastCaret = useRef<HTMLElement | null>(null);

  const setOkMsg = (m: string) => {
    setOk(m);
    setError(null);
  };
  const setErr = (m: string) => {
    setError(m);
    setOk(null);
  };

  /** 记录当前光标所在块，供「在光标处插图」精确插入（而非堆到末尾） */
  const recordCaret = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    let node = sel.anchorNode as HTMLElement | null;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const block = (node as HTMLElement | null)?.closest(
      "p,h3,h4,figure,div[data-ph]",
    ) as HTMLElement | null;
    if (block && el.contains(block)) lastCaret.current = block;
  }, []);

  const refreshStat = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    setStat({
      imgs: el.querySelectorAll("figure[data-img]").length,
      slots: el.querySelectorAll("[data-ph]").length,
      chars: el.innerText.replace(/\s/g, "").length,
    });
  }, []);

  /** 捕获当前编辑区 -> texts / imgMap */
  const captureCurrent = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const { text, bound, slots } = serialize(el);
    texts.current[active] = text;
    // 本平台出现过的占位：先清旧绑定，再写回当前绑定（支持"移除图片"）
    slots.forEach((k) => delete imgMap.current[k]);
    Object.assign(imgMap.current, bound);
    dirty.current = true;
  }, [active]);

  const loadPlatform = useCallback(
    (key: PlatformKey) => {
      const el = editorRef.current;
      if (!el) return;
      el.innerHTML = renderArticleMarkdown(texts.current[key] ?? "", imgMap.current, { showSlots: true });
      refreshStat();
    },
    [refreshStat],
  );

  // 加载文章：数据写进 ref，由下方 layoutEffect 负责真正渲染到 DOM
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
        const map: ImgMap = {};
        for (const [k, v] of Object.entries(a.image_sources ?? {})) {
          if (typeof v === "string" && v) map[k] = v;
        }
        const contents = a.contents ?? {};
        const built: Record<string, string> = {};
        for (const p of PLATFORMS) {
          const raw = String(contents[p.key] || a.content_text || "");
          if (looksLikeHtml(raw)) {
            const { text, bound } = htmlToMarkerText(raw);
            built[p.key] = text;
            Object.assign(map, bound);
          } else {
            built[p.key] = raw;
          }
        }
        // 四平台共享同一份配图计划：补齐缺失平台、去重、把堆一起的打散。
        // 纯文字无图平台（小红书）不参与对齐，否则会被强制注入配图占位符；
        // 计划也只从可配图平台提取，避免残留标记污染全局计划。
        const imageKeys = new Set<string>(PLATFORMS.filter((p) => p.images).map((p) => p.key));
        const plan = buildPlan(
          Object.fromEntries(Object.entries(built).filter(([k]) => imageKeys.has(k))),
          map,
        );
        for (const p of PLATFORMS) {
          if (p.images) {
            built[p.key] = alignText(built[p.key], plan);
          } else {
            // 纯文字无图平台：兜底剥掉任何残留配图占位符（后端已剔除，这里双保险）
            built[p.key] = built[p.key]
              .replace(new RegExp(PH_RE.source, "g"), "")
              .replace(/\n{3,}/g, "\n\n")
              .trim();
          }
        }
        texts.current = built;
        imgMap.current = map;
        const baseTitles = a.titles ?? { toutiao: a.title };
        setTitles(baseTitles);
        articleTitle.current = a.title;
        setPublishId(articleId);
        setActive("toutiao");

        // 用本地缓存回灌：刷新 / 崩溃后恢复「最后一次编辑」，比后端更靠前
        const local = articleId ? loadLocal(articleId) : null;
        if (local) {
          for (const p of PLATFORMS) {
            if (local.texts?.[p.key]) built[p.key] = local.texts[p.key];
          }
          Object.assign(map, local.imgMap ?? {});
          if (local.titles && Object.keys(local.titles).length) {
            setTitles({ ...baseTitles, ...local.titles });
          }
        }
      })
      .catch((e) => alive && setErr((e as ApiError).message || "加载失败"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId]);

  // 刷新 / 切走 / 关页前，把最新编辑同步进本地缓存，避免「一刷就没」
  useEffect(() => {
    const flushLocal = () => {
      captureCurrent();
      const id = effectiveId.current;
      if (id) persistLocal(id, texts.current, imgMap.current, titles);
    };
    const onUnload = () => flushLocal();
    const onVis = () => {
      if (document.visibilityState === "hidden") flushLocal();
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("visibilitychange", onVis);
    };
    // titles 变化即重绑，保证兜底写的是最新标题
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titles]);

  // 非 loading 且 active 平台就绪时，把对应正文真正渲染进编辑区
  useLayoutEffect(() => {
    if (loading) return;
    loadPlatform(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, active]);

  // contenteditable=false 的占位卡片 / 图片工具栏，用原生事件委托更稳
  // 注意：必须在编辑器区域渲染后再绑定
  useLayoutEffect(() => {
    if (loading) return;
    const el = editorRef.current;
    if (!el) return;
    const onNativeClick = (e: MouseEvent) => handleEditorAction(e.target as HTMLElement);
    el.addEventListener("click", onNativeClick);
    return () => el.removeEventListener("click", onNativeClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  function switchPlatform(key: PlatformKey) {
    if (key === active) return;
    captureCurrent();
    lastCaret.current = null;
    setActive(key);
    requestAnimationFrame(() => loadPlatform(key));
  }

  function scheduleSave() {
    dirty.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushSave(), 900);
  }

  async function flushSave() {
    captureCurrent();
    const id = effectiveId.current;
    try {
      if (!id) {
        // 空白新建：先创建一篇草稿，再切到编辑态（后续保存走 PATCH）
        const created = await apiPost<ArticleOut>("/articles", {
          article_id: `manual-${Date.now()}`,
          title: titles.toutiao?.trim() || "未命名文章",
          titles,
          contents: { ...texts.current },
          image_sources: { ...imgMap.current },
          status: "draft",
        });
        effectiveId.current = created.article_id;
        setPublishId(created.article_id);
        setCurrentArticleId(created.article_id);
        window.history.replaceState(null, "", `/writer?articleId=${created.article_id}`);
        persistLocal(created.article_id, texts.current, imgMap.current, titles);
        setOkMsg("已创建草稿");
      } else {
        await apiPatch<ArticleOut>(`/articles/${id}`, {
          title: titles.toutiao?.trim() || "未命名文章",
          titles,
          contents: { ...texts.current },
          image_sources: { ...imgMap.current },
          status: "draft",
        });
        dirty.current = false;
        persistLocal(id, texts.current, imgMap.current, titles);
        setOkMsg("已保存");
      }
    } catch (e) {
      setErr((e as ApiError).message || "保存失败");
    }
  }

  function onEdit() {
    captureCurrent();
    refreshStat();
    const id = effectiveId.current;
    if (id) persistLocal(id, texts.current, imgMap.current, titles);
    scheduleSave();
  }

  /** 处理占位卡片 / 图片工具栏的交互 */
  function handleEditorAction(target: HTMLElement) {
    const actBtn = target.closest<HTMLElement>("[data-act]");
    if (actBtn) {
      const fig = actBtn.closest<HTMLElement>("figure[data-img]");
      if (fig) {
        if (actBtn.dataset.act === "remove") {
          const n = fig.dataset.img ?? "1";
          const desc = fig.dataset.desc ?? "";
          fig.outerHTML = slotHtml(n, desc);
          onEdit();
          setOkMsg("已移除该图，占位还在原处");
        } else {
          pending.current = { mode: "change", el: fig };
          setPickerQuery((fig.dataset.desc ?? "").split("_")[0] ?? "");
          setPickerOpen(true);
        }
        return;
      }
      // ph-slot 内的「📎 从素材库选图」按钮
      const slot = actBtn.closest<HTMLElement>("[data-ph]");
      if (slot && actBtn.dataset.act === "pick") {
        pending.current = { mode: "slot", el: slot };
        setPickerQuery((slot.dataset.desc ?? "").split("_")[0] ?? "");
        setPickerOpen(true);
      }
      return;
    }
  }

  function onEditorClick(e: React.MouseEvent<HTMLDivElement>) {
    handleEditorAction(e.target as HTMLElement);
  }

  /** contentEditable 内部的 contenteditable=false 子元素，mousedown 更稳 */
  function onEditorMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement;
    if (t.closest("figure[data-img]")) {
      e.preventDefault();
      handleEditorAction(t);
      return;
    }
    // ph-slot：只拦按钮点击（让其触发选图），文字区域允许选中复制
    if (t.closest("[data-ph] [data-act]")) {
      e.preventDefault();
      handleEditorAction(t);
    }
  }

  /** 工具条「插入图片」：在光标处新增一个图块 */
  function insertAtCursor() {
    pending.current = { mode: "cursor" };
    setPickerQuery("");
    setPickerOpen(true);
  }

  function nextIndex(): number {
    const el = editorRef.current;
    if (!el) return 1;
    const nums: number[] = [];
    el.querySelectorAll<HTMLElement>("figure[data-img],[data-ph]").forEach((n) => {
      const v = parseInt(n.dataset.img ?? n.dataset.ph ?? "", 10);
      if (!Number.isNaN(v)) nums.push(v);
    });
    return (nums.length ? Math.max(...nums) : 0) + 1;
  }

  function handlePick(m: { id: number; path: string | null; stem: string; url: string | null }) {
    const el = editorRef.current;
    if (!el) return;
    // 用相对 path 拼可解析的图片地址：_素材库/作品/xxx.jpeg → /images/... → /api/images/...
    // （与后端 bind_image 端点一致；裸 stem 缺前缀和扩展名会 404，是之前不出图的根因）
    const stem = m.path
      ? m.path
      : m.url
        ? m.url
        : m.stem.startsWith("/")
          ? m.stem
          : `/images/${m.stem}`;
    const { mode, el: targetEl } = pending.current;

    if (mode === "cursor" || !targetEl) {
      const n = nextIndex();
      const html = figureHtml(String(n), m.stem, stem);
      const anchor = lastCaret.current;
      if (anchor && el.contains(anchor)) {
        // 插到光标所在块之后，原地定位，不堆末尾
        anchor.insertAdjacentHTML("afterend", html);
      } else {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
          const node = sel.anchorNode as HTMLElement;
          const block = (
            node.nodeType === Node.TEXT_NODE ? node.parentElement : node
          )?.closest("p,h3,h4,figure,div[data-ph]") as HTMLElement | null;
          if (block) block.insertAdjacentHTML("afterend", html);
          else el.insertAdjacentHTML("beforeend", html);
        } else {
          el.insertAdjacentHTML("beforeend", html);
        }
      }
    } else {
      const n = targetEl.dataset.img ?? targetEl.dataset.ph ?? String(nextIndex());
      const desc = targetEl.dataset.desc || m.stem;
      targetEl.outerHTML = figureHtml(n, desc, stem);
    }

    setPickerOpen(false);
    pending.current = { mode: "cursor" };
    onEdit();
    setOkMsg("已插入到该位置");
  }

  /* -------------------- 复制：图片转 base64 内联 -------------------- */

  async function toDataUrl(src: string): Promise<string | null> {
    try {
      const blob = await (await fetch(src)).blob();
      return await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  async function copyPlatform(key: PlatformKey) {
    if (key === active) captureCurrent();
    const text = texts.current[key] ?? "";
    const box = document.createElement("div");
    box.innerHTML = renderArticleMarkdown(text, imgMap.current, { showSlots: true });

    // 去掉界面元素 + 未配图的占位卡片
    box.querySelectorAll("[data-ui]").forEach((n) => n.remove());
    // 去掉配图卡片底部的「配图N · 描述」说明，避免粘到平台后泄漏内部标记
    box.querySelectorAll("figcaption").forEach((n) => n.remove());
    const emptySlots = box.querySelectorAll("[data-ph]");
    emptySlots.forEach((n) => n.remove());

    // 图片内联成 base64，粘到平台编辑器才能直出
    const imgs = Array.from(box.querySelectorAll("img"));
    setBusyAction("复制");
    setBusy(true);
    await Promise.all(
      imgs.map(async (img) => {
        const d = await toDataUrl(img.getAttribute("src") ?? "");
        if (d) img.setAttribute("src", d);
        img.removeAttribute("class");
      }),
    );
    setBusy(false);
    setBusyAction(null);

    box.querySelectorAll("figure").forEach((f) => f.removeAttribute("class"));
    const html = box.innerHTML;
    // 纯文本保留【配图N：描述】标记，粘贴到平台后知道在哪配什么图
    const plain = text;
    const label = PLATFORMS.find((p) => p.key === key)!.label;
    const skipped = emptySlots.length;

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      setOkMsg(
        `已复制「${label}」图文（${imgs.length} 张图已内联）` +
          (skipped ? ` · 跳过 ${skipped} 处未配图占位` : "") +
          "，去平台编辑器直接粘贴",
      );
    } catch {
      await copyPlainText(plain);
      setOkMsg(`已复制「${label}」文字（浏览器不支持图文复制）`);
    }
  }

  /* -------------------- 去 AI 味 / 标题 -------------------- */

  async function humanize() {
    if (!effectiveId.current) return;
    captureCurrent();
    setBusyAction("去AI味");
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ polished: string }>(`/articles/${effectiveId.current}/polish`, {
        text: texts.current[active] ?? "",
        persist: false,
      });
      texts.current[active] = res.polished;
      loadPlatform(active);
      onEdit();
      setOkMsg("已去 AI 味（配图位置保留）");
    } catch (e) {
      setErr((e as ApiError).message || "去AI味失败");
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  }

  async function regenerateTitles() {
    if (!effectiveId.current) return;
    setBusyAction("标题");
    setBusy(true);
    setError(null);
    try {
      const a = await apiPost<ArticleOut>(`/articles/${effectiveId.current}/titles`);
      setTitles(a.titles ?? titles);
      setOkMsg("已重生成四平台特色标题");
      scheduleSave();
    } catch (e) {
      setErr((e as ApiError).message || "重生成标题失败");
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  }

  const activeLabel = PLATFORMS.find((p) => p.key === active)?.label ?? "";

  return (
    <AppShell
      title="文章编辑"
      subtitle={
        effectiveId.current
          ? "点正文里的配图占位就能选图插进去 · 一键复制整篇图文去平台粘贴"
          : "空白新建：直接写正文、点占位配图，首次保存会自动建成草稿"
      }
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
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-card border border-subtle bg-card px-4 py-3">
        {publishId ? (
          <PublishButton
            articleId={publishId}
            articleTitle={articleTitle.current}
            label="发布"
            className="h-9"
          />
        ) : (
          <ButtonSecondary className="h-9" disabled title="先保存文章再发布">
            先保存
          </ButtonSecondary>
        )}
        <ButtonSecondary
          className="h-9"
          onClick={insertAtCursor}
          disabled={active === "xhs"}
          title={active === "xhs" ? "小红书为纯文字无图平台，不支持插图" : undefined}
        >
          在光标处插图
        </ButtonSecondary>
        <ButtonSecondary className="h-9" onClick={() => void humanize()} disabled={busy}>
          {busyAction === "去AI味" ? "去AI味中…" : "去AI味"}
        </ButtonSecondary>
        <ButtonSecondary className="h-9" onClick={() => void regenerateTitles()} disabled={busy}>
          {busyAction === "标题" ? "生成中…" : "重生成平台标题"}
        </ButtonSecondary>
        <span className="ml-auto flex items-center gap-2 text-xs text-tertiary">
          {busy && busyAction === "去AI味" ? (
            <span className="text-accent">正在润色，约需 10 秒，别关页面…</span>
          ) : null}
          {stat.chars} 字 · {stat.imgs} 张图
          {stat.slots ? ` · ${stat.slots} 处待配图` : " · 配图已齐"}
        </span>
      </div>

      <div className="mt-4 rounded-card border border-subtle bg-card p-4">
        <label className="mb-1.5 block text-[13px] text-secondary">{activeLabel}标题</label>
        <input
          value={titles[active] ?? ""}
          onChange={(e) => {
            setTitles((prev) => ({ ...prev, [active]: e.target.value }));
            scheduleSave();
          }}
          placeholder="该平台特色标题"
          className="mb-3 h-9 w-full rounded-btn border border-subtle bg-raised px-3 text-[14px] font-medium text-primary focus:border-accent focus:outline-none"
        />
        {loading ? (
          <div className="min-h-[460px] rounded-btn border border-subtle bg-raised px-4 py-3 text-[13px] text-tertiary">
            加载中…
          </div>
        ) : (
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={onEdit}
            onBlur={captureCurrent}
            onClick={onEditorClick}
            onMouseDown={onEditorMouseDown}
            onKeyUp={recordCaret}
            onMouseUp={recordCaret}
            className="article-body min-h-[460px] w-full overflow-auto rounded-btn border border-subtle bg-raised px-5 py-4 text-[15px] leading-8 text-primary break-words focus:border-accent focus:outline-none"
          />
        )}
        <p className="mt-3 text-xs text-tertiary">
          正文里虚线框就是 AI 排好位置的配图位，点一下选图即可原地填入；图片下方可「换图 / 移除」。
          复制时图片会内联进剪贴板，粘到头条 / 百家 / 公众号编辑器图文直出。
        </p>
      </div>

      <MaterialPicker
        open={pickerOpen}
        initialQuery={pickerQuery}
        onClose={() => setPickerOpen(false)}
        onPick={handlePick}
      />
    </AppShell>
  );
}
