"""date proposals

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-02 23:19:26.150158
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "date_proposals",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("match_id", sa.Integer(), nullable=False),
        sa.Column("proposer_id", sa.Integer(), nullable=False),
        sa.Column("place", sa.String(length=120), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["proposer_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("date_proposals", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_date_proposals_match_id"), ["match_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("date_proposals", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_date_proposals_match_id"))

    op.drop_table("date_proposals")
