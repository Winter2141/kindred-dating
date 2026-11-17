"""report evidence

Revision ID: 0034
Revises: 0033
Create Date: 2026-11-17 11:14:54.042687
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0034"
down_revision: str | None = "0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("reports", schema=None) as batch_op:
        batch_op.add_column(sa.Column("evidence", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("reports", schema=None) as batch_op:
        batch_op.drop_column("evidence")
