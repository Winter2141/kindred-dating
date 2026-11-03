"""likes with comments

Revision ID: 0021
Revises: 0020
Create Date: 2026-11-03 03:54:58.216395
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("swipes", schema=None) as batch_op:
        batch_op.add_column(sa.Column("liked_item", sa.String(length=140), nullable=True))
        batch_op.add_column(sa.Column("comment", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("swipes", schema=None) as batch_op:
        batch_op.drop_column("comment")
        batch_op.drop_column("liked_item")
