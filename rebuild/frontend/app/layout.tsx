import type { Metadata } from "next";
import { Noto_Sans_SC } from "next/font/google";
import "./globals.css";

/** 全局统一 Noto Sans SC（自托管，无 Inter 残留）。 */
const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-noto-sans-sc",
});

export const metadata: Metadata = {
  title: "Yolo 的国漫笔记 · 内容工作台",
  description: "国漫自媒体内容生产系统：选题 → 生成 → 配图 → 四平台预览 → 追踪",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={notoSansSC.className}>
      <body className="min-h-screen overflow-x-hidden bg-root font-sans text-primary antialiased">
        {children}
      </body>
    </html>
  );
}
