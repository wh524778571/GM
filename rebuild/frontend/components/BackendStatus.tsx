"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./Button";

interface HealthView {
  online: boolean;
  materialCount?: number;
}

/**
 * 顶部后端状态：在线显示「后端已连接」；离线显示「⚠ 后端未连接」+ 启动按钮。
 * 点击「启动后端」→ POST /api/system/start-backend（服务端拉起 uvicorn）→ 轮询 /api/health 直到连上 → 自动刷新切回实时数据。
 * 数据请求只走同源 /api/*，绝不直连后端、不接触密钥。
 */
export function BackendStatus() {
  const [health, setHealth] = useState<HealthView | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkHealth = useCallback(async (): Promise<boolean> => {
    try {
      const d = (await fetch("/api/health").then((r) => r.json())) as HealthView;
      setHealth(d);
      return d.online === true;
    } catch {
      setHealth({ online: false });
      return false;
    }
  }, []);

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
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startBackend = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/system/start-backend", { method: "POST" });
      const data = (await res.json()) as {
        ok: boolean;
        alreadyRunning?: boolean;
        error?: string;
      };
      if (!data.ok && !data.alreadyRunning) {
        setError(data.error || "启动失败");
        setStarting(false);
        return;
      }
      // 轮询直到 online，最多 20s
      let tries = 0;
      pollRef.current = setInterval(async () => {
        tries += 1;
        const ok = await checkHealth();
        if (ok) {
          if (pollRef.current) clearInterval(pollRef.current);
          setStarting(false);
          window.location.reload(); // 切回实时数据
        } else if (tries >= 20) {
          if (pollRef.current) clearInterval(pollRef.current);
          setError("启动超时，请在终端手动启动后端");
          setStarting(false);
        }
      }, 1000);
    } catch {
      setError("启动请求失败");
      setStarting(false);
    }
  }, [checkHealth]);

  const online = health?.online === true;

  if (online) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-tertiary">
        <span className="h-1.5 w-1.5 rounded-pill bg-success" />
        后端已连接
      </span>
    );
  }

  return (
    <div className="inline-flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs text-tertiary">
        <span className="h-1.5 w-1.5 rounded-pill bg-warning" />
        后端未连接
      </span>
      {starting ? (
        <span className="text-xs text-tertiary">启动中…</span>
      ) : (
        <Button
          variant="secondary"
          className="h-7 px-2.5 text-xs"
          onClick={startBackend}
        >
          启动后端
        </Button>
      )}
      {error ? (
        <span className="max-w-[220px] truncate text-xs text-warning" title={error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
