"""三级缓存 —— 复刻 image_matcher 的 内存(60s) → 磁盘(10min) → 全量重建。

旧实现缓存的是「素材索引 JSON」；新实现里素材真相源已入库（materials 表），
因此第 3 级从「扫盘」变为「查库」，语义与层级保持一致。
"""

from __future__ import annotations

import json
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Callable

MEMORY_TTL_SECONDS = 60
DISK_TTL_SECONDS = 600
RESULT_CACHE_MAX_ENTRIES = 50  # 最多缓存 50 篇文章的配图结果（同旧实现）


class ThreeLevelIndexCache:
    """L1 内存(60s) → L2 磁盘 JSON(10min) → L3 rebuild()。"""

    def __init__(self, disk_path: Path) -> None:
        self.disk_path = disk_path
        self._lock = threading.Lock()
        self._memory: dict[str, Any] | None = None
        self._memory_ts = 0.0
        self.last_source: str = "none"  # memory / disk / rebuild —— 显式可观测

    def get(self, rebuild: Callable[[], dict[str, Any]]) -> dict[str, Any]:
        now = time.time()
        with self._lock:
            if self._memory is not None and (now - self._memory_ts) < MEMORY_TTL_SECONDS:
                self.last_source = "memory"
                return self._memory

            if self.disk_path.is_file():
                age = now - self.disk_path.stat().st_mtime
                if age < DISK_TTL_SECONDS:
                    try:
                        data = json.loads(self.disk_path.read_text(encoding="utf-8"))
                        self._memory = data
                        self._memory_ts = now
                        self.last_source = "disk"
                        return data
                    except (OSError, json.JSONDecodeError):
                        # 磁盘缓存损坏：不静默沿用，直接落到 L3 重建
                        pass

            data = rebuild()
            self._memory = data
            self._memory_ts = now
            self.last_source = "rebuild"
            try:
                self.disk_path.parent.mkdir(parents=True, exist_ok=True)
                self.disk_path.write_text(
                    json.dumps(data, ensure_ascii=False), encoding="utf-8"
                )
            except OSError:
                # 磁盘缓存写失败不影响本次结果，但要能被看见
                self.last_source = "rebuild(disk-write-failed)"
            return data

    def invalidate(self) -> None:
        with self._lock:
            self._memory = None
            self._memory_ts = 0.0
            if self.disk_path.is_file():
                try:
                    self.disk_path.unlink()
                except OSError:
                    pass


class ResultCache:
    """文章级配图结果缓存：{cache_key: {index: url}}，LRU 上限 50。"""

    def __init__(self, max_entries: int = RESULT_CACHE_MAX_ENTRIES) -> None:
        self.max_entries = max_entries
        self._lock = threading.Lock()
        self._data: OrderedDict[str, dict[int, str]] = OrderedDict()

    def get(self, cache_key: str, index: int) -> str | None:
        with self._lock:
            bucket = self._data.get(cache_key)
            if bucket is None:
                return None
            self._data.move_to_end(cache_key)
            return bucket.get(index)

    def set(self, cache_key: str, index: int, url: str) -> None:
        with self._lock:
            bucket = self._data.setdefault(cache_key, {})
            bucket[index] = url
            self._data.move_to_end(cache_key)
            while len(self._data) > self.max_entries:
                self._data.popitem(last=False)

    def clear(self, cache_key: str | None = None) -> None:
        with self._lock:
            if cache_key is None:
                self._data.clear()
            else:
                self._data.pop(cache_key, None)

    def size(self) -> int:
        with self._lock:
            return len(self._data)
