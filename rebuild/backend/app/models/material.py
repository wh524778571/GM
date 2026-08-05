"""materials 表 —— 素材库索引（825+ 张配图入库，供模糊匹配服务检索）。

字段来源：
    phase0-archive/assets/image_index.json  → work / episode / type / size
    phase0-archive/assets/tags.json         → work / characters / scene / purpose / auto_tags
    素材索引.json（旧素材库内）             → 字幕文本 / 关键词
"""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import JSON, DateTime, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.article import utcnow


class MaterialSource(str, enum.Enum):
    LIBRARY = "library"    # _素材库/
    ARTICLE = "article"    # _文章配图/{article_id}/
    RECYCLE = "recycle"    # _回收站/


class Material(Base):
    __tablename__ = "materials"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # 相对素材根目录的路径，唯一
    path: Mapped[str] = mapped_column(String(500), unique=True, nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    stem: Mapped[str] = mapped_column(String(255), nullable=False)
    ext: Mapped[str] = mapped_column(String(10), nullable=False)

    source: Mapped[str] = mapped_column(String(20), nullable=False, default=MaterialSource.LIBRARY.value)
    # 素材归属文章（source=article/recycle 时有值），非外键：素材可先于文章存在
    article_id: Mapped[str | None] = mapped_column(String(200))

    work: Mapped[str | None] = mapped_column(String(100))      # 作品名，如「沧元图」
    episode: Mapped[str | None] = mapped_column(String(20))    # 集数
    scene: Mapped[str | None] = mapped_column(String(100))     # 场景，如「打戏」
    purpose: Mapped[str | None] = mapped_column(String(100))   # 用途，如「打戏/战斗」
    kind: Mapped[str | None] = mapped_column(String(30))       # screenshot / poster ...

    subtitle: Mapped[str | None] = mapped_column(Text)         # 字幕文本（匹配权重最高）
    keywords: Mapped[list | None] = mapped_column(JSON)        # 索引关键词
    characters: Mapped[list | None] = mapped_column(JSON)      # 角色
    tags: Mapped[list | None] = mapped_column(JSON)            # auto_tags

    size_bytes: Mapped[int | None] = mapped_column(Integer)
    width: Mapped[int | None] = mapped_column(Integer)         # Pillow 读取，禁用 sips
    height: Mapped[int | None] = mapped_column(Integer)
    mtime: Mapped[int | None] = mapped_column(Integer)         # 用于 URL cache-busting

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    __table_args__ = (
        Index("ix_materials_work_episode", "work", "episode"),
        Index("ix_materials_source", "source"),
        Index("ix_materials_article_id", "article_id"),
        Index("ix_materials_stem", "stem"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Material {self.path} work={self.work}>"
