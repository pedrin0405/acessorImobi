"""Importação incremental das conversas do WhatsApp pessoal

Revision ID: 004_historico_atendimentos
Revises: 003_assistente_pessoal
Create Date: 2026-10-30 00:00:00.000000

Guarda até quando as mensagens do número pessoal já foram importadas da
Evolution: cobre o histórico recente ao conectar e mensagens perdidas no
intervalo entre o pareamento e a verificação do número.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '004_historico_atendimentos'
down_revision: Union[str, None] = '003_assistente_pessoal'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS historico_importado_ate TIMESTAMPTZ")


def downgrade() -> None:
    op.execute("ALTER TABLE whatsapp_sessions DROP COLUMN IF EXISTS historico_importado_ate")
