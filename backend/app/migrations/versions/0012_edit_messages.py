"""edit messages

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-03 02:12:57.198966
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("messages", schema=None) as batch_op:
        batch_op.add_column(sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("messages", schema=None) as batch_op:
        batch_op.drop_column("edited_at")
