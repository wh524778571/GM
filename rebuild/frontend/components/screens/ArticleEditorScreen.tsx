"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

/** 【配图3：沧元图_破境瞬间】 */
const PH_RE = /【配图(\d+)\s*[:：]\s*([^】]*)】/g;

type ImgMap = Record<string, string>; // "【配图N：描述】" -> "/images/xxx.jpeg"

const phKey = (n: string | number, desc: string) => `【配图${n}：${desc.trim()}】`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 后端存储路径 -> 浏览器可加载的同源代理 url */
function proxy(stem: string): string {
  const raw = stem.startsWith("/") ? stem : `/images/${stem}`;
  return toImageProxyUrl(raw) ?? raw;
}

/* ------------------------------------------------------------------ *
 * 渲染：带【配图N】标记的纯文本  ->  编辑区 DOM
 * ------------------------------------------------------------------ */

const IMG_BOX =
  "my-3 overflow-hidden rounded-btn border border-subtle bg-raised";
const PH_BOX =
  "ph-slot my-3 flex cursor-pointer items-center gap-3 rounded-btn border border-dashed border-accent/50 bg-accent/5 px-4 py-3 text-[13px] text-secondary transition hover:border-accent hover:bg-accent/10";

function figureHtml(n: string, desc: string, stem: string): string {
  const d = escapeHtml(desc.trim());
  return (
    `<figure data-img="${n}" data-desc="${d}" data-stem="${escapeHtml(stem)}" contenteditable="false" class="${IMG_BOX}">` +
    `<img src="${escapeHtml(proxy(stem))}" alt="${d}" class="block max-h-[420px] w-full object-contain bg-black/20" />` +
    `<figcaption data-ui="1" class="flex items-center gap-2 border-t border-subtle px-3 py-1.5 text-xs text-tertiary">` +
    `<span>配图${n} · ${d}</span>` +
    `<button type="button" data-act="change" class="ml-auto rounded px-2 py-0.5 text-accent hover:bg-accent/10">换图</button>` +
    `<button type="button" data-act="remove" class="rounded px-2 py-0.5 text-tertiary hover:bg-white/5">移除</button>` +
    `</figcaption></figure>`
  );
}

function slotHtml(n: string, desc: string): string {
  const d = escapeHtml(desc.trim());
  return (
    `<div data-ph="${n}" data-desc="${d}" contenteditable="false" class="${PH_BOX}">` +
    `<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">${n}</span>` +
    `<span class="font-medium text-primary">${d || "待配图"}</span>` +
    `<span data-ui="1" class="ml-auto text-xs text-accent">点击从素材库选图 →</span>` +
    `</div>`
  );
}

/** 行内 markdown：**粗体** */
function inline(text: string): string {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

/** 把「带标记的纯文本」渲染成编辑区 HTML（段落 / 小标题 / 图片 / 占位卡片）。 */
function renderBody(text: string, imgMap: ImgMap): string {
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // 整行就是一个配图标记 -> 独立成块
    const only = line.match(/^【配图(\d+)\s*[:：]\s*([^】]*)】$/);
    if (only) {
      const [, n, desc] = only;
      const stem = imgMap[phKey(n, desc)];
      blocks.push(stem ? figureHtml(n, desc, stem) : slotHtml(n, desc));
      continue;
    }

    // 行内混有配图标记 -> 先出文字块，再出图块
    if (PH_RE.test(line)) {
      PH_RE.lastIndex = 0;
      let cursor = 0;
      let m: RegExpExecArray | null;
      while ((m = PH_RE.exec(line)) !== null) {
        const before = line.slice(cursor, m.index).trim();
        if (before) blocks.push(`<p>${inline(before)}</p>`);
        const stem = imgMap[phKey(m[1], m[2])];
        blocks.push(stem ? figureHtml(m[1], m[2], stem) : slotHtml(m[1], m[2]));
        cursor = m.index + m[0].length;
      }
      const tail = line.slice(cursor).trim();
      if (tail) blocks.push(`<p>${inline(tail)}</p>`);
      PH_RE.lastIndex = 0;
      continue;
    }

    if (line.startsWith("### ")) {
      blocks.push(`<h4>${inline(line.slice(4))}</h4>`);
    } else if (line.startsWith("## ")) {
      blocks.push(`<h3>${inline(line.slice(3))}</h3>`);
    } else if (line.startsWith("# ")) {
      blocks.push(`<h3>${inline(line.slice(2))}</h3>`);
    } else {
      blocks.push(`<p>${inline(line)}</p>`);
    }
  }

  if (!blocks.length) blocks.push("<p><br /></p>");
  return blocks.join("");
}

