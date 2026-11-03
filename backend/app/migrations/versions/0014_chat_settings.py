"""chat settings

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-03 02:32:25.791183
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "chat_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("match_id", sa.Integer(), nullable=False),
        sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("muted_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "match_id", name="uq_chat_settings_user_match"),
    )
    with op.batch_alter_table("chat_settings", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_chat_settings_match_id"), ["match_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("chat_settings", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_chat_settings_match_id"))

    op.drop_table("chat_settings")
