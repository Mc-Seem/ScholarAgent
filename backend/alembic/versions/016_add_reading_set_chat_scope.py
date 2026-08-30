"""Add reading-set scope to chat_conversations.

A conversation now belongs to exactly one scope: a paper (per-paper chat) or
a reading set (multi-paper chat). Existing per-paper conversations keep their
paper_id; the CHECK constraint enforces that exactly one scope is set.

Revision ID: 016
Revises: 015
Create Date: 2026-08-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "016"
down_revision: Union[str, None] = "015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "chat_conversations",
        sa.Column("reading_set_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_chat_conversation_reading_set",
        "chat_conversations",
        "reading_sets",
        ["reading_set_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.alter_column(
        "chat_conversations",
        "paper_id",
        existing_type=sa.String(length=64),
        nullable=True,
    )
    op.create_check_constraint(
        "ck_chat_conversation_scope",
        "chat_conversations",
        "(paper_id IS NULL) != (reading_set_id IS NULL)",
    )
    op.create_index(
        "idx_chat_conversation_reading_set_user",
        "chat_conversations",
        ["reading_set_id", "user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "idx_chat_conversation_reading_set_user",
        table_name="chat_conversations",
    )
    op.drop_constraint(
        "ck_chat_conversation_scope",
        "chat_conversations",
        type_="check",
    )
    # Reading-set conversations cannot survive a non-null paper_id.
    op.execute("DELETE FROM chat_conversations WHERE paper_id IS NULL")
    op.alter_column(
        "chat_conversations",
        "paper_id",
        existing_type=sa.String(length=64),
        nullable=False,
    )
    op.drop_constraint(
        "fk_chat_conversation_reading_set",
        "chat_conversations",
        type_="foreignkey",
    )
    op.drop_column("chat_conversations", "reading_set_id")
