"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-11-02 22:28:02.750893
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("birthdate", sa.Date(), nullable=False),
        sa.Column("gender", sa.String(length=16), nullable=False),
        sa.Column("interested_in", sa.JSON(), nullable=False),
        sa.Column("age_min", sa.Integer(), nullable=False),
        sa.Column("age_max", sa.Integer(), nullable=False),
        sa.Column("bio", sa.Text(), nullable=False),
        sa.Column("job_title", sa.String(length=80), nullable=False),
        sa.Column("city", sa.String(length=80), nullable=False),
        sa.Column("interests", sa.JSON(), nullable=False),
        sa.Column("photos", sa.JSON(), nullable=False),
        sa.Column("prompts", sa.JSON(), nullable=False),
        sa.Column("is_persona", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("age_min <= age_max", name="ck_users_age_range"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_users_email"), ["email"], unique=True)

    op.create_table(
        "matches",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_a_id", sa.Integer(), nullable=False),
        sa.Column("user_b_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("user_a_id < user_b_id", name="ck_matches_order"),
        sa.ForeignKeyConstraint(["user_a_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_b_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_a_id", "user_b_id", name="uq_matches_pair"),
    )
    with op.batch_alter_table("matches", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_matches_user_a_id"), ["user_a_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_matches_user_b_id"), ["user_b_id"], unique=False)

    op.create_table(
        "swipes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("swiper_id", sa.Integer(), nullable=False),
        sa.Column("target_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(length=8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["swiper_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("swiper_id", "target_id", name="uq_swipes_pair"),
    )
    with op.batch_alter_table("swipes", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_swipes_target_id"), ["target_id"], unique=False)

    op.create_table(
        "messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("match_id", sa.Integer(), nullable=False),
        sa.Column("sender_id", sa.Integer(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("messages", schema=None) as batch_op:
        batch_op.create_index("ix_messages_match_id_id", ["match_id", "id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("messages", schema=None) as batch_op:
        batch_op.drop_index("ix_messages_match_id_id")

    op.drop_table("messages")
    with op.batch_alter_table("swipes", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_swipes_target_id"))

    op.drop_table("swipes")
    with op.batch_alter_table("matches", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_matches_user_b_id"))
        batch_op.drop_index(batch_op.f("ix_matches_user_a_id"))

    op.drop_table("matches")
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_users_email"))

    op.drop_table("users")
