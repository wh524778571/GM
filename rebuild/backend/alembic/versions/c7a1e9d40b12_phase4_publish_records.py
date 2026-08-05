"""phase4 publish records (honest manual-publish ledger)

Revision ID: c7a1e9d40b12
Revises: fa99cadad32b
Create Date: 2026-08-04

新增 publish_records：逐平台记录「人是否真的发过」。
没有行 = pending（待人工发布），这是默认态，不需要也不允许预写。
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c7a1e9d40b12'
down_revision: Union[str, None] = 'fa99cadad32b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'publish_records',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('article_id', sa.String(length=200), nullable=False),
        sa.Column('platform', sa.String(length=20), nullable=False),
        sa.Column('state', sa.String(length=20), nullable=False),
        sa.Column('posted_url', sa.String(length=500), nullable=True),
        sa.Column('confirmed_by', sa.String(length=100), nullable=True),
        sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ['article_id'], ['articles.article_id'], ondelete='CASCADE', onupdate='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('article_id', 'platform', name='uq_publish_article_platform'),
    )
    with op.batch_alter_table('publish_records', schema=None) as batch_op:
        batch_op.create_index('ix_publish_records_article_id', ['article_id'], unique=False)
        batch_op.create_index('ix_publish_records_state', ['state'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('publish_records', schema=None) as batch_op:
        batch_op.drop_index('ix_publish_records_state')
        batch_op.drop_index('ix_publish_records_article_id')
    op.drop_table('publish_records')
