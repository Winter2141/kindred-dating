"""profile views

Revision ID: 0029
Revises: 0028
Create Date: 2026-11-04 00:24:18.734028
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0029"
down_revision: str | None = "0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "profile_views",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("viewer_id", sa.Integer(), nullable=False),
        sa.Column("viewed_id", sa.Integer(), nullable=False),
        sa.Column("times", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("first_viewed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("viewed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["viewed_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["viewer_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("viewer_id", "viewed_id", name="uq_profile_views_pair"),
    )
    with op.batch_alter_table("profile_views", schema=None) as batch_op:
        batch_op.create_index(
            "ix_profile_views_viewed_at", ["viewed_id", "viewed_at"], unique=False
        )

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("browse_privately", sa.Boolean(), server_default=sa.false(), nullable=False)
        )


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("browse_privately")

    with op.batch_alter_table("profile_views", schema=None) as batch_op:
        batch_op.drop_index("ix_profile_views_viewed_at")

    op.drop_table("profile_views")
