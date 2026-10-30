"""Corrige o trigger updated_at de confirmacoes_pendentes

Revision ID: 005_fix_confirmacoes_trigger
Revises: 004_historico_atendimentos
Create Date: 2026-10-30 00:00:00.000000

A tabela não tem a coluna updated_at, mas o trigger set_updated_at() estava
instalado nela: todo UPDATE (inclusive marcar a confirmação como respondida
ao receber o "sim") falhava e a ação do CRM nunca era gravada.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '005_fix_confirmacoes_trigger'
down_revision: Union[str, None] = '004_historico_atendimentos'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_updated_at ON confirmacoes_pendentes")


def downgrade() -> None:
    pass
