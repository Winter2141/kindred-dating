"""moderation

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-02 22:40:40.582200
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("reports", schema=None) as batch_op:
        batch_op.add_column(sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("resolved_by_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_reports_resolved_by_id_users",
            "users",
            ["resolved_by_id"],
            ["id"],
            ondelete="SET NULL",
        )

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("is_admin", sa.Boolean(), server_default=sa.false(), nullable=False)
        )
        batch_op.add_column(sa.Column("banned_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("banned_at")
        batch_op.drop_column("is_admin")

    with op.batch_alter_table("reports", schema=None) as batch_op:
        batch_op.drop_constraint("fk_reports_resolved_by_id_users", type_="foreignkey")
        batch_op.drop_column("resolved_by_id")
        batch_op.drop_column("resolved_at")
