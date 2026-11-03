"""location and distance

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-02 22:48:07.010967
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("latitude", sa.Double(), nullable=True))
        batch_op.add_column(sa.Column("longitude", sa.Double(), nullable=True))
        batch_op.add_column(
            sa.Column("max_distance_km", sa.Integer(), server_default=sa.text("50"), nullable=False)
        )
        batch_op.create_index("ix_users_location", ["latitude", "longitude"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_index("ix_users_location")
        batch_op.drop_column("max_distance_km")
        batch_op.drop_column("longitude")
        batch_op.drop_column("latitude")
