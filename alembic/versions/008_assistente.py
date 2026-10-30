"""Conversas do assistente de IA do portal da imobiliária

Revision ID: 008_assistente
Revises: 007_midia_mensagens
Create Date: 2026-10-30 00:00:00.000000

Cada administrador tem as próprias conversas com o assistente do Início
(histórico, busca e "continuar de onde parou"). Os anexos não são guardados:
só nome e tipo, para exibir no histórico.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '008_assistente'
down_revision: Union[str, None] = '007_midia_mensagens'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABELAS = ["assistente_conversas", "assistente_mensagens"]


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS assistente_conversas (
            id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            admin_id    UUID NOT NULL,
            titulo      VARCHAR(120) NOT NULL DEFAULT 'Nova conversa',
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_assistente_conversas_admin
        ON assistente_conversas(tenant_id, admin_id, updated_at DESC)
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS assistente_mensagens (
            id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            conversa_id  UUID NOT NULL REFERENCES assistente_conversas(id) ON DELETE CASCADE,
            papel        VARCHAR(10) NOT NULL CHECK (papel IN ('user','assistant')),
            conteudo     TEXT NOT NULL,
            anexos       JSONB NOT NULL DEFAULT '[]',
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_assistente_mensagens_conversa
        ON assistente_mensagens(conversa_id, created_at)
    """)
    for tabela in TABELAS:
        op.execute(f"ALTER TABLE {tabela} ENABLE ROW LEVEL SECURITY")
        op.execute(f"""
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_policies
                    WHERE tablename = '{tabela}' AND policyname = 'tenant_isolation'
                ) THEN
                    CREATE POLICY tenant_isolation ON {tabela}
                    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
                END IF;
            END $$;
        """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS assistente_mensagens CASCADE")
    op.execute("DROP TABLE IF EXISTS assistente_conversas CASCADE")
