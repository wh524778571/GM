"""drop weekly_plan table

Revision ID: a1b2c3d4e5f6
Revises: d2f3a4b5c6e7
Create Date: 2026-08-09 20:45:00.000000

周计划功能已下线（前端 /weekly 屏 + 后端 /weekly-plan 路由/模型/仓储/测试已移除）。
本迁移把遗留的 weekly_plan 表及其索引真正 DROP 掉，保持数据库干净。
注意：原 phase2 迁移（fa99cadad32b）同时给 tracking 加了 revenue_cents 列，
本迁移不动它，只删 weekly_plan。
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "d2f3a4b5c6e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 幂等：本工程 DB 由 create_all 引导（无 alembic_version），
    # 且部分环境表可能已不存在，故先探测再删，避免 "no such table" 失败。
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("weekly_plan"):
        return
    with op.batch_alter_table("weekly_plan", schema=None) as batch_op:
        batch_op.drop_index("ix_weekly_plan_week_start")
        batch_op.drop_index("ix_weekly_plan_article_id")
    op.drop_table("weekly_plan")


def downgrade() -> None:
    op.create_table(
        "weekly_plan",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("week_start", sa.String(length=10), nullable=False),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("article_id", sa.String(length=200), nullable=True),
        sa.Column("platform", sa.String(length=20), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("weekly_plan", schema=None) as batch_op:
        batch_op.create_index("ix_weekly_plan_article_id", ["article_id"], unique=False)
        batch_op.create_index("ix_weekly_plan_week_start", ["week_start"], unique=False)
