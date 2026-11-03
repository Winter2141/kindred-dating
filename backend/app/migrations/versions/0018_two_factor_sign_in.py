"""two factor sign-in

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-03 03:07:51.360794
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("totp_secret", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("totp_enabled_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("totp_last_counter", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("recovery_codes", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("recovery_codes")
        batch_op.drop_column("totp_last_counter")
        batch_op.drop_column("totp_enabled_at")
        batch_op.drop_column("totp_secret")
