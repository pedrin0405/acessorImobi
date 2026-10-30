"""Mídia das mensagens (foto do imóvel e áudios) para o portal

Revision ID: 007_midia_mensagens
Revises: 006_vozes_clonadas
Create Date: 2026-10-30 00:00:00.000000

`midia_url` guarda a URL pública da foto (http...) ou a chave do arquivo no
MinIO (s3:<tenant>/<corretor>/<id>.ogg). O portal só enxerga o arquivo do
MinIO por uma rota autenticada da API.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '007_midia_mensagens'
down_revision: Union[str, None] = '006_vozes_clonadas'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE mensagens ADD COLUMN IF NOT EXISTS midia_url TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE mensagens DROP COLUMN IF EXISTS midia_url")
