#!/usr/bin/env python
"""提示词逐字校验：`app/services/ai/prompts.py`  vs  归档原文。

用法：
    python scripts/verify_prompt_parity.py

比对对象：
    SYSTEM_PROMPT   账号人设（「Yolo的国漫笔记」调性）
    PROMPTS_BASE    depth / weitoutiao / info 三个生成模板

归档文件用 `ast` **静态解析**取常量，不 import、不执行、不写入，
`phase0-archive/` 保持只读。任何一处不一致都以非零码退出，
CI / 人工都能立刻发现「人设被人偷偷改了」。
"""

from __future__ import annotations

import ast
import difflib
import hashlib
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

ARCHIVE_FILE = (
    BACKEND_ROOT.parents[1] / "phase0-archive" / "prompts" / "gen_article_from_request.py"
)

from app.services.ai import prompts  # noqa: E402


def load_archive_constants(path: Path) -> dict[str, object]:
    """静态解析归档模块顶层的字面量常量（不执行任何归档代码）。"""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found: dict[str, object] = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id in ("SYSTEM_PROMPT", "PROMPTS_BASE"):
                found[target.id] = ast.literal_eval(node.value)
    return found


def diff(name: str, expected: str, actual: str) -> list[str]:
    return list(
        difflib.unified_diff(
            expected.splitlines(), actual.splitlines(),
            fromfile=f"archive/{name}", tofile=f"rebuild/{name}", lineterm="",
        )
    )


def main() -> int:
    if not ARCHIVE_FILE.exists():
        print(f"❌ 找不到归档文件：{ARCHIVE_FILE}")
        return 2

    archive = load_archive_constants(ARCHIVE_FILE)
    missing = [k for k in ("SYSTEM_PROMPT", "PROMPTS_BASE") if k not in archive]
    if missing:
        print(f"❌ 归档文件里解析不到常量：{missing}")
        return 2

    failures = 0

    print("── SYSTEM_PROMPT ────────────────────────────────")
    if archive["SYSTEM_PROMPT"] == prompts.SYSTEM_PROMPT:
        print(f"✅ 逐字一致（{len(prompts.SYSTEM_PROMPT)} 字，"
              f"指纹 {prompts.system_prompt_fingerprint()}）")
    else:
        failures += 1
        print("❌ 与归档不一致：")
        for line in diff("SYSTEM_PROMPT", archive["SYSTEM_PROMPT"], prompts.SYSTEM_PROMPT):
            print("   " + line)

    print("── PROMPTS_BASE ─────────────────────────────────")
    archive_templates: dict = archive["PROMPTS_BASE"]  # type: ignore[assignment]
    if set(archive_templates) != set(prompts.PROMPTS_BASE):
        failures += 1
        print(f"❌ 模板键不一致：归档 {sorted(archive_templates)}"
              f" / 现网 {sorted(prompts.PROMPTS_BASE)}")
    for key in sorted(set(archive_templates) & set(prompts.PROMPTS_BASE)):
        expected, actual = archive_templates[key], prompts.PROMPTS_BASE[key]
        if expected == actual:
            digest = hashlib.sha256(actual.encode("utf-8")).hexdigest()[:8]
            print(f"✅ {key:<11} 逐字一致（{len(actual)} 字，{digest}）")
        else:
            failures += 1
            print(f"❌ {key} 与归档不一致：")
            for line in diff(key, expected, actual):
                print("   " + line)

    print("─────────────────────────────────────────────────")
    if failures:
        print(f"❌ {failures} 处漂移。人设/模板是账号调性的唯一权威源，请勿擅改。")
        return 1
    print("✅ 提示词与归档完全一致，账号人设未漂移。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