/* ------------------------------------------------------------------ *
 * 序列化：编辑区 DOM -> 带标记的纯文本 + 图片绑定
 * ------------------------------------------------------------------ */

interface Serialized {
  text: string;
  bound: ImgMap; // 本平台已配好的图
  slots: string[]; // 本平台出现过的所有占位 key（用于清理旧绑定）
}

function serialize(root: HTMLElement): Serialized {
  const bound: ImgMap = {};
  const slots: string[] = [];
  const out: string[] = [];

  const walk = (nodes: NodeListOf<ChildNode> | ChildNode[]) => {
    nodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = (node.textContent ?? "").trim();
        if (t) out.push(t);
        return;
      }
      if (!(node instanceof HTMLElement)) return;

      if (node.tagName === "FIGURE" && node.dataset.img) {
        const key = phKey(node.dataset.img, node.dataset.desc ?? "");
        slots.push(key);
        if (node.dataset.stem) bound[key] = node.dataset.stem;
        out.push(key);
        return;
      }
      if (node.dataset.ph) {
        const key = phKey(node.dataset.ph, node.dataset.desc ?? "");
        slots.push(key);
        out.push(key);
        return;
      }
      if (node.tagName === "H3") {
        const t = node.innerText.trim();
        if (t) out.push(`## ${t}`);
        return;
      }
      if (node.tagName === "H4") {
        const t = node.innerText.trim();
        if (t) out.push(`### ${t}`);
        return;
      }
      // 块级容器里若还嵌着图 / 占位，递归处理，否则直接取文字
      if (node.querySelector("figure[data-img],[data-ph]")) {
        walk(node.childNodes);
        return;
      }
      const t = node.innerText.trim();
      if (t) out.push(t);
    });
  };

  walk(root.childNodes);
  return { text: out.join("\n\n"), bound, slots };
}

/** 旧数据兼容：早期存过 HTML，这里降级回「标记文本 + 绑定」。 */
function htmlToMarkerText(html: string): { text: string; bound: ImgMap } {
  const box = document.createElement("div");
  box.innerHTML = html;
  const bound: ImgMap = {};
  box.querySelectorAll("img").forEach((img) => {
    const n = img.getAttribute("data-index") ?? "";
    const stem = img.getAttribute("data-stem") ?? "";
    const desc = img.getAttribute("alt") ?? "";
    const key = phKey(n || "1", desc);
    if (stem) bound[key] = stem;
    img.replaceWith(document.createTextNode(`\n${key}\n`));
  });
  box.querySelectorAll("div,p,br,h1,h2,h3,h4").forEach((el) => {
    el.append(document.createTextNode("\n"));
  });
  return { text: (box.innerText || box.textContent || "").trim(), bound };
}

const looksLikeHtml = (s: string) => /<(img|div|p|figure|br)\b/i.test(s);

