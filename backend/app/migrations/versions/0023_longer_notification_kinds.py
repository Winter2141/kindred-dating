"""longer notification kinds

Revision ID: 0023
Revises: 0022
Create Date: 2026-11-03 04:22:39.076581
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("notifications", schema=None) as batch_op:
        batch_op.alter_column(
            "kind",
            existing_type=sa.VARCHAR(length=16),
            type_=sa.String(length=32),
            existing_nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("notifications", schema=None) as batch_op:
        batch_op.alter_column(
            "kind",
            existing_type=sa.String(length=32),
            type_=sa.VARCHAR(length=16),
            existing_nullable=False,
        )
