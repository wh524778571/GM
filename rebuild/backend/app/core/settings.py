"""全局配置：唯一的数据源声明处。

坑 2「多数据源分裂」防护：整个工程只有这里声明 DATABASE_URL，
其余模块一律 `from app.core.settings import settings` 取值，
禁止任何地方出现 sqlite3.connect / 第二个 URL。

坑 8「密钥落盘」防护：密钥只从环境变量读，代码内不出现任何真实值。
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = BACKEND_ROOT / "config"


def _load_dotenv(path: Path) -> None:
    """极简 .env 加载：不覆盖已存在的真实环境变量。"""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv(BACKEND_ROOT / ".env")


class Settings:
    """运行期配置。所有字段均来自环境变量，带安全默认值。"""

    def __init__(self) -> None:
        # ── 唯一数据源 ──────────────────────────────────────────
        self.database_url: str = os.getenv("DATABASE_URL", "sqlite:///./app.db")

        # ── 平台规则唯一权威源 ─────────────────────────────────
        self.platforms_config_path: Path = Path(
            os.getenv("PLATFORMS_CONFIG", str(CONFIG_DIR / "platforms.yaml"))
        )

        # ── 素材库根目录（Phase 1 只做索引，不强制存在） ────────
        materials_root = os.getenv("MATERIALS_ROOT", "")
        self.materials_root: Path | None = Path(materials_root) if materials_root else None

        # ── 图片服务基地址（渲染 <img src> 用） ─────────────────
        self.img_base_url: str = os.getenv("IMG_BASE_URL", "/images")

        # ── 项目文件浏览根目录（「项目文件」屏只读列表 + uploads 写入） ──
        # 默认指向仓库上一级（设计稿 / 方案文档 / 规则源都在这一层）。
        self.files_root: Path = Path(os.getenv("FILES_ROOT", str(BACKEND_ROOT.parents[1])))

        # ── AI 密钥：只读环境变量，缺失即为 None，绝不落盘 ──────
        self.zhipu_api_key: str | None = os.getenv("ZHIPU_API_KEY") or None

        # ── AI 运行参数（Phase 2）──────────────────────────────
        # 默认 Provider：zhipu（真实调用）| mock（离线假数据，仅供演示/测试）
        self.ai_provider: str = os.getenv("AI_PROVIDER", "zhipu").strip().lower()
        # 模型 / 接口地址留空时用 app/services/ai/provider.py 中的常量
        self.zhipu_model: str | None = os.getenv("ZHIPU_MODEL") or None
        self.zhipu_base_url: str | None = os.getenv("ZHIPU_BASE_URL") or None
        self.ai_timeout_seconds: float = float(os.getenv("AI_TIMEOUT_SECONDS", "120"))
        self.ai_max_attempts: int = int(os.getenv("AI_MAX_ATTEMPTS", "3"))
        self.ai_base_delay_seconds: float = float(os.getenv("AI_BASE_DELAY_SECONDS", "1"))
        self.ai_max_tokens: int = int(os.getenv("AI_MAX_TOKENS", "16000"))
        self.ai_temperature: float = float(os.getenv("AI_TEMPERATURE", "0.6"))

        self.app_env: str = os.getenv("APP_ENV", "dev")

    @property
    def zhipu_api_key_configured(self) -> bool:
        """只暴露「是否已配置」，永不回显密钥内容。"""
        return bool(self.zhipu_api_key)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
