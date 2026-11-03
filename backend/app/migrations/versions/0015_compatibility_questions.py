"""compatibility questions

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-03 02:39:40.323221
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "question_answers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("question_id", sa.String(length=40), nullable=False),
        sa.Column("answer", sa.Integer(), nullable=False),
        sa.Column("acceptable", sa.JSON(), nullable=False),
        sa.Column("importance", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "question_id", name="uq_question_answers_user_question"),
    )
    with op.batch_alter_table("question_answers", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_question_answers_user_id"), ["user_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("question_answers", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_question_answers_user_id"))

    op.drop_table("question_answers")
