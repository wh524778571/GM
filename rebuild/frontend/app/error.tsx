"use client";

import { useEffect } from "react";
import { Button } from "@/components/Button";

/**
 * Next.js App Router 全局路由错误边界：捕获所有页面渲染/数据取用阶段的崩溃，
 * 用友好降级卡片替代白屏，并提供「重试」回到出错页面。
 * 必须放在根 layout 之下（本文件即 root segment 的 error boundary）。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route error]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-root px-6 text-center">
      <div className="max-w-md rounded-card border border-subtle bg-card p-6">
        <h2 className="text-lg font-semibold text-primary">页面出了点问题</h2>
        <p className="mt-2 text-[13px] leading-5 text-secondary">
          某个模块渲染时崩了，但你的数据还在（没丢）。可以重试回到这个页面。
        </p>
        {error?.message ? (
          <pre className="mt-3 max-h-40 overflow-auto rounded-row bg-raised p-3 text-left text-xs text-tertiary">
            {error.message}
          </pre>
        ) : null}
        <div className="mt-4 flex justify-center">
          <Button onClick={reset}>重试</Button>
        </div>
      </div>
    </div>
  );
}
