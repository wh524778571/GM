"""pytest 公共夹具。

数据库夹具用**临时文件 SQLite + 同一套 models/repositories**，
不新建任何连接方式（仍是 SQLAlchemy Engine，坑 2/6 不破）。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.db.base import Base  # noqa: E402
import app.models  # noqa: F401,E402  —— 注册全部表


@pytest.fixture(autouse=True)
def isolate_image_matcher_cache(tmp_path, monkeypatch):
    """隔离配图服务的**进程级**素材索引缓存（内存 60s → 磁盘 .cache/ 10min）。

    真机跑过 demo / 接口后，`.cache/material_index.json` 里是 825 条真实素材。
    测试用的是空的临时库，但三级缓存是模块级全局对象，磁盘那层会把上一次进程
    的索引喂回来 —— 断言就变成在测「上次留下的数据」，且真实缓存也会被测试写脏。
    这里把磁盘路径挪到 tmp_path，并换一个干净的内存实例，两边互不污染。
    """
    from app.services.image_matching import matcher
    from app.services.image_matching.cache import ResultCache, ThreeLevelIndexCache

    monkeypatch.setattr(
        matcher,
        "_index_cache",
        ThreeLevelIndexCache(tmp_path / "cache" / "material_index.json"),
    )
    monkeypatch.setattr(matcher, "_result_cache", ResultCache())


@pytest.fixture()
def session(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'test.db'}", future=True,
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    db = factory()
    try:
        yield db
        db.commit()
    finally:
        db.close()
        engine.dispose()
