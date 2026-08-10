"""长耗时任务的进度注册表（内存版）。

为什么需要：四平台生成要跑 5 次 LLM 调用，通常 30–120 秒。同步 HTTP 请求
期间前端只能干等，用户看不到任何进展，容易误以为卡死并重复点击。

做法：把生成放后台线程跑，任务把「当前阶段 + 百分比」写进本表，
前端轮询 GET /jobs/{id} 拿真实进度（不是假动画）。

约束：
- 进程内内存态，重启即丢。生成本身幂等（article_id 固定 topic-{id}），
  丢了重跑即可，不引入 Redis/Celery 这种与单机自媒体工作流不匹配的重型依赖。
- 线程安全：所有读写走同一把锁；返回的是快照 dict，调用方拿不到内部可变对象。
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field

# 完成态任务保留时长：前端轮询间隔 ~1s，30 分钟足够任何"回头再看"的场景
_TTL_SECONDS = 30 * 60
# 内存上限：超过则回收最旧的完成态任务，防止长跑进程无界增长
_MAX_JOBS = 200


@dataclass
class Job:
    """一个后台任务的完整状态。"""

    id: str
    kind: str
    status: str = "running"  # running | done | error
    stage: str = "start"
    percent: int = 0
    message: str = "准备中…"
    result: dict | None = None
    error: dict | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def snapshot(self) -> dict:
        # 运行中用「此刻 - 开始」，前端才能显示真实已耗时；
        # 结束后固定为总耗时（否则完成态的计时会一直涨）。
        end = time.time() if self.status == "running" else self.updated_at
        return {
            "job_id": self.id,
            "kind": self.kind,
            "status": self.status,
            "stage": self.stage,
            "percent": self.percent,
            "message": self.message,
            "result": self.result,
            "error": self.error,
            "elapsed_ms": int((end - self.created_at) * 1000),
        }


class JobRegistry:
    """线程安全的任务表。"""

    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def create(self, kind: str, message: str = "准备中…") -> Job:
        job = Job(id=uuid.uuid4().hex[:16], kind=kind, message=message)
        with self._lock:
            self._gc_locked()
            self._jobs[job.id] = job
        return job

    def update(self, job_id: str, *, stage: str, percent: int, message: str) -> None:
        """上报进度。百分比单调不回退——避免并发阶段乱序导致进度条倒退。"""
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status != "running":
                return
            job.stage = stage
            job.percent = max(job.percent, min(percent, 99))
            job.message = message
            job.updated_at = time.time()

    def finish(self, job_id: str, result: dict) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            job.status = "done"
            job.stage = "done"
            job.percent = 100
            job.message = "完成"
            job.result = result
            job.updated_at = time.time()

    def fail(self, job_id: str, error: dict) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            job.status = "error"
            job.stage = "error"
            job.message = str(error.get("message") or "生成失败")
            job.error = error
            job.updated_at = time.time()

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return job.snapshot() if job else None

    def _gc_locked(self) -> None:
        """回收过期的完成态任务。调用方必须已持锁。"""
        now = time.time()
        stale = [
            jid
            for jid, j in self._jobs.items()
            if j.status != "running" and now - j.updated_at > _TTL_SECONDS
        ]
        for jid in stale:
            self._jobs.pop(jid, None)

        if len(self._jobs) <= _MAX_JOBS:
            return
        # 仍然超限：按更新时间淘汰最旧的完成态任务（running 的一律不动）
        done = sorted(
            (j for j in self._jobs.values() if j.status != "running"),
            key=lambda j: j.updated_at,
        )
        for j in done[: len(self._jobs) - _MAX_JOBS]:
            self._jobs.pop(j.id, None)


jobs = JobRegistry()
