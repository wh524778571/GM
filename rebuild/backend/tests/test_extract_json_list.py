"""_extract_json_list 回归测试。

历史坑：generation.py 的 _extract_json_list 依赖标准库 json，但文件曾漏写
`import json`，导致调用时 NameError 被 except 静默吞掉、永远返回 []。
这直接让「生成今日选题」(suggest_topics) 走不通——LLM 正常返回合法 JSON，
解析却全失败。此测试锁住「合法 JSON 数组必须被正确解析」这一契约。
"""

import sys

sys.path.insert(0, ".")

from app.services.ai.generation import _extract_json_list


def test_valid_array_parsed():
    raw = '[{"title": "x", "article_type": "depth"}]'
    out = _extract_json_list(raw)
    assert len(out) == 1
    assert out[0]["title"] == "x"


def test_array_with_surrounding_text():
    raw = "好的，这是选题：\n[{\"title\": \"a\"}, {\"title\": \"b\"}]\n完毕"
    out = _extract_json_list(raw)
    assert len(out) == 2


def test_multiple_bare_objects():
    raw = '{"title": "a"}\n{"title": "b"}'
    out = _extract_json_list(raw)
    assert len(out) == 2


def test_empty_returns_empty():
    assert _extract_json_list("") == []
    assert _extract_json_list("   ") == []


def test_non_json_returns_empty():
    assert _extract_json_list("完全不是 json") == []
