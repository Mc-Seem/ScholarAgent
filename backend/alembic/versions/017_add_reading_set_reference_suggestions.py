"""Persist reference-suggestion runs on reading sets.

Reference suggestions used to be computed on demand and discarded, so once the
suggested papers were imported the user could never review the run again. The
new nullable JSON column stores the latest merged run:
{"generated_at": iso8601, "suggestions": [...]}.

Revision ID: 017
Revises: 016
Create Date: 2026-09-01

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "017"
down_revision: Union[str, None] = "016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "reading_sets",
        sa.Column("reference_suggestions", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("reading_sets", "reference_suggestions")
