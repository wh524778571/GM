"""后台任务进度查询。

长耗时动作（当前是四平台生成）统一走 job 模式：
POST 触发拿 job_id → 前端轮询本端点拿真实阶段进度 → status=done 时取 result。

只读端点，无副作用。任务不存在返回 404（重启后内存态清空即属此情形，
前端据此提示"任务已失效，请重新生成"，而不是无限转圈）。
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core.jobs import jobs

router = APIRouter(tags=["jobs"])


@router.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    snap = jobs.get(job_id)
    if snap is None:
        raise HTTPException(404, f"任务不存在或已过期：{job_id}")
    return snap
