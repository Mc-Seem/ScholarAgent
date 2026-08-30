"""Create reading set tables for explicit multi-paper groups.

Revision ID: 013
Revises: 012
Create Date: 2026-08-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "013"
down_revision: Union[str, None] = "012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "reading_sets",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "reading_set_papers",
        sa.Column("reading_set_id", sa.String(length=36), nullable=False),
        sa.Column("paper_id", sa.String(length=64), nullable=False),
        sa.Column("added_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["reading_set_id"],
            ["reading_sets.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["paper_id"], ["papers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("reading_set_id", "paper_id"),
    )
    op.create_index(
        "idx_reading_set_paper_paper",
        "reading_set_papers",
        ["paper_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_reading_set_paper_paper", table_name="reading_set_papers")
    op.drop_table("reading_set_papers")
    op.drop_table("reading_sets")
