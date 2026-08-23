"""Distinguish reader wording from applied AI tooltip text.

Revision ID: 006
Revises: 005
Create Date: 2026-08-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Existing semantic tooltips came from the drafts flow, which had no
    # provenance flag. Treating them as graph-text overrides is what caused a
    # rebuild to label unchanged AI content as a reader edit.
    op.add_column(
        "tooltips",
        sa.Column(
            "is_user_override",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    # Draft generation only creates object/entity tooltips. Existing notation
    # and equation rows therefore came from the inline Semantic Lens editor and
    # can be preserved unambiguously; legacy object rows cannot be classified
    # reliably and stay false rather than producing spurious `edited` badges.
    op.execute(
        "UPDATE tooltips SET is_user_override = true "
        "WHERE entity_id LIKE 'notation:%' OR entity_id LIKE 'equation:%'"
    )


def downgrade() -> None:
    op.drop_column("tooltips", "is_user_override")