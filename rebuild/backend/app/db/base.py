"""SQLAlchemy 基础设施：唯一 Engine / SessionFactory。

坑 2 / 坑 6 防护：全工程只有此处创建连接，业务代码一律走 Repository。
任何新增的 `sqlite3.connect` 或第二个 create_engine 都视为回归。
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.settings import settings


class Base(DeclarativeBase):
    """所有 ORM 模型的基类，Alembic autogenerate 依赖它的 metadata。"""


def _engine_kwargs(url: str) -> dict:
    if url.startswith("sqlite"):
        # SQLite 在多线程 ASGI 下需要放开线程检查
        return {"connect_args": {"check_same_thread": False}}
    return {}


engine = create_engine(settings.database_url, future=True, **_engine_kwargs(settings.database_url))

SessionFactory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


@contextmanager
def session_scope() -> Iterator[Session]:
    """事务边界。异常一律回滚并向上抛出——禁止吞异常造成静默成功（坑 3）。"""
    session = SessionFactory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_session() -> Iterator[Session]:
    """FastAPI 依赖注入用的 session 提供器。"""
    with session_scope() as session:
        yield session
