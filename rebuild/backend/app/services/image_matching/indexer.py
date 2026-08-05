"""素材入库索引器：把配图目录 / 归档 JSON 索引写进 materials 表。

跨平台约束（坑 8）：图片尺寸与格式转换一律用 **Pillow**，
禁止调用 macOS 专有的 `sips`。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image
from sqlalchemy.orm import Session

from app.models.material import MaterialSource
from app.repositories.material_repository import MaterialRepository

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}


@dataclass
class IndexReport:
    """索引结果。绝不静默成功：成功/跳过/失败逐条可查。"""

    created: int = 0
    updated: int = 0
    skipped: int = 0
    failures: list[str] = field(default_factory=list)

    @property
    def total(self) -> int:
        return self.created + self.updated

    def as_dict(self) -> dict:
        return {
            "created": self.created,
            "updated": self.updated,
            "skipped": self.skipped,
            "failed": len(self.failures),
            "failures": self.failures[:50],
        }


def _read_dimensions(path: Path) -> tuple[int | None, int | None]:
    """Pillow 读取尺寸；失败返回 (None, None) 并由调用方记录。"""
    try:
        with Image.open(path) as img:
            return img.width, img.height
    except Exception:
        return None, None


def convert_to_jpeg(src: Path, *, quality: int = 92) -> Path:
    """webp/png/bmp → jpeg（Pillow 实现，替代旧的 `sips` 调用）。

    GIF 保持原格式（动图转 jpeg 会丢帧）。转换失败抛异常，不静默返回原图。
    """
    ext = src.suffix.lower()
    if ext in {".jpg", ".jpeg", ".gif"}:
        return src
    dst = src.with_suffix(".jpeg")
    if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
        return dst
    with Image.open(src) as img:
        img.convert("RGB").save(dst, format="JPEG", quality=quality)
    return dst


def _classify(relative_path: str) -> tuple[str, str | None]:
    """按归档目录约定推断 source 与 article_id。"""
    parts = Path(relative_path).parts
    if not parts:
        return MaterialSource.LIBRARY.value, None
    head = parts[0]
    if head == "_素材库":
        return MaterialSource.LIBRARY.value, None
    if head == "_文章配图":
        return MaterialSource.ARTICLE.value, parts[1] if len(parts) > 1 else None
    if head == "_回收站":
        return MaterialSource.RECYCLE.value, parts[1] if len(parts) > 1 else None
    return MaterialSource.LIBRARY.value, None


class MaterialIndexer:
    def __init__(self, session: Session) -> None:
        self.repo = MaterialRepository(session)

    # ── 从磁盘扫描 ────────────────────────────────────────────
    def index_directory(self, root: Path) -> IndexReport:
        report = IndexReport()
        if not root.is_dir():
            report.failures.append(f"素材根目录不存在：{root}")
            return report

        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.suffix.lower() not in IMAGE_EXTS:
                continue
            try:
                rel = str(path.relative_to(root))
                source, article_id = _classify(rel)
                width, height = _read_dimensions(path)
                if width is None:
                    report.failures.append(f"无法读取图片尺寸（Pillow）：{rel}")
                stat = path.stat()
                _, created = self.repo.upsert(
                    rel,
                    filename=path.name,
                    stem=path.stem,
                    ext=path.suffix.lower(),
                    source=source,
                    article_id=article_id,
                    size_bytes=stat.st_size,
                    width=width,
                    height=height,
                    mtime=int(stat.st_mtime),
                )
                if created:
                    report.created += 1
                else:
                    report.updated += 1
            except Exception as exc:  # 单条失败不影响整体，但必须记账
                report.failures.append(f"{path}: {exc}")
        return report

    # ── 从归档 JSON 导入（image_index.json + tags.json） ──────
    def index_from_archive_json(
        self, image_index_path: Path, tags_path: Path | None = None
    ) -> IndexReport:
        report = IndexReport()
        if not image_index_path.is_file():
            report.failures.append(f"image_index.json 不存在：{image_index_path}")
            return report

        try:
            index_data = json.loads(image_index_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            report.failures.append(f"image_index.json 解析失败：{exc}")
            return report

        tags_by_name: dict[str, dict] = {}
        if tags_path and tags_path.is_file():
            try:
                raw_tags = json.loads(tags_path.read_text(encoding="utf-8"))
                for article_id, files in raw_tags.items():
                    # `_meta` 之类的非素材节点直接跳过（归档里确实存在）
                    if article_id.startswith("_") or not isinstance(files, dict):
                        continue
                    for filename, meta in files.items():
                        if not isinstance(meta, dict):
                            continue
                        tags_by_name.setdefault(filename, {**meta, "article_id": article_id})
            except (OSError, json.JSONDecodeError) as exc:
                report.failures.append(f"tags.json 解析失败（已跳过标签）：{exc}")

        for rel, meta in (index_data.get("images") or {}).items():
            try:
                path = Path(rel)
                source, article_id = _classify(rel)
                tag_meta = tags_by_name.get(path.name, {})
                _, created = self.repo.upsert(
                    rel,
                    filename=path.name,
                    stem=path.stem,
                    ext=path.suffix.lower(),
                    source=source,
                    article_id=article_id or tag_meta.get("article_id"),
                    work=meta.get("work") or tag_meta.get("work"),
                    episode=str(meta["episode"]) if meta.get("episode") is not None else None,
                    kind=meta.get("type"),
                    scene=tag_meta.get("scene"),
                    purpose=tag_meta.get("purpose"),
                    characters=tag_meta.get("characters") or None,
                    tags=tag_meta.get("auto_tags") or None,
                    size_bytes=meta.get("size"),
                )
                if created:
                    report.created += 1
                else:
                    report.updated += 1
            except Exception as exc:
                report.failures.append(f"{rel}: {exc}")

        return report
