"""Add the active knowledge-graph snapshot to chat actions.

Revision ID: 009
Revises: 008
Create Date: 2026-08-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "chat_actions",
        sa.Column("knowledge_graph_version", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("chat_actions", "knowledge_graph_version")