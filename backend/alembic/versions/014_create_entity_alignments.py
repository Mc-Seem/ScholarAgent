"""Create entity_alignments table for reading-set term alignment.

Revision ID: 014
Revises: 013
Create Date: 2026-08-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "014"
down_revision: Union[str, None] = "013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "entity_alignments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("reading_set_id", sa.String(length=36), nullable=False),
        sa.Column("paper_a_id", sa.String(length=64), nullable=False),
        sa.Column("subject_a_id", sa.String(length=128), nullable=False),
        sa.Column("label_a", sa.String(length=512), nullable=False),
        sa.Column("paper_b_id", sa.String(length=64), nullable=False),
        sa.Column("subject_b_id", sa.String(length=128), nullable=False),
        sa.Column("label_b", sa.String(length=512), nullable=False),
        sa.Column("method", sa.String(length=16), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("confidence", sa.String(length=8), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["reading_set_id"],
            ["reading_sets.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["paper_a_id"], ["papers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["paper_b_id"], ["papers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "method IN ('deterministic', 'llm')",
            name="ck_entity_alignment_method",
        ),
        sa.CheckConstraint(
            "confidence IN ('high', 'medium', 'low')",
            name="ck_entity_alignment_confidence",
        ),
        sa.CheckConstraint(
            "status IN ('auto', 'confirmed', 'rejected', 'stale')",
            name="ck_entity_alignment_status",
        ),
        sa.UniqueConstraint(
            "reading_set_id",
            "paper_a_id",
            "subject_a_id",
            "paper_b_id",
            "subject_b_id",
            name="uq_entity_alignment_pair",
        ),
    )
    op.create_index(
        "idx_entity_alignment_set_paper_a",
        "entity_alignments",
        ["reading_set_id", "paper_a_id"],
        unique=False,
    )
    op.create_index(
        "idx_entity_alignment_set_paper_b",
        "entity_alignments",
        ["reading_set_id", "paper_b_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_entity_alignment_set_paper_b", table_name="entity_alignments")
    op.drop_index("idx_entity_alignment_set_paper_a", table_name="entity_alignments")
    op.drop_table("entity_alignments")
