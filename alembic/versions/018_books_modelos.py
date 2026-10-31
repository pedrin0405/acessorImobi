"""Modelos de book de imóveis (PDF)

Revision ID: 018_books_modelos
Revises: 017_fluxo_atendimentos
Create Date: 2026-10-31 10:00:00.000000

Cada imobiliária tem seus modelos de book (identidade visual e conteúdo do PDF). Os três de fábrica são criados
na primeira consulta; um deles é o padrão, usado pelo agente e pelas ações rápidas quando nenhum é escolhido.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '018_books_modelos'
down_revision: Union[str, None] = '017_fluxo_atendimentos'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS book_modelos (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            nome        VARCHAR(80) NOT NULL,
            padrao      BOOLEAN NOT NULL DEFAULT FALSE,
            sistema     BOOLEAN NOT NULL DEFAULT FALSE,
            config      JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_book_modelo_padrao ON book_modelos(tenant_id) WHERE padrao")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_book_modelo_nome ON book_modelos(tenant_id, lower(nome))")
    op.execute("ALTER TABLE book_modelos ENABLE ROW LEVEL SECURITY")
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'book_modelos' AND policyname = 'tenant_isolation') THEN
                CREATE POLICY tenant_isolation ON book_modelos USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS book_modelos CASCADE")
