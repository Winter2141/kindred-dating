"""travel mode

Revision ID: 0028
Revises: 0027
Create Date: 2026-11-04 00:07:12.497749
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0028"
down_revision: str | None = "0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("travel_place", sa.String(length=80), nullable=True))
        batch_op.add_column(sa.Column("travel_latitude", sa.Double(), nullable=True))
        batch_op.add_column(sa.Column("travel_longitude", sa.Double(), nullable=True))
        batch_op.add_column(sa.Column("travel_until", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("travel_until")
        batch_op.drop_column("travel_longitude")
        batch_op.drop_column("travel_latitude")
        batch_op.drop_column("travel_place")
