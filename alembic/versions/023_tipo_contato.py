"""Tipo de contato do atendimento escolhido pelo corretor

Revision ID: 023_tipo_contato
Revises: 022_site_padrao
Create Date: 2026-11-02 10:00:00.000000

A IA classifica cada conversa como imobiliária ou não e às vezes erra. O corretor pode fixar o tipo
(imobiliário, pessoal ou outro); a análise passa a respeitar a escolha e conversas pessoais deixam de ser lidas.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '023_tipo_contato'
down_revision: Union[str, None] = '022_site_padrao'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS tipo_contato VARCHAR(12)")
    op.execute("ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS tipo_manual BOOLEAN NOT NULL DEFAULT FALSE")


def downgrade() -> None:
    op.execute("ALTER TABLE atendimentos DROP COLUMN IF EXISTS tipo_manual")
    op.execute("ALTER TABLE atendimentos DROP COLUMN IF EXISTS tipo_contato")
