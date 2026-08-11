import { NextResponse } from "next/server";
import { spawn, type StdioOptions } from "child_process";
import path from "path";
import fs from "fs";
import { backendGet } from "@/lib/backend";

export const dynamic = "force-dynamic";

// 优先读环境变量，回退到本机 WorkBuddy 隔离 venv（生产机可设 BACKEND_PYTHON_BIN 覆盖）
const DEFAULT_VENV = "/Users/wuhao/.workbuddy/binaries/python/envs/default/bin/python3";
const pythonBin =
  process.env.BACKEND_PYTHON_BIN ||
  (fs.existsSync(DEFAULT_VENV) ? DEFAULT_VENV : "python3");

// 后端目录：默认 ../backend（相对前端 cwd）；可用 BACKEND_DIR 覆盖
const backendDir =
  process.env.BACKEND_DIR || path.resolve(process.cwd(), "../backend");

// 防并发重复拉起（同进程内有效；跨 dev worker 重启会重置，但配合端口探测足够）
let starting = false;

async function pingBackend(): Promise<boolean> {
  const h = await backendGet<{ status?: string }>("/health", 1500);
  return !!h && h.status === "ok";
}

export async function POST() {
  // 已在线则不重复启动
  if (await pingBackend()) {
    return NextResponse.json({ ok: true, alreadyRunning: true });
  }
  if (starting) {
    return NextResponse.json({ ok: false, error: "后端正在启动中，请稍候" });
  }
  if (!fs.existsSync(backendDir)) {
    return NextResponse.json({
      ok: false,
      error: "未找到后端目录",
      hint: `BACKEND_DIR=${backendDir}`,
    });
  }

  starting = true;
  const logPath = path.join(backendDir, "start-backend.log");
  let stdio: StdioOptions = "ignore";
  try {
    const logFd = fs.openSync(logPath, "a");
    stdio = ["ignore", logFd, logFd] as StdioOptions;
  } catch {
    // 极端情况下丢弃日志，不影响启动
  }

  try {
    // 单进程 uvicorn，不加 --reload；detached + unref 让其脱离前端 dev server 生命周期
    const child = spawn(
      pythonBin,
      ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
      {
        cwd: backendDir,
        detached: true,
        stdio,
        env: { ...process.env },
      },
    );
    child.unref();

    // 轮询确认起来（最多 ~12s）
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await pingBackend()) {
        return NextResponse.json({ ok: true, pid: child.pid ?? null });
      }
    }
    return NextResponse.json({
      ok: false,
      error: "后端启动超时，请查看日志",
      hint: `tail -f ${logPath} 或手动：cd ${backendDir} && ${pythonBin} -m uvicorn app.main:app --port 8000`,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: String(err),
      hint: "请确认 Python 解释器路径（可设置 BACKEND_PYTHON_BIN）",
    });
  } finally {
    starting = false;
  }
}