/** 从各平台正文 + 已绑定图里提取全局配图计划：编号 -> 描述（按编号去重） */
function buildPlan(
  contents: Record<string, string>,
  imgMap: ImgMap,
): Record<number, string> {
  const plan: Record<number, string> = {};
  const phLocal = new RegExp(PH_RE.source, "g");
  const ingest = (text: string) => {
    phLocal.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = phLocal.exec(text)) !== null) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && !(n in plan)) plan[n] = m[2].trim();
    }
  };
  for (const raw of Object.values(contents)) ingest(String(raw || ""));
  for (const k of Object.keys(imgMap)) {
    const m = k.match(/^【配图(\d+)\s*[:：]\s*([^】]*)】$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && !(n in plan)) plan[n] = m[2].trim();
    }
  }
  return plan;
}

const hasMark = (p: string) => /【配图\d+\s*[:：]/.test(p);

/**
 * 把一篇平台正文对齐成「四平台一致、分散不重复」的配图版：
 *  - 同编号只保留首个（去掉堆一起的重复）；
 *  - 若某平台缺失配图、或现存配图连续堆一起（相邻间隔<2段），则删除全部标记后按段落均匀重排；
 *  - 不堆一起、无缺失的平台原样保留（不破坏已分散的新文章 / 用户手动调好的位置）。
 */
function alignText(text: string, plan: Record<number, string>): string {
  const nums = Object.keys(plan).map(Number).sort((a, b) => a - b);
  if (!nums.length) return text;
  const ph = new RegExp(PH_RE.source, "g");

  // 1) 去重：同编号只留首个
  const seen = new Set<number>();
  let cleaned = text.replace(ph, (full, n) => {
    const num = Number(n);
    if (seen.has(num)) return "";
    seen.add(num);
    return full;
  });
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  const paras = cleaned.split(/\n\n+/);
  const markIdx: number[] = [];
  paras.forEach((p, i) => {
    if (hasMark(p)) markIdx.push(i);
  });
  const present = new Set(
    markIdx.map((i) => {
      const m = paras[i].match(/【配图(\d+)/);
      return m ? Number(m[1]) : -1;
    }),
  );
  const missing = nums.filter((n) => !present.has(n));
  let reshuffle = false;
  for (let i = 1; i < markIdx.length; i++) {
    if (markIdx[i] - markIdx[i - 1] < 2) reshuffle = true;
  }
  if (!reshuffle && !missing.length) return cleaned;

  // 重排：删全部标记，按段落均匀重插全部 plan（编号顺序分散）
  const noMarks = cleaned.replace(ph, "").replace(/\n{3,}/g, "\n\n").trim();
  const ps = noMarks.split(/\n\n+/).filter((p) => p.trim());
  const P = ps.length;
  if (P <= 1) {
    return (
      ps.join("\n\n") +
      "\n\n" +
      nums.map((n) => `【配图${n}：${plan[n]}】`).join("\n\n")
    );
  }
  const inserts = nums.map((n, k) => ({
    idx: Math.min(P - 1, Math.floor(((k + 1) / (nums.length + 1)) * P)),
    tok: `【配图${n}：${plan[n]}】`,
  }));
  inserts.sort((a, b) => b.idx - a.idx);
  inserts.forEach(({ idx, tok }) => ps.splice(idx + 1, 0, tok));
  return ps.join("\n\n");
}

