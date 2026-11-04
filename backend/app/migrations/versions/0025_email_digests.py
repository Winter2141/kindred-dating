"""email digests

Revision ID: 0025
Revises: 0024
Create Date: 2026-11-03 20:52:51.972430
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0025"
down_revision: str | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("email_prefs", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("digest_sent_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("digest_sent_at")
        batch_op.drop_column("email_prefs")
