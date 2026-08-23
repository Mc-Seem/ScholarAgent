"""Drop the unused tooltip suggestions cache from papers.

Revision ID: 007
Revises: 006
Create Date: 2026-08-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("papers", "tooltip_suggestions_cache")


def downgrade() -> None:
    op.add_column(
        "papers",
        sa.Column("tooltip_suggestions_cache", sa.JSON(), nullable=True),
    )