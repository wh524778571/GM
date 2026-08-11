/** 编辑器序列化 / 配图对齐——纯函数，不依赖 React state，可在任何地方使用。 */

import { ImgMap, phKey, PH_RE } from "./articleMarkdown";

/* ------------------------------------------------------------------ *
 * 序列化：编辑区 DOM -> 带标记的纯文本 + 图片绑定
 * ------------------------------------------------------------------ */

export interface Serialized {
  text: string;
  bound: ImgMap;
  slots: string[];
}

export function serialize(root: HTMLElement): Serialized {
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
      if (node.tagName === "H5") {
        const t = node.innerText.trim();
        if (t) out.push(`#### ${t}`);
        return;
      }
      if (node.tagName === "UL" || node.tagName === "OL") {
        const ordered = node.tagName === "OL";
        node.querySelectorAll("li").forEach((li, idx) => {
          const t = li.innerText.trim();
          if (t) out.push(ordered ? `${idx + 1}. ${t}` : `- ${t}`);
        });
        return;
      }
      if (node.tagName === "BLOCKQUOTE") {
        const t = node.innerText.trim();
        if (t) out.push(`> ${t.replace(/\n/g, "\n> ")}`);
        return;
      }
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

/* ------------------------------------------------------------------ *
 * HTML 降级兼容
 * ------------------------------------------------------------------ */

export function looksLikeHtml(s: string) {
  return /<(img|div|p|figure|br)\b/i.test(s);
}

export function htmlToMarkerText(html: string): { text: string; bound: ImgMap } {
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

/* ------------------------------------------------------------------ *
 * 配图计划与对齐
 * ------------------------------------------------------------------ */

export function hasMark(p: string) {
  return /【配图\d+\s*[:：]/.test(p);
}

export function buildPlan(
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

/**
 * 把一篇平台正文对齐成「四平台一致、分散不重复」的配图版：
 *  - 同编号只保留首个（去掉堆一起的重复）；
 *  - 若某平台缺失配图、或现存配图连续堆一起（相邻间隔<2段），则删除全部标记后按段落均匀重排；
 *  - 不堆一起、无缺失的平台原样保留。
 */
export function alignText(text: string, plan: Record<number, string>): string {
  const nums = Object.keys(plan).map(Number).sort((a, b) => a - b);
  if (!nums.length) return text;
  const ph = new RegExp(PH_RE.source, "g");

  // 去重：同编号只留首个
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
  const totalParas = paras.length;
  if (
    !reshuffle &&
    markIdx.length >= 2 &&
    markIdx[0] >= Math.max(1, Math.floor(totalParas * 0.7))
  ) {
    reshuffle = true;
  }
  if (!reshuffle && !missing.length) return cleaned;

  // 重排：删全部标记，按段落均匀重插全部 plan
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
