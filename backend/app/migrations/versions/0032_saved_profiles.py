"""saved profiles

Revision ID: 0032
Revises: 0031
Create Date: 2026-11-04 00:45:51.519737
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0032"
down_revision: str | None = "0031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "saved_profiles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("saved_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["saved_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "saved_id", name="uq_saved_profiles_pair"),
    )
    with op.batch_alter_table("saved_profiles", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_saved_profiles_user_id"), ["user_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("saved_profiles", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_saved_profiles_user_id"))

    op.drop_table("saved_profiles")
