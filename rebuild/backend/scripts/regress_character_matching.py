#!/usr/bin/env python3
"""角色名 / 作品名配图匹配回归测试（跑真实 materials 表，不用 mock）。

背景：Phase 1 的 `extract_keywords` 用「单字分隔符」切中文，`飞/看/望/冲` 等常用字
把多字专名劈开（`择日飞升` → `择日`）；且整词命中文件名只有 3 分，低于
`MIN_REUSE_SCORE = 5`，导致 `南宫婉` / `孟川` / `韩立` 这类完整角色名查询
即便把正确素材排在第 1 位也会被阈值挡回 `None`。本脚本把这些用例固化成回归。

用例分三类，**任何一类不符合预期都会以非 0 退出**（不静默成功）：
    stem   期望命中某一张确定素材（角色名 / 专有实体查询）
    work   期望命中该作品下任意一张素材（作品名这类泛指查询）
    none   语料里根本没有该角色 → 必须返回 None，不许瞎配（防误配回归）

用法：
    python scripts/regress_character_matching.py            # 断言模式，失败退出 1
    python scripts/regress_character_matching.py --verbose  # 额外打印候选 Top3
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db.base import session_scope  # noqa: E402
from app.services.image_matching.matcher import (  # noqa: E402
    MIN_REUSE_SCORE,
    ImageMatcherService,
    clear_caches,
)
from app.services.text_utils import extract_keywords  # noqa: E402

STEM = "stem"
WORK = "work"
PREFIX = "prefix"
NONE = "none"


@dataclass
class Case:
    query: str
    kind: str
    expected: str
    note: str = ""


# 期望值全部来自 materials 表里真实存在的素材（见 scripts 头部说明）
CASES: list[Case] = [
    # ── 完整角色名：修复前全部 MISS（best score 3 < 阈值 5） ──
    Case("南宫婉", STEM, "凡人修仙传_南宫婉蓄势", "核心缺陷用例"),
    Case("孟川", STEM, "沧元图第87集_21分01秒_孟川是我们大越的恩人", "核心缺陷用例"),
    Case("南宫阙", PREFIX, "凡人修仙传_南宫阙", "6 张同名素材，任一即可"),
    Case("韩立", PREFIX, "凡人修仙传_韩立", "韩立飞天 / 韩立大战"),
    # ── 专有实体（法宝 / 地名） ──
    Case("血魔剑", STEM, "凡人修仙传_血魔剑爆发"),
    Case("北海之眼", STEM, "遮天_北海之眼脱困"),
    # ── 作品名：泛指查询，命中同作品任意素材即可 ──
    Case("凡人修仙传", WORK, "凡人修仙传"),
    Case("沧元图", WORK, "沧元图"),
    Case("择日飞升", WORK, "择日飞升", "修复前被切成「择日」"),
    Case("遮天", WORK, "遮天", "2 字作品名"),
    Case("仙逆", WORK, "仙逆", "2 字作品名"),
    # ── 2 字部分姓名：应回落到对应角色的素材 ──
    Case("南宫", PREFIX, "凡人修仙传_南宫", "复姓前缀，南宫婉/南宫阙均可"),
    # ── 组合描述：作品名 + 角色名，角色名必须压过作品名标签 ──
    Case("凡人修仙传南宫婉蓄势", STEM, "凡人修仙传_南宫婉蓄势", "防标签劫持"),
    Case("配图1：韩立飞天", PREFIX, "凡人修仙传_韩立", "带占位符前缀"),
    # ── 语料中不存在：必须 None，禁止误配 ──
    Case("石毅", NONE, "", "完美世界角色，语料无此作品"),
    Case("慕兰", NONE, "", "语料无此角色"),
    Case("完美世界", NONE, "", "语料无此作品"),
    Case("唐三", NONE, "", "语料无此角色"),
]


def check(case: Case, hit) -> tuple[bool, str]:
    if case.kind == NONE:
        if hit is None:
            return True, "None（符合预期，未误配）"
        return False, f"不该命中却返回了「{hit.stem}」(score={hit.score})"
    if hit is None:
        return False, f"MISS —— 期望 {case.kind}={case.expected}"
    if case.kind == STEM:
        ok = hit.stem == case.expected
    elif case.kind == PREFIX:
        ok = hit.stem.startswith(case.expected)
    else:  # WORK
        ok = hit.work == case.expected
    return ok, f"{hit.stem} (work={hit.work}, score={hit.score}, {hit.reason})"


def main() -> int:
    parser = argparse.ArgumentParser(description="角色名配图匹配回归")
    parser.add_argument("--verbose", action="store_true", help="打印候选 Top3")
    args = parser.parse_args()

    clear_caches()  # 保证跑的是真实重建路径，而不是上一次运行留下的磁盘缓存

    failures: list[str] = []
    with session_scope() as session:
        service = ImageMatcherService(session)
        total_materials = len(service.repo.list(limit=100_000))
        if total_materials == 0:
            print("✗ materials 表为空，无法回归。先跑 scripts/index_archive_materials.py")
            return 2

        print(f"素材总数: {total_materials}   复用阈值 MIN_REUSE_SCORE={MIN_REUSE_SCORE}")
        print("-" * 100)
        print(f"{'查询':<22}{'类型':<8}{'结果':<6}实际命中")
        print("-" * 100)

        for case in CASES:
            hit = service.match_placeholder(1, case.query, "")
            ok, detail = check(case, hit)
            flag = "PASS" if ok else "FAIL"
            pad = 22 - sum(2 if ord(ch) > 0x2E80 else 1 for ch in case.query)
            print(f"{case.query}{' ' * max(1, pad)}{case.kind:<8}{flag:<6}{detail}")
            if args.verbose:
                kws = extract_keywords(case.query)
                top = service.search(kws, limit=3)
                print(f"{'':<22}关键词={kws} Top3={[(h.stem, h.score) for h in top]}")
            if not ok:
                failures.append(f"{case.query} → {detail}" + (f"  [{case.note}]" if case.note else ""))

    print("-" * 100)
    passed = len(CASES) - len(failures)
    print(f"通过 {passed}/{len(CASES)}  命中率 {passed / len(CASES):.0%}")
    if failures:
        print("\n失败用例：")
        for line in failures:
            print(f"  ✗ {line}")
        return 1
    print("全部通过 ✓")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
