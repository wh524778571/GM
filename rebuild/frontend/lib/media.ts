/**
 * 后端返回的素材 url 形如 `/images/_素材库/沧元图/xxx.jpeg?t=123`（IMG_BASE_URL 默认 /images）。
 * 浏览器只能访问同源，所以统一改写成 `/api/images/...` 走 Next 的二进制代理。
 * 非 `/images/` 前缀（例如已配置成绝对 CDN 地址）原样返回。
 */
export function toImageProxyUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/api/images/")) return url;
  if (url.startsWith("/images/")) return `/api${url}`;
  return url.startsWith("/") ? `/api/images${url}` : `/api/images/${url}`;
}
