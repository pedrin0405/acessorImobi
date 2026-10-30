"""Integração com o Imoview no portal: cache enriquecido e status da sincronização

Revision ID: 011_imoview_integracao
Revises: 010_memoria_conversa
Create Date: 2026-10-30 00:00:00.000000

- imoveis_cache ganha `ativo` (o que sumiu do Imoview é desativado, não apagado),
  campos de filtro/ordenação (título, banheiros, suítes, condomínio, estado) e
  `busca`, texto minúsculo e sem acento para a busca da página Imóveis.
- imoview_sync_status guarda o andamento e o resultado da última sincronização.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '011_imoview_integracao'
down_revision: Union[str, None] = '010_memoria_conversa'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ACENTOS_DE = "áàâãäéèêëíìîïóòôõöúùûüç"
ACENTOS_PARA = "aaaaaeeeeiiiiooooouuuuc"


def upgrade() -> None:
    op.execute("""
        ALTER TABLE imoveis_cache
            ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS titulo TEXT,
            ADD COLUMN IF NOT EXISTS banheiros INT,
            ADD COLUMN IF NOT EXISTS suites INT,
            ADD COLUMN IF NOT EXISTS valor_condominio NUMERIC(14,2),
            ADD COLUMN IF NOT EXISTS estado VARCHAR(2),
            ADD COLUMN IF NOT EXISTS destaque BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS busca TEXT NOT NULL DEFAULT ''
    """)
    # Linhas já sincronizadas: busca por tipo, bairro, cidade e código até o próximo sync.
    op.execute(f"""
        UPDATE imoveis_cache SET busca = translate(lower(
            codigo_imoview::text || ' ' || coalesce(tipo, '') || ' ' || coalesce(bairro, '') || ' ' || coalesce(cidade, '')
        ), '{ACENTOS_DE}', '{ACENTOS_PARA}')
        WHERE busca = ''
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_imoveis_lista ON imoveis_cache(tenant_id, ativo, finalidade, valor)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_imoveis_tipo ON imoveis_cache(tenant_id, ativo, tipo)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_imoveis_bairro ON imoveis_cache(tenant_id, ativo, bairro)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_imoveis_cidade ON imoveis_cache(tenant_id, ativo, cidade)")
    # Busca por trecho (ILIKE '%x%') acelerada por trigrama, quando a extensão puder ser criada.
    op.execute("""
        DO $$ BEGIN
            CREATE EXTENSION IF NOT EXISTS pg_trgm;
            CREATE INDEX IF NOT EXISTS idx_imoveis_busca_trgm ON imoveis_cache USING gin (busca gin_trgm_ops);
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'pg_trgm indisponível: a busca de imóveis segue sem índice de trigrama';
        END $$;
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS imoview_sync_status (
            tenant_id         UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
            estado            VARCHAR(12) NOT NULL DEFAULT 'ocioso'
                                  CHECK (estado IN ('ocioso','executando','ok','erro')),
            origem            VARCHAR(12),
            etapa             VARCHAR(40),
            iniciado_em       TIMESTAMPTZ,
            concluido_em      TIMESTAMPTZ,
            ultimo_sucesso_em TIMESTAMPTZ,
            total_remoto      INT NOT NULL DEFAULT 0,
            processados       INT NOT NULL DEFAULT 0,
            novos             INT NOT NULL DEFAULT 0,
            atualizados       INT NOT NULL DEFAULT 0,
            desativados       INT NOT NULL DEFAULT 0,
            erro              TEXT,
            atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("ALTER TABLE imoview_sync_status ENABLE ROW LEVEL SECURITY")
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE tablename = 'imoview_sync_status' AND policyname = 'tenant_isolation'
            ) THEN
                CREATE POLICY tenant_isolation ON imoview_sync_status
                USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS imoview_sync_status CASCADE")
    op.execute("DROP INDEX IF EXISTS idx_imoveis_busca_trgm")
    op.execute("DROP INDEX IF EXISTS idx_imoveis_cidade")
    op.execute("DROP INDEX IF EXISTS idx_imoveis_bairro")
    op.execute("DROP INDEX IF EXISTS idx_imoveis_tipo")
    op.execute("DROP INDEX IF EXISTS idx_imoveis_lista")
    op.execute("""
        ALTER TABLE imoveis_cache
            DROP COLUMN IF EXISTS busca, DROP COLUMN IF EXISTS destaque, DROP COLUMN IF EXISTS estado,
            DROP COLUMN IF EXISTS valor_condominio, DROP COLUMN IF EXISTS suites,
            DROP COLUMN IF EXISTS banheiros, DROP COLUMN IF EXISTS titulo, DROP COLUMN IF EXISTS ativo
    """)
