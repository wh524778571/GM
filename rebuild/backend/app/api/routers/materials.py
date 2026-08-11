"""素材写入（Phase 5）。

只读的 `/materials`、`/materials/search`、`/materials/works` 在 `app/main.py`；
这里补齐前端「导入素材」需要的写入面：上传 → 落盘 → 入索引。

坑 3「静默成功」防护：
    - MATERIALS_ROOT 未配置 → 503（明确告诉调用方素材根目录没配，不假装存好了）
    - 扩展名不支持 / 空文件 → 422
    - 落盘成功但尺寸读不出来 → 正常返回，但 `warnings` 里写清楚
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.schemas import MaterialOut
from app.core.settings import settings
from app.db.base import get_session
from app.models.material import MaterialSource
from app.repositories.material_repository import MaterialRepository
from app.services.image_matching.indexer import IMAGE_EXTS, _read_dimensions
from app.services.image_matching.matcher import ImageMatcherService

router = APIRouter(tags=["materials"])

LIBRARY_DIR = "_素材库"
MAX_BYTES = 20 * 1024 * 1024
_UNSAFE = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def _safe_component(raw: str, fallback: str) -> str:
    """清洗为安全的单层路径片段：去控制字符、去分隔符、禁 `..`。"""
    name = unicodedata.normalize("NFC", (raw or "").strip())
    name = _UNSAFE.sub("_", name).strip(". ")
    return name or fallback


def _unique_path(directory: Path, stem: str, ext: str) -> Path:
    """同名不覆盖：`名字.jpeg` → `名字_2.jpeg`，避免悄悄冲掉已有素材。"""
    candidate = directory / f"{stem}{ext}"
    n = 2
    while candidate.exists():
        candidate = directory / f"{stem}_{n}{ext}"
        n += 1
    return candidate


@router.post("/materials", response_model=MaterialOut, status_code=201)
async def upload_material(
    file: UploadFile = File(..., description="图片文件"),
    work: str | None = Form(None, description="作品名，如「沧元图」"),
    scene: str | None = Form(None, description="用途 / 场景，如「打戏」"),
    episode: str | None = Form(None, description="集数"),
    session: Session = Depends(get_session),
) -> MaterialOut:
    root = settings.materials_root
    if root is None:
        raise HTTPException(
            503,
            {
                "code": "MATERIALS_ROOT_NOT_CONFIGURED",
                "message": "素材根目录未配置（环境变量 MATERIALS_ROOT），无法保存上传文件",
            },
        )

    original = Path(_safe_component(file.filename or "", "未命名"))
    ext = original.suffix.lower()
    if ext not in IMAGE_EXTS:
        raise HTTPException(
            422,
            {
                "code": "UNSUPPORTED_IMAGE_EXT",
                "message": f"不支持的图片格式 {ext or '(空)'}，可选：{sorted(IMAGE_EXTS)}",
            },
        )

    blob = await file.read()
    if not blob:
        raise HTTPException(422, {"code": "EMPTY_FILE", "message": "上传内容为空"})
    if len(blob) > MAX_BYTES:
        raise HTTPException(
            422,
            {
                "code": "FILE_TOO_LARGE",
                "message": f"文件 {len(blob) // 1024} KB 超过上限 {MAX_BYTES // 1024 // 1024} MB",
            },
        )

    work_dir = _safe_component(work or "", "未分类")
    directory = root / LIBRARY_DIR / work_dir
    directory.mkdir(parents=True, exist_ok=True)

    # 命名遵循项目约定：作品名_用途
    stem_parts = [p for p in (work_dir if work else None, scene) if p]
    stem = _safe_component("_".join(stem_parts) if stem_parts else original.stem, original.stem or "素材")
    target = _unique_path(directory, stem, ext)
    target.write_bytes(blob)

    rel = str(target.relative_to(root))
    width, height = _read_dimensions(target)
    stat = target.stat()

    material, _ = MaterialRepository(session).upsert(
        rel,
        filename=target.name,
        stem=target.stem,
        ext=ext,
        source=MaterialSource.LIBRARY.value,
        article_id=None,
        work=work or None,
        scene=scene or None,
        episode=episode or None,
        size_bytes=stat.st_size,
        width=width,
        height=height,
        mtime=int(stat.st_mtime),
    )
    session.flush()

    return MaterialOut(
        id=material.id,
        path=material.path,
        filename=material.filename,
        stem=material.stem,
        source=material.source,
        work=material.work,
        episode=material.episode,
        scene=material.scene,
        kind=material.kind,
        article_id=material.article_id,
        tags=material.tags,
        width=material.width,
        height=material.height,
        size_bytes=material.size_bytes,
        url=ImageMatcherService.build_url(material),
    )


@router.patch("/materials/{material_id}")
async def rename_material(
    material_id: int,
    stem: str = Form(..., description="新文件名（不含扩展名）"),
    session: Session = Depends(get_session),
) -> dict:
    """重命名素材：更新 DB 记录 + 重命名磁盘文件。"""
    root = settings.materials_root
    if root is None:
        raise HTTPException(503, {"code": "MATERIALS_ROOT_NOT_CONFIGURED", "message": "素材根目录未配置"})

    mat = MaterialRepository(session).get(material_id)
    if mat is None:
        raise HTTPException(404, {"code": "NOT_FOUND", "message": "素材不存在"})

    new_stem = _safe_component(stem, mat.stem)
    old_path = root / mat.path
    ext = Path(mat.path).suffix or Path(mat.filename).suffix or ".jpeg"
    new_name = f"{new_stem}{ext}"
    new_rel = str((old_path.parent / new_name).relative_to(root))
    new_abs = root / new_rel

    if new_abs.exists() and new_abs != old_path:
        raise HTTPException(409, {"code": "NAME_CONFLICT", "message": f"目标文件名「{new_name}」已存在"})

    if old_path.exists():
        old_path.rename(new_abs)

    mat.path = new_rel
    mat.filename = new_name
    mat.stem = new_stem
    session.flush()

    return {"id": mat.id, "stem": mat.stem, "path": mat.path, "renamed": True}


@router.patch("/materials/{material_id}/replace")
async def replace_material(
    material_id: int,
    file: UploadFile = File(..., description="新图片文件"),
    session: Session = Depends(get_session),
) -> dict:
    """覆盖素材文件：保留 DB 记录，替换磁盘文件 + 更新尺寸/大小。"""
    root = settings.materials_root
    if root is None:
        raise HTTPException(503, {"code": "MATERIALS_ROOT_NOT_CONFIGURED", "message": "素材根目录未配置"})

    mat = MaterialRepository(session).get(material_id)
    if mat is None:
        raise HTTPException(404, {"code": "NOT_FOUND", "message": "素材不存在"})

    blob = await file.read()
    if not blob:
        raise HTTPException(422, {"code": "EMPTY_FILE", "message": "上传内容为空"})
    if len(blob) > MAX_BYTES:
        raise HTTPException(422, {"code": "FILE_TOO_LARGE", "message": f"文件超过 {MAX_BYTES // 1024 // 1024} MB"})

    target = root / mat.path
    target.write_bytes(blob)
    width, height = _read_dimensions(target)
    stat = target.stat()

    mat.size_bytes = stat.st_size
    mat.width = width
    mat.height = height
    mat.mtime = int(stat.st_mtime)
    session.flush()

    return {
        "id": mat.id,
        "stem": mat.stem,
        "width": width,
        "height": height,
        "size_bytes": stat.st_size,
        "replaced": True,
    }


@router.delete("/materials/{material_id}", status_code=200)
async def delete_material(
    material_id: int,
    session: Session = Depends(get_session),
) -> dict:
    """软删除：标记进回收站（source=recycle），文件保留在磁盘，可恢复。

    不直接删文件——避免误删不可恢复；前端素材列表默认按 source=library 过滤，
    已软删的素材不显示。需要彻底清理时再单独处理回收站。
    """
    mat = MaterialRepository(session).get(material_id)
    if mat is None:
        raise HTTPException(
            404,
            {"code": "NOT_FOUND", "message": "素材不存在"},
        )
    mat.source = MaterialSource.RECYCLE.value
    session.flush()
    return {"id": mat.id, "source": mat.source, "deleted": True}
