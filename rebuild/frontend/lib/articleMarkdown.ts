import { toImageProxyUrl } from "@/lib/media";

/** 「【配图N：描述】」-> 图片地址（已绑定素材时） */
export type ImgMap = Record<string, string>;

export const PH_RE = /【配图(\d+)\s*[:：]\s*([^】]*)】/g;

export const phKey = (n: string | number, desc: string) => `【配图${n}：${desc.trim()}】`;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 后端存储路径 / 本地 stem -> 浏览器可加载的同源代理 url；已是 http(s)/data 则原样返回。 */
function proxy(stem: string): string {
  if (/^(https?:|data:)/i.test(stem)) return stem;
  const raw = stem.startsWith("/") ? stem : `/images/${stem}`;
  return toImageProxyUrl(raw) ?? raw;
}

/** 行内 markdown：**粗体** */
function inline(text: string): string {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

const IMG_BOX =
  "my-3 group relative";
const PH_BOX =
  "ph-slot my-3 flex cursor-pointer items-center gap-3 rounded-btn border border-dashed border-accent/50 bg-accent/5 px-4 py-3 text-[13px] text-secondary transition hover:border-accent hover:bg-accent/10";

/** 已绑定素材：渲染真图，风格贴近发布弹窗（图片融入正文流，操作按钮 hover 浮现）。 */
export function figureHtml(n: string, desc: string, stem: string): string {
  const d = escapeHtml(desc.trim());
  return (
    `<figure data-img="${n}" data-desc="${d}" data-stem="${escapeHtml(stem)}" contenteditable="false" class="${IMG_BOX}">` +
    `<img src="${escapeHtml(proxy(stem))}" alt="${d}" class="block w-full rounded object-contain" />` +
    `<figcaption data-ui="1" class="absolute inset-x-0 bottom-0 flex items-center gap-2 rounded-b bg-black/60 px-3 py-1.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">` +
    `<span>配图${n} · ${d}</span>` +
    `<button type="button" data-act="change" class="ml-auto rounded px-2 py-0.5 hover:bg-white/20">换图</button>` +
    `<button type="button" data-act="remove" class="rounded px-2 py-0.5 hover:bg-white/20">移除</button>` +
    `</figcaption></figure>`
  );
}

/** 未绑定素材：渲染可点击的占位卡片（仅编辑器内 showSlots=true 时出现）。 */
export function slotHtml(n: string, desc: string): string {
  const d = escapeHtml(desc.trim());
  return (
    `<div data-ph="${n}" data-desc="${d}" contenteditable="false" class="${PH_BOX}">` +
    `<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">${n}</span>` +
    `<span class="font-medium text-primary">${d || "待配图"}</span>` +
    `<span data-ui="1" class="ml-auto text-xs text-accent">点击从素材库选图 →</span>` +
    `</div>`
  );
}

export interface RenderOpts {
  /** 编辑器内为 true：未绑定素材也渲染可点击占位卡片；读者视图为 false：隐藏未绑定占位符，不泄漏「配图N：描述」内部标记 */
  showSlots?: boolean;
}

/**
 * 把「带【配图N】标记的 markdown 纯文本」渲染成文章 DOM（标题 / 加粗 / 列表 / 引用 / 分隔线 / 配图）。
 * 编辑器（showSlots=true）与读者视图（showSlots=false）共用同一套，保证四平台与详情页视觉一致、看着像文章。
 */
export function renderArticleMarkdown(text: string, imgMap: ImgMap, opts: RenderOpts = {}): string {
  const showSlots = opts.showSlots ?? false;
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line) {
      i++;
      continue;
    }

    // 整行就是一个配图标记 -> 独立成块
    const only = line.match(/^【配图(\d+)\s*[:：]\s*([^】]*)】$/);
    if (only) {
      const [, n, desc] = only;
      const stem = imgMap[phKey(n, desc)];
      blocks.push(stem ? figureHtml(n, desc, stem) : showSlots ? slotHtml(n, desc) : "");
      i++;
      continue;
    }

    // 无序列表 - / *
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i].trim();
        if (!/^[-*]\s+/.test(l)) break;
        items.push(`<li>${inline(l.replace(/^[-*]\s+/, ""))}</li>`);
        i++;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    // 有序列表 1. / 2、
    if (/^\d+[.、]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i].trim();
        if (!/^\d+[.、]\s+/.test(l)) break;
        items.push(`<li>${inline(l.replace(/^\d+[.、]\s+/, ""))}</li>`);
        i++;
      }
      blocks.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    // 引用 >
    if (/^>\s?/.test(line)) {
      const quotes: string[] = [];
      while (i < lines.length) {
        const l = lines[i].trim();
        if (!/^>\s?/.test(l)) break;
        quotes.push(inline(l.replace(/^>\s?/, "")));
        i++;
      }
      blocks.push(`<blockquote>${quotes.join("<br/>")}</blockquote>`);
      continue;
    }
    // 分隔线
    if (/^([-*_]){3,}$/.test(line)) {
      blocks.push("<hr/>");
      i++;
      continue;
    }

    // 小标题
    if (line.startsWith("#### ")) {
      blocks.push(`<h5>${inline(line.slice(5))}</h5>`);
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      blocks.push(`<h4>${inline(line.slice(4))}</h4>`);
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push(`<h3>${inline(line.slice(3))}</h3>`);
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push(`<h3>${inline(line.slice(2))}</h3>`);
      i++;
      continue;
    }

    // 行内混有配图标记
    if (PH_RE.test(line)) {
      PH_RE.lastIndex = 0;
      let cursor = 0;
      let m: RegExpExecArray | null;
      while ((m = PH_RE.exec(line)) !== null) {
        const before = line.slice(cursor, m.index).trim();
        if (before) blocks.push(`<p>${inline(before)}</p>`);
        const stem = imgMap[phKey(m[1], m[2])];
        blocks.push(stem ? figureHtml(m[1], m[2], stem) : showSlots ? slotHtml(m[1], m[2]) : "");
        cursor = m.index + m[0].length;
      }
      PH_RE.lastIndex = 0;
      const tail = line.slice(cursor).trim();
      if (tail) blocks.push(`<p>${inline(tail)}</p>`);
      i++;
      continue;
    }

    blocks.push(`<p>${inline(line)}</p>`);
    i++;
  }
  const out = blocks.filter(Boolean).join("");
  return out || "<p><br/></p>";
}
