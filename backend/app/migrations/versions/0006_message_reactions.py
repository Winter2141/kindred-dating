"""message reactions

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-02 22:52:52.293934
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reactions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("message_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("emoji", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id", "user_id", name="uq_reactions_message_user"),
    )
    with op.batch_alter_table("reactions", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_reactions_message_id"), ["message_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("reactions", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_reactions_message_id"))

    op.drop_table("reactions")
