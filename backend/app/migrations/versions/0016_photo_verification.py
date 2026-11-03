"""photo verification

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-03 02:45:46.007507
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "verification_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("pose", sa.String(length=32), nullable=False),
        sa.Column("selfie_url", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["reviewed_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("verification_requests", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_verification_requests_status"), ["status"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_verification_requests_user_id"), ["user_id"], unique=False
        )

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("verified_at")

    with op.batch_alter_table("verification_requests", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_verification_requests_user_id"))
        batch_op.drop_index(batch_op.f("ix_verification_requests_status"))

    op.drop_table("verification_requests")
