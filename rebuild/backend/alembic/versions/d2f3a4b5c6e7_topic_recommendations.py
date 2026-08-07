"""topic_recommendations（今日推荐选题池）

Revision ID: d2f3a4b5c6e7
Revises: c7a1e9d40b12
Create Date: 2026-08-06

新增 topic_recommendations：存储每日推荐选题 + 去重键 + 黑名单标记。
开发环境由 app.main 的 create_all 兜底；生产由 alembic 管理（本迁移）。
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd2f3a4b5c6e7'
down_revision: Union[str, None] = 'c7a1e9d40b12'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'topic_recommendations',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('topic_key', sa.String(length=120), nullable=False),
        sa.Column('date', sa.String(length=10), nullable=False),
        sa.Column('title', sa.String(length=300), nullable=False),
        sa.Column('topic_type', sa.String(length=20), nullable=False),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('angle', sa.Text(), nullable=True),
        sa.Column('article_type', sa.String(length=20), nullable=False),
        sa.Column('blacklisted', sa.Boolean(), nullable=False),
        sa.Column('recommend_count', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('topic_key'),
    )
    with op.batch_alter_table('topic_recommendations', schema=None) as batch_op:
        batch_op.create_index('ix_topic_recommendations_date', ['date'], unique=False)
        batch_op.create_index('ix_topic_recommendations_blacklisted', ['blacklisted'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('topic_recommendations', schema=None) as batch_op:
        batch_op.drop_index('ix_topic_recommendations_blacklisted')
        batch_op.drop_index('ix_topic_recommendations_date')
    op.drop_table('topic_recommendations')
