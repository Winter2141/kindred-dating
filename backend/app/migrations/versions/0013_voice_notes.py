"""voice notes

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-03 02:20:23.991602
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("messages", schema=None) as batch_op:
        batch_op.add_column(sa.Column("audio_url", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("audio_ms", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("waveform", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("messages", schema=None) as batch_op:
        batch_op.drop_column("waveform")
        batch_op.drop_column("audio_ms")
        batch_op.drop_column("audio_url")
