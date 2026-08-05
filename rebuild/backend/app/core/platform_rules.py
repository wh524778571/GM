"""平台规则读取器 —— 唯一权威源 `config/platforms.yaml` 的唯一入口。

坑 5「标题/字数规则冲突」防护：
    生成、质检、渲染、UI 一律通过本模块取规则，代码中禁止再写死任何数字。
    任何硬编码的 30/64/50/20 都视为回归。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from app.core.settings import settings


class PlatformRulesError(RuntimeError):
    """规则文件缺失/损坏。绝不静默降级（坑 3：禁止静默成功）。"""


@dataclass(frozen=True)
class TitleRule:
    max_chars: int
    min_chars: int


@dataclass(frozen=True)
class BodyRule:
    target_chars: int
    max_chars: int | None
    short_ratio: float


@dataclass(frozen=True)
class ImageRule:
    allowed: bool
    required: bool
    caption: bool
    alt_text: bool
    wrap_div: bool
    img_margin_bottom: str | None


@dataclass(frozen=True)
class PlatformRule:
    key: str
    name: str
    style: str
    display_color: str
    title: TitleRule
    body: BodyRule
    images: ImageRule
    publish: dict[str, Any]


@dataclass(frozen=True)
class PlaceholderRule:
    pattern: str
    template: str
    chars_per_image: int
    min_images: int

    @property
    def regex(self) -> re.Pattern[str]:
        return re.compile(self.pattern)


@dataclass(frozen=True)
class PlatformRegistry:
    version: int
    order: tuple[str, ...]
    placeholder: PlaceholderRule
    platforms: dict[str, PlatformRule]
    tracking_aliases: dict[str, str]
    source_path: Path
    # 数据看板换算参数（revenue_rpm_cents 等），缺省为空 dict
    analytics: dict[str, Any] = field(default_factory=dict)

    def revenue_rpm_cents(self, platform: str) -> int:
        """每千次阅读预估收益（分）。未配置返回 0，调用方据此标注「未配置」。"""
        table = (self.analytics or {}).get("revenue_rpm_cents") or {}
        return int(table.get(platform, 0) or 0)

    def get(self, key: str) -> PlatformRule:
        rule = self.platforms.get(key)
        if rule is None:
            raise PlatformRulesError(
                f"未知平台 '{key}'，platforms.yaml 中已定义：{list(self.platforms)}"
            )
        return rule

    def keys(self) -> tuple[str, ...]:
        return self.order

    def normalize_platform(self, value: str) -> str:
        """把 '今日头条' / 'toutiao' / 'xiaohongshu' 统一为规则 key。"""
        if value in self.platforms:
            return value
        if value in self.tracking_aliases:
            return self.tracking_aliases[value]
        legacy = {"xiaohongshu": "xhs", "xiaohong": "xhs", "bili": "bilibili"}
        if value in legacy:
            return legacy[value]
        raise PlatformRulesError(f"无法识别的平台标识：{value!r}")


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise PlatformRulesError(f"平台规则文件不存在：{path}")
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise PlatformRulesError(f"平台规则文件格式错误（应为 mapping）：{path}")
    return data


@lru_cache(maxsize=1)
def load_registry() -> PlatformRegistry:
    path = settings.platforms_config_path
    data = _load_yaml(path)

    ph = data.get("placeholder") or {}
    placeholder = PlaceholderRule(
        pattern=ph["pattern"],
        template=ph["template"],
        chars_per_image=int(ph["chars_per_image"]),
        min_images=int(ph["min_images"]),
    )

    platforms: dict[str, PlatformRule] = {}
    for key, raw in (data.get("platforms") or {}).items():
        title = raw["title"]
        body = raw["body"]
        images = raw["images"]
        platforms[key] = PlatformRule(
            key=key,
            name=raw["name"],
            style=raw.get("style", ""),
            display_color=raw.get("display_color", ""),
            title=TitleRule(
                max_chars=int(title["max_chars"]),
                min_chars=int(title.get("min_chars", 1)),
            ),
            body=BodyRule(
                target_chars=int(body["target_chars"]),
                max_chars=None if body.get("max_chars") is None else int(body["max_chars"]),
                short_ratio=float(body.get("short_ratio", 0.7)),
            ),
            images=ImageRule(
                allowed=bool(images["allowed"]),
                required=bool(images.get("required", False)),
                caption=bool(images.get("caption", False)),
                alt_text=bool(images.get("alt_text", False)),
                wrap_div=bool(images.get("wrap_div", False)),
                img_margin_bottom=images.get("img_margin_bottom"),
            ),
            publish=dict(raw.get("publish") or {}),
        )

    order = tuple(data.get("order") or platforms.keys())
    missing = [k for k in order if k not in platforms]
    if missing:
        raise PlatformRulesError(f"order 中引用了未定义的平台：{missing}")

    return PlatformRegistry(
        version=int(data.get("version", 1)),
        order=order,
        placeholder=placeholder,
        platforms=platforms,
        tracking_aliases=dict(data.get("tracking_aliases") or {}),
        source_path=path,
        analytics=dict(data.get("analytics") or {}),
    )
