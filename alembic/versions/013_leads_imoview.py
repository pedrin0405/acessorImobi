"""Leads do Imoview na carteira do portal

Revision ID: 013_leads_imoview
Revises: 012_configuracoes
Create Date: 2026-10-30 00:00:00.000000

- crm_leads.corretor_id passa a aceitar NULL: lead importado entra "sem responsável" até alguém
  atribuir (ou a roleta distribuir).
- telefone_busca (últimos 11 dígitos) acelera a busca e evita duplicar quem o corretor já anotou.
- (tenant_id, codigo_imoview) único: a importação é idempotente.
- imoview_leads_sync guarda andamento, checkpoint e resultado da importação.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '013_leads_imoview'
down_revision: Union[str, None] = '012_configuracoes'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE crm_leads ALTER COLUMN corretor_id DROP NOT NULL")
    op.execute("""
        ALTER TABLE crm_leads
            ADD COLUMN IF NOT EXISTS telefone_busca VARCHAR(15),
            ADD COLUMN IF NOT EXISTS importado_em TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS imoview_incluido_em TIMESTAMPTZ
    """)
    op.execute("""
        UPDATE crm_leads SET telefone_busca = RIGHT(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g'), 11)
        WHERE telefone IS NOT NULL AND telefone_busca IS NULL AND LENGTH(REGEXP_REPLACE(telefone, '[^0-9]', '', 'g')) >= 8
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_leads_imoview
        ON crm_leads(tenant_id, codigo_imoview) WHERE codigo_imoview IS NOT NULL
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_crm_leads_telefone ON crm_leads(tenant_id, telefone_busca) WHERE telefone_busca IS NOT NULL")
    op.execute("CREATE INDEX IF NOT EXISTS idx_crm_leads_origem ON crm_leads(tenant_id, origem, created_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_crm_leads_sem_dono ON crm_leads(tenant_id, created_at DESC) WHERE corretor_id IS NULL")
    op.execute("""
        CREATE TABLE IF NOT EXISTS imoview_leads_sync (
            tenant_id         UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
            estado            VARCHAR(12) NOT NULL DEFAULT 'ocioso'
                                  CHECK (estado IN ('ocioso','executando','ok','erro')),
            origem            VARCHAR(12),
            modo              VARCHAR(12),
            etapa             VARCHAR(40),
            iniciado_em       TIMESTAMPTZ,
            concluido_em      TIMESTAMPTZ,
            ultimo_sucesso_em TIMESTAMPTZ,
            total_remoto      INT NOT NULL DEFAULT 0,
            ultimo_total      INT NOT NULL DEFAULT 0,
            processados       INT NOT NULL DEFAULT 0,
            novos             INT NOT NULL DEFAULT 0,
            atualizados       INT NOT NULL DEFAULT 0,
            vinculados        INT NOT NULL DEFAULT 0,
            checkpoint        INT,
            erro              TEXT,
            atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("ALTER TABLE imoview_leads_sync ENABLE ROW LEVEL SECURITY")
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE tablename = 'imoview_leads_sync' AND policyname = 'tenant_isolation'
            ) THEN
                CREATE POLICY tenant_isolation ON imoview_leads_sync
                USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS imoview_leads_sync CASCADE")
    op.execute("DROP INDEX IF EXISTS uq_crm_leads_imoview")
