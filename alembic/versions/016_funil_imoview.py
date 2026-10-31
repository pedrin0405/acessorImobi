"""Fases dos atendimentos do Imoview espelhadas nas negociações

Revision ID: 016_funil_imoview
Revises: 015_foto_corretor
Create Date: 2026-10-30 00:00:00.000000

- imoview_atendimentos: cópia enxuta dos atendimentos do CRM do Imoview (a fase só é conhecida pelo filtro
  de leitura, então é gravada aqui), ligada ao cliente por lead_codigo = crm_leads.codigo_imoview.
- crm_negocios ganha o atendimento/fase/situação do Imoview que está valendo para o negócio.
- imoview_funil_sync: andamento, checkpoint e marca d'água da leitura incremental.
- imoview_alteracoes_pendentes: mudanças feitas no portal que ainda precisam chegar ao Imoview
  (o envio exige o código de acesso do usuário do Imoview).
- crm_negocio_eventos.autor passa a aceitar 'imoview'.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '016_funil_imoview'
down_revision: Union[str, None] = '015_foto_corretor'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def _rls(tabela: str) -> None:
    op.execute(f"ALTER TABLE {tabela} ENABLE ROW LEVEL SECURITY")
    op.execute(f"""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = '{tabela}' AND policyname = 'tenant_isolation') THEN
                CREATE POLICY tenant_isolation ON {tabela} USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
            END IF;
        END $$;
    """)


def upgrade() -> None:
    op.execute("""
        ALTER TABLE crm_negocios
            ADD COLUMN IF NOT EXISTS imoview_atendimento INT,
            ADD COLUMN IF NOT EXISTS imoview_fase SMALLINT,
            ADD COLUMN IF NOT EXISTS imoview_situacao VARCHAR(20),
            ADD COLUMN IF NOT EXISTS imoview_atualizado_em TIMESTAMPTZ
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS imoview_atendimentos (
            tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            codigo          INT NOT NULL,
            finalidade      SMALLINT NOT NULL,
            lead_codigo     INT,
            fase            SMALLINT NOT NULL,
            situacao        VARCHAR(40),
            situacao_tipo   VARCHAR(20) NOT NULL,
            termometro      VARCHAR(20),
            corretor_codigo INT,
            incluido_em     TIMESTAMPTZ,
            alterado_em     TIMESTAMPTZ,
            lido_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (tenant_id, codigo)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_imoview_atend_lead ON imoview_atendimentos(tenant_id, lead_codigo)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_imoview_atend_fase ON imoview_atendimentos(tenant_id, fase, situacao_tipo)")
    _rls("imoview_atendimentos")

    op.execute("""
        CREATE TABLE IF NOT EXISTS imoview_funil_sync (
            tenant_id         UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
            estado            VARCHAR(12) NOT NULL DEFAULT 'ocioso'
                                  CHECK (estado IN ('ocioso','executando','ok','erro')),
            origem            VARCHAR(12),
            modo              VARCHAR(12),
            etapa             VARCHAR(60),
            iniciado_em       TIMESTAMPTZ,
            concluido_em      TIMESTAMPTZ,
            ultimo_sucesso_em TIMESTAMPTZ,
            leitura_desde     TIMESTAMPTZ,
            total_remoto      INT NOT NULL DEFAULT 0,
            processados       INT NOT NULL DEFAULT 0,
            negocios_ligados  INT NOT NULL DEFAULT 0,
            negocios_movidos  INT NOT NULL DEFAULT 0,
            checkpoint        JSONB,
            erro              TEXT,
            atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    _rls("imoview_funil_sync")

    op.execute("""
        CREATE TABLE IF NOT EXISTS imoview_alteracoes_pendentes (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            negocio_id      UUID NOT NULL REFERENCES crm_negocios(id) ON DELETE CASCADE,
            atendimento     INT NOT NULL,
            tipo            VARCHAR(10) NOT NULL CHECK (tipo IN ('fase','ganho','descarte')),
            fase_alvo       SMALLINT,
            motivo          VARCHAR(200),
            criada_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            aplicada_em     TIMESTAMPTZ,
            descartada_em   TIMESTAMPTZ
        )
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_imoview_pendente_aberta
        ON imoview_alteracoes_pendentes(negocio_id) WHERE aplicada_em IS NULL AND descartada_em IS NULL
    """)
    _rls("imoview_alteracoes_pendentes")

    op.execute("ALTER TABLE crm_negocio_eventos DROP CONSTRAINT IF EXISTS crm_negocio_eventos_autor_check")
    op.execute("""
        ALTER TABLE crm_negocio_eventos ADD CONSTRAINT crm_negocio_eventos_autor_check
            CHECK (autor IN ('agent','portal','scheduler','imoview'))
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS imoview_alteracoes_pendentes CASCADE")
    op.execute("DROP TABLE IF EXISTS imoview_funil_sync CASCADE")
    op.execute("DROP TABLE IF EXISTS imoview_atendimentos CASCADE")
    op.execute("""
        ALTER TABLE crm_negocios
            DROP COLUMN IF EXISTS imoview_atendimento, DROP COLUMN IF EXISTS imoview_fase,
            DROP COLUMN IF EXISTS imoview_situacao, DROP COLUMN IF EXISTS imoview_atualizado_em
    """)
