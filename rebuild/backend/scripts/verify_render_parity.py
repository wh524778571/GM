#!/usr/bin/env python
"""渲染服务 1:1 回归校验：新 RenderService  vs  归档 md_renderer.gen_body。

用法：
    python scripts/verify_render_parity.py

归档实现只读导入，不修改 phase0-archive/。为满足其 `from config import ...`
依赖，脚本在临时目录里生成最小桩模块。

允许的有意偏差（安全修复，坑 7「字符串模板注入」）：
    1. 缺图占位块不再输出内联 onclick="openImagePicker(...)"
    2. 文案「点击此处从图片库选择」→「请从素材库选择」
除此之外要求逐平台字符级一致；任何新增差异都会让本脚本以非零码退出。
"""

from __future__ import annotations

import difflib
import re
import sys
import tempfile
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_CODE = BACKEND_ROOT.parents[1] / "phase0-archive" / "code"

STUB_CONFIG = '''
from pathlib import Path
WORKSPACE = Path("{tmp}")
IMG_DIR = WORKSPACE / "配图"
ARTICLE_IMG_DIR = IMG_DIR / "_文章配图"
IMG_BASE_URL = "/images"
IMAGE_EXTS = {{".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}}
'''

STUB_MATCHER = '''
import hashlib
import re

def find_and_load(num, desc, cache_key):
    if "缺" in desc:
        return "", "", ""
    return f"/images/demo/{num}.jpeg", "", "image/jpeg"

def suggest_filename(description):
    key = re.sub(r"^【配图\\\\d+[：:]", "", description).replace("】", "").strip()
    if not key:
        key = re.sub(r"\\\\s+", "_", description.strip())
    safe = re.sub(r'[<>:"/\\\\\\\\|?*]', "", key)[:40]
    if not safe:
        safe = hashlib.md5(description.encode()).hexdigest()[:8]
    return f"{safe}.jpeg"
'''

SAMPLES = [
    """# 沧元图 S2 第 21 集：孟川破境

追了三年，这一集我是真的坐直了。分镜、配乐、节奏全在线。

【配图1：沧元图_孟川破境场景截图】

## 打戏拆解

**孟川**这一刀，分镜给了整整 18 秒。这是全季最舍得花帧数的一场。

- 第一段：起手蓄势
- 第二段：转身斩击

> 原著里这段只有两行字

【配图2：沧元图_柳七月特写】

再看一次同一张图：

【配图2：沧元图_柳七月特写】

| 维度 | 动画 | 原著 |
| --- | --- | --- |
| 节奏 | 快 | 慢 |

【配图3：缺失的图_测试占位】

（资源定位：第21集/12分30秒）

---

📷 **配图清单**
1. xxx

*@Yolo 的国漫笔记*
""",
    """## 只有正文没有图

一段纯文字内容，用来验证无占位符路径。

***

结尾互动引导：你怎么看？
""",
    """### 三级标题与代码

`inline code` 与 [链接](https://example.com) 与 ~~删除线~~。

【配图1：凡人修仙传_韩立青影从天而降】

    普通缩进段落

1. 有序一
2. 有序二
""",
]

PLATFORMS = ("toutiao", "baijia", "bilibili", "xhs")


def _normalize(text: str) -> str:
    text = re.sub(r"\s*onclick=\"openImagePicker\([^\"]*\)\"", "", text)
    return text.replace("点击此处从图片库选择", "请从素材库选择")


def main() -> int:
    if not ARCHIVE_CODE.is_dir():
        print(f"❌ 归档目录不存在，无法校验：{ARCHIVE_CODE}")
        return 2

    tmpdir = Path(tempfile.mkdtemp(prefix="render_parity_"))
    (tmpdir / "config.py").write_text(STUB_CONFIG.format(tmp=tmpdir), encoding="utf-8")
    (tmpdir / "image_matcher.py").write_text(STUB_MATCHER, encoding="utf-8")

    # 归档目录必须保持只读：禁掉 .pyc 落盘，别把 __pycache__ 写进 phase0-archive/
    sys.dont_write_bytecode = True

    sys.path.insert(0, str(ARCHIVE_CODE))
    sys.path.insert(0, str(tmpdir))
    sys.path.insert(0, str(BACKEND_ROOT))

    import md_renderer  # noqa: E402  归档实现，只读

    from app.services.rendering import RenderService  # noqa: E402

    service = RenderService(
        image_resolver=lambda num, desc, key: None if "缺" in desc else f"/images/demo/{num}.jpeg"
    )

    failed = 0
    total = 0
    for i, sample in enumerate(SAMPLES):
        for platform in PLATFORMS:
            total += 1
            cache_key = f"single:parity{i}"
            old = _normalize(md_renderer.gen_body(sample, platform, cache_key))
            new = _normalize(service.render(sample, platform, cache_key=cache_key).html)
            if old == new:
                print(f"[OK  ] sample{i} {platform:9s} len={len(old)}")
                continue
            failed += 1
            print(f"[FAIL] sample{i} {platform}")
            diff = difflib.unified_diff(old.splitlines(), new.splitlines(), "archive", "rebuild", lineterm="")
            print("\n".join(list(diff)[:30]))

    outputs = {p: service.render(SAMPLES[0], p, cache_key="single:parity0").html for p in PLATFORMS}
    distinct = len(set(outputs.values()))
    print(f"四平台输出互异性：{distinct}/{len(outputs)}")
    if distinct != len(outputs):
        failed += 1

    print(f"RESULT: {total - failed}/{total} 一致" + ("  ✅" if failed == 0 else "  ❌"))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
