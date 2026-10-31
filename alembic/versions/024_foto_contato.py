"""Foto de perfil do contato (cliente) nos atendimentos

Revision ID: 024_foto_contato
Revises: 023_tipo_contato
Create Date: 2026-11-02 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = '024_foto_contato'
down_revision: Union[str, None] = '023_tipo_contato'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE atendimentos
            ADD COLUMN IF NOT EXISTS foto_ref TEXT,
            ADD COLUMN IF NOT EXISTS foto_atualizada_em TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS foto_tentada_em TIMESTAMPTZ
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE atendimentos DROP COLUMN IF EXISTS foto_ref, DROP COLUMN IF EXISTS foto_atualizada_em, DROP COLUMN IF EXISTS foto_tentada_em")
