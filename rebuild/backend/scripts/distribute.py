#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""四平台一键分发 CLI（国漫项目专用）

复用项目原生四平台生成 / 导出引擎（GenerationService + config/platforms.yaml），
一条命令出「今日头条 / 百家号 / B站 / 小红书」四版 Markdown，
每平台一个文件，可直接复制粘贴进各平台编辑器。

为什么不复用 content-repurposer：
  那个 skill 默认平台是 Twitter/LinkedIn/IG/Threads，且只是「改写工具」。
  项目后端已按国漫四平台的标题上限 / 字数 / 小红书纯文字等规则做了深度优化，
  直接走后端原生引擎产出的版本才是最贴合需求的。

用法:
  # 深度文（默认）
  python distribute.py --topic "沧元图最新一集解析：孟川的破局逻辑"

  # 资讯 / 盘点文
  python distribute.py --type info --topic "本周必追国漫 Top5"

  # 长选题从文件读（也支持管道：echo "选题" | python distribute.py --type info）
  python distribute.py --topic-file topic.md --out-dir dist

  # 只出部分平台
  python distribute.py --topic "..." --platforms toutiao,xhs

依赖: requests（后端 venv 已装）。建议用受管 Python 跑：
  /Users/wuhao/.workbuddy/binaries/python/envs/default/bin/python3 distribute.py --topic "..."

注意:
  - 后端必须已启动（默认 http://127.0.0.1:8000）。
  - 调用真实 AI（ZHIPU_API_KEY），会消耗额度。
  - 默认 persist=True，会把四版草稿落库到 articles 表（status=draft）。
