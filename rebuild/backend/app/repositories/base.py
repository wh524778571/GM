"""Repository 基类。

所有数据访问必须继承本类并接收外部 Session —— 仓储自身不建连接，
从根子上杜绝旧系统「裸连 DB」（坑 6）。
"""

from __future__ import annotations

from typing import Generic, TypeVar

from sqlalchemy.orm import Session

from app.db.base import Base

ModelT = TypeVar("ModelT", bound=Base)


class BaseRepository(Generic[ModelT]):
    model: type[ModelT]

    def __init__(self, session: Session) -> None:
        self.session = session

    def get(self, pk: int) -> ModelT | None:
        return self.session.get(self.model, pk)

    def add(self, obj: ModelT) -> ModelT:
        self.session.add(obj)
        self.session.flush()
        return obj

    def delete(self, obj: ModelT) -> None:
        self.session.delete(obj)
        self.session.flush()

    def count(self) -> int:
        from sqlalchemy import func, select

        return int(self.session.scalar(select(func.count()).select_from(self.model)) or 0)
