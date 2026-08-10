"""设置路由：用户可编辑配置的真实读写入口。

- GET  /settings         读取完整配置（含密钥 configured 状态，绝不回显值）
- PUT  /settings         更新账号名 / 平台开关 / 变现状态 / 偏好
- PUT  /settings/api-keys 写入单个 AI 密钥到 .env（白名单受限）
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.api.schemas import (
    ApiKeyStatus,
    ApiKeyUpdate,
    UserSettingsOut,
    UserSettingsUpdate,
)
from app.core import settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=UserSettingsOut)
def get_settings() -> UserSettingsOut:
    return UserSettingsOut(**settings_service.SettingsService.get())


@router.put("", response_model=UserSettingsOut)
def update_settings(payload: UserSettingsUpdate) -> UserSettingsOut:
    body = payload.model_dump(exclude_unset=True)
    try:
        result = settings_service.SettingsService.update(body)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return UserSettingsOut(**result)


@router.put("/api-keys", response_model=list[ApiKeyStatus])
def update_api_key(payload: ApiKeyUpdate) -> list[ApiKeyStatus]:
    try:
        result = settings_service.SettingsService.set_api_key(payload.key, payload.value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return [ApiKeyStatus(**item) for item in result]
