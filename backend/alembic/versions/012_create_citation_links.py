"""Create citation_links table for cached citation resolution.

Revision ID: 012
Revises: 011
Create Date: 2026-08-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "012"
down_revision: Union[str, None] = "011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "citation_links",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("paper_id", sa.String(length=64), nullable=False),
        sa.Column("cite_key", sa.String(length=255), nullable=False),
        sa.Column("target_paper_id", sa.String(length=64), nullable=False),
        sa.Column("target_kind", sa.String(length=16), nullable=False),
        sa.Column("target_section_id", sa.String(length=128), nullable=True),
        sa.Column("target_dom_node_id", sa.String(length=128), nullable=True),
        sa.Column("quote", sa.Text(), nullable=True),
        sa.Column("confidence", sa.String(length=8), nullable=False),
        sa.Column("target_html_version", sa.String(length=64), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["paper_id"], ["papers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_paper_id"], ["papers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "target_kind IN ('section', 'passage', 'none')",
            name="ck_citation_link_target_kind",
        ),
        sa.CheckConstraint(
            "confidence IN ('high', 'medium', 'low')",
            name="ck_citation_link_confidence",
        ),
        sa.UniqueConstraint(
            "paper_id",
            "cite_key",
            "target_paper_id",
            name="uq_citation_link_pair",
        ),
    )
    op.create_index(
        "idx_citation_link_paper_key",
        "citation_links",
        ["paper_id", "cite_key"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_citation_link_paper_key", table_name="citation_links")
    op.drop_table("citation_links")
