"""Allow entity-annotation chat actions that highlight an existing subject.

Revision ID: 011
Revises: 010
Create Date: 2026-08-28

"""
from typing import Sequence, Union

from alembic import op


revision: str = "011"
down_revision: Union[str, None] = "010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_chat_action_type", "chat_actions", type_="check")
    op.create_check_constraint(
        "ck_chat_action_type",
        "chat_actions",
        "action_type IN ('redefine', 'add_entity', 'annotate_entity')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_chat_action_type", "chat_actions", type_="check")
    op.create_check_constraint(
        "ck_chat_action_type",
        "chat_actions",
        "action_type IN ('redefine', 'add_entity')",
    )
