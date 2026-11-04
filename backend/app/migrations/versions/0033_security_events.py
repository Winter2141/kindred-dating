"""security events

Revision ID: 0033
Revises: 0032
Create Date: 2026-11-04 01:19:30.242215
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0033"
down_revision: str | None = "0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "security_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("user_agent", sa.String(length=255), nullable=False),
        sa.Column("ip_address", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("security_events", schema=None) as batch_op:
        batch_op.create_index(
            "ix_security_events_user_created", ["user_id", "created_at"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("security_events", schema=None) as batch_op:
        batch_op.drop_index("ix_security_events_user_created")

    op.drop_table("security_events")
