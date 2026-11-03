"""date reminders

Revision ID: 0022
Revises: 0021
Create Date: 2026-11-03 04:01:37.703312
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("date_proposals", schema=None) as batch_op:
        batch_op.add_column(sa.Column("reminded_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("date_proposals", schema=None) as batch_op:
        batch_op.drop_column("reminded_at")