"""

from __future__ import annotations

import argparse
import datetime as _dt
import sys
from pathlib import Path

try:
    import requests
except ImportError:  # pragma: no cover
    sys.stderr.write("缺少 requests：请用受管 Python 运行（已装 requests 2.34）。\n")
    raise

DEFAULT_PLATFORMS = ["toutiao", "baijia", "bilibili", "xhs"]
PLATFORM_LABEL = {
    "toutiao": "今日头条",
    "baijia": "百家号",
    "bilibili": "B站",
    "xhs": "小红书",
}


def _read_topic(args: argparse.Namespace) -> str:
    if args.topic and args.topic != "-":
        return args.topic.strip()
    if args.topic_file:
        p = Path(args.topic_file)
        if not p.exists():
            sys.exit(f"[x] --topic-file 不存在: {p}")
        return p.read_text(encoding="utf-8").strip()
    # stdin
    if not sys.stdin.isatty():
        data = sys.stdin.read().strip()
        if data:
            return data
    sys.exit("[x] 未提供选题：用 --topic / --topic-file，或从 stdin 管道传入。")


def _post_generate(base_url: str, article_id: str, payload: dict) -> dict:
    url = f"{base_url}/articles/{article_id}/generate"
    try:
        r = requests.post(url, json=payload, timeout=300)
    except requests.ConnectionError:
        sys.exit(
            f"[x] 连不上后端 {base_url}。\n"
            f"    先启动后端：\n"
            f"    /Users/wuhao/.workbuddy/binaries/python/envs/default/bin/python3 -m uvicorn app.main:app "
            f"--host 127.0.0.1 --port 8000 --reload\n"
            f"    （在 rebuild/backend/ 目录下运行）"
        )
    if r.status_code == 503:
        body = r.json() if r.content else {}
        sys.exit(f"[x] 后端返回 503（AI 不可用）：{body.get('message', r.text)}")
    if r.status_code == 502:
        body = r.json() if r.content else {}
        sys.exit(f"[x] 后端返回 502（AI 调用失败）：{body.get('message', r.text)}")
    if r.status_code >= 400:
        sys.exit(f"[x] 生成失败 HTTP {r.status_code}：{r.text[:500]}")
    return r.json()


def _export_platform(base_url: str, article_id: str, platform: str) -> str | None:
    url = f"{base_url}/articles/{article_id}/export"
    try:
        r = requests.get(url, params={"platform": platform}, timeout=30)
    except requests.ConnectionError:
        return None
    if not r.ok:
        return None
    data = r.json()
    content = data.get("content", "")
    # 后端对「无内容」平台会写占位提示，识别并视为空
    if "（该平台暂无内容）" in content:
        return None
    return content or None


def _platform_from_result(result: dict, platform: str) -> str | None:
    contents = (result or {}).get("contents") or {}
    return contents.get(platform)


def _run_qa(base_url: str, article_id: str) -> dict | None:
    url = f"{base_url}/articles/{article_id}/qa"
    try:
        r = requests.post(url, timeout=30)
    except requests.ConnectionError:
        return None
    if not r.ok:
        return None
    return r.json()


def main() -> None:
    ap = argparse.ArgumentParser(description="国漫四平台一键分发 CLI")
    ap.add_argument("--topic", help="选题（主题句）；传 - 表示从 stdin 读")
    ap.add_argument("--topic-file", help="从文件读选题（长文友好）")
    ap.add_argument("--type", choices=["depth", "info"], default="depth",
                    help="depth=深度文 / info=资讯盘点文（默认 depth）")
    ap.add_argument("--requirement", default="", help="额外要求，只会进 user prompt")
    ap.add_argument("--article-id", help="指定 article_id（缺省自动生成）；复用已有 id 会覆盖重生成")
    ap.add_argument("--platforms", default=",".join(DEFAULT_PLATFORMS),
                    help="逗号分隔的子集，如 toutiao,xhs（默认全四平台）")
    ap.add_argument("--provider", default=None, help="zhipu（默认）| mock")
    ap.add_argument("--no-persist", action="store_true", help="不落库（平台文件改从生成结果拼装）")
    ap.add_argument("--no-combined", action="store_true", help="不额外写「全平台合集」文件")
    ap.add_argument("--export-only", action="store_true",
                    help="不重新生成，只把已落库 article_id 的四平台内容导出成文件（需配合 --article-id）")
    ap.add_argument("--qa", action="store_true", help="生成后跑一次质检并打印摘要")
    ap.add_argument("--base-url", default="http://127.0.0.1:8000", help="后端地址")
    ap.add_argument("--out-dir", default=None, help="输出目录（默认 国漫/分发输出）")
    args = ap.parse_args()

    if args.export_only:
        if not args.article_id:
            sys.exit("[x] --export-only 必须配合 --article-id（指定已落库的稿件）。")
        topic = args.topic or args.article_id
        titles: dict = {}
        result: dict = {}
        gen = {"persisted": True, "result": {}}
        print(f"[*] 导出模式 article_id={args.article_id}")
    else:
        topic = _read_topic(args)
        if not topic:
            sys.exit("[x] 选题为空。")

    platforms = [p.strip() for p in args.platforms.split(",") if p.strip()] or DEFAULT_PLATFORMS
    unknown = [p for p in platforms if p not in PLATFORM_LABEL]
    if unknown:
        sys.exit(f"[x] 未知平台 {unknown}，可选：{DEFAULT_PLATFORMS}")

    # 输出目录：默认 <workspace>/分发输出
    if args.out_dir:
        out_dir = Path(args.out_dir).expanduser().resolve()
    else:
        workspace = Path(__file__).resolve().parents[3]  # scripts->backend->rebuild->国漫
        out_dir = workspace / "分发输出"
    out_dir.mkdir(parents=True, exist_ok=True)

    ts = _dt.datetime.now().strftime("%Y%m%d%H%M%S")
    article_id = args.article_id or f"cli-{ts}"

    payload = {
        "topic": topic,
        "article_type": args.type,
        "requirement": args.requirement,
        "provider": args.provider,
        "match_images": True,
        "render": True,
        "persist": not args.no_persist,
        "strict": False,
        "include_html": False,
    }

    if args.export_only:
        ok_flag = None
    else:
        print(f"[*] 生成中（{args.type}）article_id={article_id} ...")
        gen = _post_generate(args.base_url, article_id, payload)
        result = gen.get("result", {}) or {}
        titles = result.get("titles", {}) or {}
        ok_flag = result.get("ok")
        print(f"[✓] 生成完成 persisted={gen.get('persisted')} qa_ok={ok_flag}")

    written: list[tuple[str, Path, int]] = []

    # 逐平台导出 / 拼装
    for p in platforms:
        content = None
        if not args.no_persist:
            content = _export_platform(args.base_url, article_id, p)
        if content is None:
            # 回退：从生成结果直接取（--no-persist 或不落库时无 export 内容）
            content = _platform_from_result(result, p)
        if not content:
            print(f"    ! 平台 {PLATFORM_LABEL.get(p, p)}：无内容，跳过")
            continue
        fname = f"{article_id}_{p}.md"
        fpath = out_dir / fname
        fpath.write_text(content, encoding="utf-8")
        written.append((p, fpath, len(content)))
        title = titles.get(p, "")
        title_hint = f" 《{title}》" if title else ""
        print(f"    ✓ {PLATFORM_LABEL.get(p, p)}{title_hint} -> {fpath.name} ({len(content)} 字)")

    # 全平台合集
    if not args.no_combined:
        combined = _export_platform(args.base_url, article_id, "") if not args.no_persist else None
        if combined is None:
            parts = []
            for p, _, _ in written:
                c = _platform_from_result(result, p) or ""
                parts.append(f"## {PLATFORM_LABEL.get(p, p)}\n\n{c}\n\n---")
            combined = f"# {topic}\n\n" + "\n".join(parts) + "\n"
        cpath = out_dir / f"{article_id}_all.md"
        cpath.write_text(combined, encoding="utf-8")
        print(f"[✓] 合集 -> {cpath.name}")

    # 质检摘要（可选）
    if args.qa:
        qa = _run_qa(args.base_url, article_id)
        if qa:
            ok = qa.get("ok")
            print(f"[*] 质检 ok={ok}")
            per = qa.get("per_platform") or qa.get("platforms") or {}
            for p, rep in (per.items() if isinstance(per, dict) else []):
                issues = rep.get("issues") or [] if isinstance(rep, dict) else []
                flag = "✓" if not issues else "!"
                print(f"    {flag} {PLATFORM_LABEL.get(p, p)}: {len(issues)} 个问题")
        else:
            print("[!] 质检调用失败（跳过）")

    print(f"\n[✓] 完成，共 {len(written)} 个平台文件 -> {out_dir}")
    for p, fpath, n in written:
        print(f"    {PLATFORM_LABEL.get(p, p):<6} {fpath}")


if __name__ == "__main__":
    main()
