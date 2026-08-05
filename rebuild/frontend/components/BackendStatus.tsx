"use client";

import { useEffect, useState } from "react";

interface HealthView {
  online: boolean;
  materialCount?: number;
}

/**
 * 浏览器侧唯一的数据请求示例：只打同源 /api/health（服务端代理转发到 FastAPI）。
 * 绝不直连后端，也不接触任何密钥。
 */
export function BackendStatus() {
  const [health, setHealth] = useState<HealthView | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: HealthView) => {
        if (alive) setHealth(d);
      })
      .catch(() => {
        if (alive) setHealth({ online: false });
      });
    return () => {
      alive = false;
    };
  }, []);

  const online = health?.online === true;
  const text = health === null ? "检测中" : online ? "后端已连接" : "基线数据";

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-tertiary">
      <span className={`h-1.5 w-1.5 rounded-pill ${online ? "bg-success" : "bg-warning"}`} />
      {text}
    </span>
  );
}
