/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 构建产物目录；默认 .next，可用 NEXT_DIST_DIR 隔离 dev / build 产物。
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
