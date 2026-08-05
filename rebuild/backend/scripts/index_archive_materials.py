"""把归档素材索引（image_index.json + tags.json）导入 materials 表。

只读归档、只写本项目数据库；不修改 phase0-archive 任何文件。

用法：
    python scripts/index_archive_materials.py [归档 assets 目录]
默认目录：../../phase0-archive/assets
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db.base import session_scope  # noqa: E402
from app.services.image_matching.indexer import MaterialIndexer  # noqa: E402


def main() -> int:
    assets = (
        Path(sys.argv[1])
        if len(sys.argv) > 1
        else ROOT.parents[1] / "phase0-archive" / "assets"
    )
    image_index = assets / "image_index.json"
    tags = assets / "tags.json"

    print(f"[索引] 来源：{assets}")
    with session_scope() as session:
        report = MaterialIndexer(session).index_from_archive_json(image_index, tags)

    print(f"[索引] 新增 {report.created} / 更新 {report.updated} / 失败 {len(report.failures)}")
    for line in report.failures[:10]:
        print(f"  ✗ {line}")
    # 绝不静默成功：一条素材都没入库时以非零码退出
    if report.total == 0:
        print("[索引] 失败：没有任何素材入库")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
