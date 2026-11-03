"""call log messages

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-03 03:28:30.381955
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("messages", schema=None) as batch_op:
        batch_op.add_column(sa.Column("call_kind", sa.String(length=8), nullable=True))
        batch_op.add_column(sa.Column("call_ms", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("messages", schema=None) as batch_op:
        batch_op.drop_column("call_ms")
        batch_op.drop_column("call_kind")
