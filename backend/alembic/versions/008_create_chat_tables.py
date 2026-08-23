"""Create chat persistence tables.

Revision ID: 008
Revises: 007
Create Date: 2026-08-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    users = op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.bulk_insert(users, [{"id": 1}])

    op.create_table(
        "chat_conversations",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("paper_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), server_default="1", nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["paper_id"], ["papers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_chat_conversation_paper_user",
        "chat_conversations",
        ["paper_id", "user_id"],
        unique=False,
    )

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("conversation_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("context_snapshot", sa.JSON(), nullable=True),
        sa.Column("citations", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("role IN ('user', 'assistant')", name="ck_chat_message_role"),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["chat_conversations.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_chat_message_conversation_id",
        "chat_messages",
        ["conversation_id", "id"],
        unique=False,
    )

    op.create_table(
        "chat_actions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("source_message_id", sa.Integer(), nullable=False),
        sa.Column("subject_id", sa.String(length=128), nullable=False),
        sa.Column("base_definition", sa.Text(), nullable=True),
        sa.Column("proposed_definition", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'confirmed', 'rejected', 'stale')",
            name="ck_chat_action_status",
        ),
        sa.ForeignKeyConstraint(
            ["source_message_id"],
            ["chat_messages.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_message_id", name="uq_chat_action_source_message"),
    )


def downgrade() -> None:
    op.drop_table("chat_actions")
    op.drop_index("idx_chat_message_conversation_id", table_name="chat_messages")
    op.drop_table("chat_messages")
    op.drop_index("idx_chat_conversation_paper_user", table_name="chat_conversations")
    op.drop_table("chat_conversations")
    op.drop_table("users")