"""Blocos ricos nas respostas do assistente (cartões de imóveis e book em PDF)

Revision ID: 020_assistente_blocos
Revises: 019_books_novos_modelos
Create Date: 2026-10-31 20:00:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = '020_assistente_blocos'
down_revision: Union[str, None] = '019_books_novos_modelos'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE assistente_mensagens ADD COLUMN IF NOT EXISTS blocos JSONB NOT NULL DEFAULT '[]'::jsonb")


def downgrade() -> None:
    op.execute("ALTER TABLE assistente_mensagens DROP COLUMN IF EXISTS blocos")
