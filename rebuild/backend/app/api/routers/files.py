"""项目文件浏览（Phase 6）。

「项目文件」屏需要的最小面：列出项目里的文档 / 设计稿 / 规则源，支持上传。

安全边界（重要）：
    - 只读列表限定在 FILES_ROOT 内，且按扩展名白名单 + 目录黑名单过滤，
      不递归进 node_modules / .git / .next / 归档目录。
    - 写入只允许落在 FILES_ROOT/uploads/。
    - 删除只允许删 uploads/ 下的文件；越界一律 403，绝不「顺手」删项目源文件。
"""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel

from app.core.settings import settings

router = APIRouter(tags=["files"])

UPLOAD_DIRNAME = "uploads"
MAX_BYTES = 50 * 1024 * 1024
MAX_DEPTH = 3
MAX_ENTRIES = 400

EXCLUDE_DIRS = {
    "node_modules", ".git", ".next", "__pycache__", ".venv", "venv",
    ".pytest_cache", ".mypy_cache", "dist", "build", ".idea", ".vscode",
    ".workbuddy", "_cleanup_trash", "phase0-archive", "配图", ".DS_Store",
}

KIND_BY_EXT: dict[str, str] = {
    ".ardot": "设计稿",
    ".md": "文档",
    ".pdf": "文档",
    ".docx": "文档",
    ".txt": "文档",
    ".yaml": "规则源",
    ".yml": "规则源",
    ".json": "数据",
    ".csv": "数据",
    ".png": "图片",
    ".jpg": "图片",
    ".jpeg": "图片",
    ".webp": "图片",
}

_UNSAFE = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


class FileOut(BaseModel):
    name: str
    rel_path: str
    kind: str
    size_bytes: int
    updated_at: str
    deletable: bool


class FileListResponse(BaseModel):
    root: str
    total: int
    items: list[FileOut]


def _uploads_dir() -> Path:
    return settings.files_root / UPLOAD_DIRNAME


def _to_out(path: Path, root: Path) -> FileOut:
    stat = path.stat()
    rel = path.relative_to(root)
    uploads = _uploads_dir()
    deletable = uploads in path.parents
    return FileOut(
        name=path.name,
        rel_path=str(rel),
        kind=KIND_BY_EXT.get(path.suffix.lower(), "其他"),
        size_bytes=stat.st_size,
        updated_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
        .astimezone()
        .strftime("%Y-%m-%d %H:%M"),
        deletable=deletable,
    )


def _walk(root: Path) -> list[Path]:
    out: list[Path] = []
    stack: list[tuple[Path, int]] = [(root, 0)]
    while stack and len(out) < MAX_ENTRIES:
        current, depth = stack.pop()
        try:
            entries = sorted(current.iterdir())
        except OSError:
            continue
        for entry in entries:
            if entry.name.startswith(".") or entry.name in EXCLUDE_DIRS:
                continue
            if entry.is_dir():
                if depth + 1 <= MAX_DEPTH:
                    stack.append((entry, depth + 1))
                continue
            if entry.suffix.lower() in KIND_BY_EXT:
                out.append(entry)
                if len(out) >= MAX_ENTRIES:
                    break
    return out


SORT_KEYS = ("updated", "name", "size", "kind")


@router.get("/files", response_model=FileListResponse)
def list_files(
    sort: str = Query("updated", description="updated / name / size / kind"),
    keyword: str | None = None,
) -> FileListResponse:
    if sort not in SORT_KEYS:
        raise HTTPException(422, f"未知排序 {sort!r}，可选：{list(SORT_KEYS)}")

    root = settings.files_root
    if not root.is_dir():
        raise HTTPException(
            503,
            {
                "code": "FILES_ROOT_NOT_FOUND",
                "message": f"项目文件根目录不存在：{root}",
            },
        )

    items = [_to_out(p, root) for p in _walk(root)]
    if keyword:
        low = keyword.lower()
        items = [i for i in items if low in i.name.lower() or low in i.rel_path.lower()]

    if sort == "name":
        items.sort(key=lambda i: i.name)
    elif sort == "size":
        items.sort(key=lambda i: i.size_bytes, reverse=True)
    elif sort == "kind":
        items.sort(key=lambda i: (i.kind, i.name))
    else:
        items.sort(key=lambda i: i.updated_at, reverse=True)

    return FileListResponse(root=str(root), total=len(items), items=items)


@router.post("/files", response_model=FileOut, status_code=201)
async def upload_file(
    file: UploadFile = File(...),
    subdir: str | None = Form(None, description="uploads 下的可选子目录"),
) -> FileOut:
    root = settings.files_root
    raw_name = unicodedata.normalize("NFC", (file.filename or "").strip())
    name = _UNSAFE.sub("_", raw_name).strip(". ")
    if not name:
        raise HTTPException(422, {"code": "INVALID_FILENAME", "message": "文件名为空或非法"})
    if Path(name).suffix.lower() not in KIND_BY_EXT:
        raise HTTPException(
            422,
            {
                "code": "UNSUPPORTED_EXT",
                "message": f"不支持的文件类型，可选：{sorted(KIND_BY_EXT)}",
            },
        )

    blob = await file.read()
    if not blob:
        raise HTTPException(422, {"code": "EMPTY_FILE", "message": "上传内容为空"})
    if len(blob) > MAX_BYTES:
        raise HTTPException(
            422,
            {"code": "FILE_TOO_LARGE", "message": f"超过上限 {MAX_BYTES // 1024 // 1024} MB"},
        )

    directory = _uploads_dir()
    if subdir:
        clean = _UNSAFE.sub("_", unicodedata.normalize("NFC", subdir)).strip("./ ")
        if clean:
            directory = directory / clean
    directory.mkdir(parents=True, exist_ok=True)

    target = directory / name
    stem, suffix = Path(name).stem, Path(name).suffix
    n = 2
    while target.exists():
        target = directory / f"{stem}_{n}{suffix}"
        n += 1
    target.write_bytes(blob)

    return _to_out(target, root)


@router.delete("/files", status_code=200)
def delete_file(rel_path: str = Query(..., description="相对 FILES_ROOT 的路径")) -> dict:
    root = settings.files_root
    target = (root / rel_path).resolve()
    uploads = _uploads_dir().resolve()

    if uploads not in target.parents:
        # 只允许删自己传上来的东西，项目源文件一律拒绝
        raise HTTPException(
            403,
            {
                "code": "DELETE_OUT_OF_UPLOADS",
                "message": "仅允许删除 uploads/ 目录下的文件，项目源文件不可通过接口删除",
            },
        )
    if not target.is_file():
        raise HTTPException(404, {"code": "FILE_NOT_FOUND", "message": f"文件不存在：{rel_path}"})

    try:
        target.unlink()
    except OSError as e:
        # 绝不假装删除成功：任何文件系统失败都原样上报，由前端如实显示错误。
        raise HTTPException(
            500,
            {"code": "DELETE_FAILED", "message": f"删除失败（未被静默）：{e}"},
        )
    return {"deleted": True, "rel_path": rel_path}
