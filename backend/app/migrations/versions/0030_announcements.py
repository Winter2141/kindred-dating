"""announcements

Revision ID: 0030
Revises: 0029
Create Date: 2026-11-04 00:31:23.159910
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0030"
down_revision: str | None = "0029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "announcements",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("author_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(length=80), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("tone", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("announcements", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_announcements_created_at"), ["created_at"], unique=False
        )

    op.create_table(
        "announcement_dismissals",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("announcement_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["announcement_id"], ["announcements.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "announcement_id", name="uq_announcement_dismissals_pair"),
    )
    with op.batch_alter_table("announcement_dismissals", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_announcement_dismissals_announcement_id"),
            ["announcement_id"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("announcement_dismissals", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_announcement_dismissals_announcement_id"))

    op.drop_table("announcement_dismissals")
    with op.batch_alter_table("announcements", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_announcements_created_at"))

    op.drop_table("announcements")