/* ------------------------------------------------------------------ */

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

  const texts = useRef<Record<string, string>>({});
  const imgMap = useRef<ImgMap>({});
  const editorRef = useRef<HTMLDivElement>(null);
  /** 实际文章 id：新建草稿创建成功后才会被填入；加载已有文章时等于 articleId */
  const effectiveId = useRef<string | null>(initialId ?? storedId ?? null);
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
      el.innerHTML = renderBody(texts.current[key] ?? "", imgMap.current);
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
        // 四平台共享同一份配图计划：补齐缺失平台、去重、把堆一起的打散
        const plan = buildPlan(built, map);
        for (const p of PLATFORMS) {
          built[p.key] = alignText(built[p.key], plan);
        }
        texts.current = built;
        imgMap.current = map;
        setTitles(a.titles ?? { toutiao: a.title });
        setActive("toutiao");
      })
      .catch((e) => alive && setErr((e as ApiError).message || "加载失败"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId]);

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
        setCurrentArticleId(created.article_id);
        window.history.replaceState(null, "", `/writer?articleId=${created.article_id}`);
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
        setOkMsg("已保存");
      }
    } catch (e) {
      setErr((e as ApiError).message || "保存失败");
    }
  }

  function onEdit() {
    refreshStat();
    scheduleSave();
  }

  /** 处理占位卡片 / 图片工具栏的交互 */
  function handleEditorAction(target: HTMLElement) {
    const actBtn = target.closest<HTMLElement>("[data-act]");
    if (actBtn) {
      const fig = actBtn.closest<HTMLElement>("figure[data-img]");
      if (!fig) return;
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

    const slot = target.closest<HTMLElement>("[data-ph]");
    if (slot) {
      pending.current = { mode: "slot", el: slot };
      setPickerQuery((slot.dataset.desc ?? "").split("_")[0] ?? "");
      setPickerOpen(true);
    }
  }

  function onEditorClick(e: React.MouseEvent<HTMLDivElement>) {
    handleEditorAction(e.target as HTMLElement);
  }

  /** contentEditable 内部的 contenteditable=false 子元素，mousedown 更稳 */
  function onEditorMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement;
    if (t.closest("[data-ph],figure[data-img]")) {
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

  function handlePick(m: { id: number; stem: string; url: string | null }) {
    const el = editorRef.current;
    if (!el) return;
    const stem = m.stem.startsWith("/") ? m.stem : `/images/${m.stem}`;
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
    box.innerHTML = renderBody(text, imgMap.current);

    // 去掉界面元素 + 未配图的占位卡片
    box.querySelectorAll("[data-ui]").forEach((n) => n.remove());
    const emptySlots = box.querySelectorAll("[data-ph]");
    emptySlots.forEach((n) => n.remove());

    // 图片内联成 base64，粘到平台编辑器才能直出
    const imgs = Array.from(box.querySelectorAll("img"));
    setBusy(true);
    await Promise.all(
      imgs.map(async (img) => {
        const d = await toDataUrl(img.getAttribute("src") ?? "");
        if (d) img.setAttribute("src", d);
        img.removeAttribute("class");
      }),
    );
    setBusy(false);

    box.querySelectorAll("figure").forEach((f) => f.removeAttribute("class"));
    const html = box.innerHTML;
    const plain = text.replace(PH_RE, (full, n, desc) =>
      imgMap.current[phKey(n, desc)] ? "" : full,
    );
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
      await navigator.clipboard.writeText(plain);
      setOkMsg(`已复制「${label}」文字（浏览器不支持图文复制）`);
    }
  }

  /* -------------------- 去 AI 味 / 标题 -------------------- */

  async function humanize() {
    if (!effectiveId.current) return;
    captureCurrent();
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
    }
  }

  async function regenerateTitles() {
    if (!effectiveId.current) return;
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
        <Button className="h-9" onClick={() => void copyPlatform(active)} disabled={busy}>
          {busy ? "处理中…" : `复制「${activeLabel}」图文`}
        </Button>
        <ButtonSecondary className="h-9" onClick={() => void flushSave()}>
          保存
        </ButtonSecondary>
        <ButtonSecondary className="h-9" onClick={insertAtCursor}>
          在光标处插图
        </ButtonSecondary>
        <ButtonSecondary className="h-9" onClick={() => void humanize()} disabled={busy}>
          去AI味
        </ButtonSecondary>
        <ButtonSecondary className="h-9" onClick={() => void regenerateTitles()} disabled={busy}>
          重生成平台标题
        </ButtonSecondary>
        <span className="ml-auto text-xs text-tertiary">
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
            className="article-body min-h-[460px] w-full overflow-auto rounded-btn border border-subtle bg-raised px-5 py-4 text-[15px] leading-8 text-primary focus:border-accent focus:outline-none"
            style={{ wordBreak: "break-word" }}
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
