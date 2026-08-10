"""用户可编辑配置服务（单例 JSON 文件持久化）。

与设计原则对齐：
- 平台*规则*（标题字数 / 配图等）唯一权威源仍是 config/platforms.yaml，本模块不碰它。
- 用户*配置*（账号名 / 平台开关 / 变现状态 / 偏好）落在 config/user_settings.json，
  非密钥、可随仓库，但本仓库 .gitignore 已忽略它（属本地用户配置）。
- AI 密钥（REDFOX / GEMINI / ZHIPU）只经 .env 读写，绝不回显内容，遵循坑 8「密钥落盘」约束。
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from app.core.platform_rules import load_registry
from app.core.settings import BACKEND_ROOT, CONFIG_DIR, settings as app_settings

SETTINGS_PATH = CONFIG_DIR / "user_settings.json"
ENV_PATH = BACKEND_ROOT / ".env"

# 真实账号名种子（来自用户记忆；首次启动填充，用户可在界面改）。
DEFAULT_ACCOUNTS = {
    "toutiao": "Yolo的国漫笔记",
    "baijia": "Yolo的国漫笔记",
    "bilibili": "Yolo的国漫笔记",
    "xhs": "Yolo",
}

# 可在设置界面写入的密钥白名单（其余键一律拒绝，防滥用）。
ALLOWED_API_KEYS: dict[str, str] = {
    "REDFOX_API_KEY": "cn-last30days 热点扫描",
    "GEMINI_API_KEY": "nano-banana-pro 配图",
    "ZHIPU_API_KEY": "AI 文章生成",
}

# 各平台变现状态字段 ↔ 中文标签
MONETIZATION_LABELS = {
    "toutiao_original": "今日头条 · 原创标签",
    "baijia_income": "百家号 · 收益开通",
    "bilibili_creator": "B站 · 创作激励",
    "xhs_pgy": "小红书 · 蒲公英",
}


def _platform_keys() -> tuple[str, ...]:
    return load_registry().keys()


def _default_settings() -> dict:
    enabled = {k: True for k in _platform_keys()}
    return {
        "accounts": dict(DEFAULT_ACCOUNTS),
        "platforms_enabled": enabled,
        "monetization": {k: False for k in MONETIZATION_LABELS},
        "preferences": {"micro_post_min_interval_hours": 2},
    }


def _deep_merge(base: dict, override: dict) -> dict:
    out = dict(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _load() -> dict:
    data: dict = {}
    if SETTINGS_PATH.is_file():
        try:
            data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8") or "{}")
        except (json.JSONDecodeError, OSError):
            data = {}
    return _deep_merge(_default_settings(), data)


def _save(data: dict) -> None:
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def _api_key_status_list() -> list[dict]:
    return [
        {
            "key": key,
            "label": label,
            "configured": bool(os.environ.get(key)),
        }
        for key, label in ALLOWED_API_KEYS.items()
    ]


def _validate_platform_keys(mapping: dict[str, object], field: str) -> None:
    """accounts / platforms_enabled 的键必须是已注册平台，否则 422。"""
    valid = set(_platform_keys())
    bad = [k for k in mapping if k not in valid]
    if bad:
        raise ValueError(f"{field} 含未注册平台：{bad}（合法：{sorted(valid)}）")


class SettingsService:
    @staticmethod
    def get() -> dict:
        data = _load()
        data["api_keys"] = _api_key_status_list()
        return data

    @staticmethod
    def update(payload: dict) -> dict:
        data = _load()
        if payload.get("accounts") is not None:
            _validate_platform_keys(payload["accounts"], "accounts")
            data["accounts"].update(payload["accounts"])
        if payload.get("platforms_enabled") is not None:
            _validate_platform_keys(payload["platforms_enabled"], "platforms_enabled")
            data["platforms_enabled"].update(payload["platforms_enabled"])
        if payload.get("monetization") is not None:
            for k in payload["monetization"]:
                if k not in MONETIZATION_LABELS:
                    raise ValueError(f"monetization 含未知字段：{k}")
            data["monetization"].update(payload["monetization"])
        if payload.get("preferences") is not None:
            iv = payload["preferences"].get("micro_post_min_interval_hours")
            if iv is not None and (not isinstance(iv, int) or iv < 0 or iv > 24):
                raise ValueError("micro_post_min_interval_hours 必须 0-24 的整数")
            data["preferences"].update(payload["preferences"])
        _save(data)
        data["api_keys"] = _api_key_status_list()
        return data

    @staticmethod
    def set_api_key(key: str, value: str) -> list[dict]:
        if key not in ALLOWED_API_KEYS:
            raise ValueError(f"不允许写入的密钥：{key}（仅限 {sorted(ALLOWED_API_KEYS)}）")
        # 写 .env：存在则替换该行，否则追加；引号包裹以防空格/#。
        lines = (
            ENV_PATH.read_text(encoding="utf-8").splitlines()
            if ENV_PATH.is_file()
            else []
        )
        new_line = f'{key}="{value}"' if (" " in value or "#" in value) else f"{key}={value}"
        replaced = False
        for i, ln in enumerate(lines):
            stripped = ln.strip()
            if stripped.startswith("#") or "=" not in stripped:
                continue
            if stripped.split("=", 1)[0].strip() == key:
                lines[i] = new_line
                replaced = True
                break
        if not replaced:
            lines.append(new_line)
        ENV_PATH.parent.mkdir(parents=True, exist_ok=True)
        ENV_PATH.write_text("\n".join(lines).rstrip("\n") + "\n", encoding="utf-8")
        # 同步当前进程环境变量，使本次会话内 configured 立即生效。
        os.environ[key] = value
        return _api_key_status_list()
