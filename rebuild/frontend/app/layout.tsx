import type { Metadata } from "next";
import "./globals.css";
import { WriterDraftProvider } from "@/components/WriterDraftContext";

// 字体走 tailwind 的 font-sans（CJK 系统字体栈：PingFang SC / 微软雅黑 / system-ui），
// 不再用 next/font/google —— 那样构建时要联网拉 Google 字体，国内网络不稳会导致
// `next dev`/`next build` 启动卡死、项目打不开。零外网依赖，本机/沙箱都能启动。
export const metadata: Metadata = {
  title: "Yolo 的国漫笔记 · 内容工作台",
  description: "国漫自媒体内容生产系统：选题 → 生成 → 配图 → 四平台预览 → 追踪",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="font-sans">
      <body className="min-h-screen overflow-x-hidden bg-root font-sans text-primary antialiased">
        <WriterDraftProvider>{children}</WriterDraftProvider>
      </body>
    </html>
  );
}
