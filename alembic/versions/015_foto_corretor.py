"""Foto do corretor vinda do perfil do WhatsApp

Revision ID: 015_foto_corretor
Revises: 014_funil_automatico
Create Date: 2026-10-30 00:00:00.000000

- foto_ref: referência `s3:<chave>` da foto guardada no MinIO (a URL do WhatsApp expira, então a imagem é copiada).
- foto_origem: 'whatsapp' ou 'manual' (foto escolhida pelo corretor/admin nunca é sobrescrita pela do WhatsApp).
- foto_tentada_em: última busca no WhatsApp, para o job diário não insistir em quem esconde a foto.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '015_foto_corretor'
down_revision: Union[str, None] = '014_funil_automatico'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE corretores
            ADD COLUMN IF NOT EXISTS foto_ref TEXT,
            ADD COLUMN IF NOT EXISTS foto_origem VARCHAR(10),
            ADD COLUMN IF NOT EXISTS foto_atualizada_em TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS foto_tentada_em TIMESTAMPTZ
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE corretores
            DROP COLUMN IF EXISTS foto_ref, DROP COLUMN IF EXISTS foto_origem,
            DROP COLUMN IF EXISTS foto_atualizada_em, DROP COLUMN IF EXISTS foto_tentada_em
    """)
