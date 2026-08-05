/**
 * 验收脚本：7 屏可访问性 + 中文标题断言 + 布局宽度断言。
 * 用法：node scripts/verify-pages.mjs [baseUrl]
 * 依赖：需先 `npm run dev` 或 `npm start` 起服务。
 */
const BASE = process.argv[2] ?? "http://localhost:3000";

const PAGES = [
  { path: "/", must: ["工作台", "本周概览", "近期文章", "待发布队列"] },
  { path: "/articles", must: ["文章管理", "阅读量", "慕兰之战", "沧元图"] },
  { path: "/weekly", must: ["周计划", "周五", "沧元图"] },
  { path: "/analytics", must: ["数据看板", "总阅读量", "平台分布"] },
  { path: "/writer", must: ["AI 写作", "创作设置", "实时预览"] },
  { path: "/assets", must: ["配图管理", "素材总数", "825"] },
  { path: "/files", must: ["项目文件", "设计系统"] },
];

// 主内容列固定 976px，根容器 overflow-x-hidden —— 断言两者都在产物 HTML 里
const LAYOUT_MARKERS = ["max-w-content", "overflow-x-hidden"];

let failed = 0;

for (const page of PAGES) {
  const url = `${BASE}${page.path}`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    console.log(`✗ ${page.path} 请求失败：${err.message}`);
    failed++;
    continue;
  }
  const html = await res.text();
  const missing = page.must.filter((word) => !html.includes(word));
  const layoutMissing = LAYOUT_MARKERS.filter((m) => !html.includes(m));
  const ok = res.status === 200 && missing.length === 0 && layoutMissing.length === 0;

  if (ok) {
    console.log(`✓ ${page.path} ${res.status} · 文案命中 ${page.must.length}/${page.must.length} · 布局标记齐全`);
  } else {
    failed++;
    console.log(
      `✗ ${page.path} ${res.status}` +
        (missing.length ? ` · 缺文案 ${JSON.stringify(missing)}` : "") +
        (layoutMissing.length ? ` · 缺布局标记 ${JSON.stringify(layoutMissing)}` : ""),
    );
  }
}

// 代理连通性（后端未启动时应优雅降级，不 500）
const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
console.log(`· /api/health 代理返回：${JSON.stringify(health)}`);

console.log(failed === 0 ? "\n全部通过" : `\n失败 ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
