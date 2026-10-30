"""Vozes clonadas por imobiliária

Revision ID: 006_vozes_clonadas
Revises: 005_fix_confirmacoes_trigger
Create Date: 2026-10-30 00:00:00.000000

Guarda o áudio de referência (WAV mono 24 kHz, poucos segundos) e a
transcrição usados pelo TTS para clonar uma voz, junto com quem declarou ter
a autorização da pessoa que fala (LGPD: voz é dado pessoal).
"""
from typing import Sequence, Union

from alembic import op


revision: str = '006_vozes_clonadas'
down_revision: Union[str, None] = '005_fix_confirmacoes_trigger'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS vozes_clonadas (
            id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            nome            VARCHAR(60) NOT NULL,
            ref_audio       BYTEA NOT NULL,
            ref_texto       TEXT NOT NULL,
            duracao_s       NUMERIC(5,1) NOT NULL,
            autorizado_por  VARCHAR(255) NOT NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_vozes_clonadas_tenant ON vozes_clonadas(tenant_id)")
    op.execute("ALTER TABLE vozes_clonadas ENABLE ROW LEVEL SECURITY")
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE tablename = 'vozes_clonadas' AND policyname = 'tenant_isolation'
            ) THEN
                CREATE POLICY tenant_isolation ON vozes_clonadas
                USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS vozes_clonadas CASCADE")
