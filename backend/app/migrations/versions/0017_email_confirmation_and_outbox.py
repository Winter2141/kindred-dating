"""email confirmation and outbox

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-03 02:59:27.943850
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "outbox_emails",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("to", sa.String(length=255), nullable=False),
        sa.Column("subject", sa.String(length=200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("outbox_emails", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_outbox_emails_to"), ["to"], unique=False)

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("email_verified_at")

    with op.batch_alter_table("outbox_emails", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_outbox_emails_to"))

    op.drop_table("outbox_emails")
