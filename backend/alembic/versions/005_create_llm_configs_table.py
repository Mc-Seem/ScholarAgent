"""Create llm_configs table for multi-provider LLM settings

Revision ID: 005
Revises: 63000da90103
Create Date: 2026-07-05

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '005'
down_revision: Union[str, None] = '63000da90103'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'llm_configs',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('provider', sa.String(64), nullable=False),
        sa.Column('base_url', sa.String(512), nullable=True),
        sa.Column('api_key_enc', sa.Text(), nullable=True),
        sa.Column('models', sa.JSON(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
    )
    op.create_index('idx_llm_configs_active', 'llm_configs', ['is_active'])


def downgrade() -> None:
    op.drop_index('idx_llm_configs_active', table_name='llm_configs')
    op.drop_table('llm_configs')