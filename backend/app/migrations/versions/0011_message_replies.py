"""message replies

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-03 02:07:06.986084
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("messages", schema=None) as batch_op:
        batch_op.add_column(sa.Column("reply_to_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_messages_reply_to_id_messages",
            "messages",
            ["reply_to_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("messages", schema=None) as batch_op:
        batch_op.drop_constraint("fk_messages_reply_to_id_messages", type_="foreignkey")
        batch_op.drop_column("reply_to_id")
