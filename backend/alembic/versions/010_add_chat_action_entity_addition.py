"""Support entity-addition chat actions alongside definition rewrites.

Revision ID: 010
Revises: 009
Create Date: 2026-08-26

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "chat_actions",
        sa.Column("action_type", sa.String(length=32), server_default="redefine", nullable=False),
    )
    op.add_column("chat_actions", sa.Column("payload", sa.JSON(), nullable=True))
    op.alter_column(
        "chat_actions",
        "subject_id",
        existing_type=sa.String(length=128),
        nullable=True,
    )
    op.create_check_constraint(
        "ck_chat_action_type",
        "chat_actions",
        "action_type IN ('redefine', 'add_entity')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_chat_action_type", "chat_actions", type_="check")
    op.alter_column(
        "chat_actions",
        "subject_id",
        existing_type=sa.String(length=128),
        nullable=False,
    )
    op.drop_column("chat_actions", "payload")
    op.drop_column("chat_actions", "action_type")
