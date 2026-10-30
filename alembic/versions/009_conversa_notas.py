"""Notas internas nas conversas do portal

Revision ID: 009_conversa_notas
Revises: 008_assistente
Create Date: 2026-10-30 00:00:00.000000

Anotações da equipe (administrador/secretaria) sobre a conversa com um
corretor. Ficam só no portal: nunca são enviadas pelo WhatsApp.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '009_conversa_notas'
down_revision: Union[str, None] = '008_assistente'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS conversa_notas (
            id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            corretor_id UUID NOT NULL REFERENCES corretores(id) ON DELETE CASCADE,
            autor       VARCHAR(255) NOT NULL,
            texto       TEXT NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_conversa_notas_corretor
        ON conversa_notas(tenant_id, corretor_id, created_at)
    """)
    op.execute("ALTER TABLE conversa_notas ENABLE ROW LEVEL SECURITY")
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE tablename = 'conversa_notas' AND policyname = 'tenant_isolation'
            ) THEN
                CREATE POLICY tenant_isolation ON conversa_notas
                USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS conversa_notas CASCADE")
