"""CRM do corretor: leads com perfil de busca, funil, agenda, matches e briefings

Revision ID: 002_crm_copiloto
Revises: 001_initial_schema
Create Date: 2026-10-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = '002_crm_copiloto'
down_revision: Union[str, None] = '001_initial_schema'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABELAS = [
    "crm_etapas", "crm_leads", "crm_negocios", "crm_negocio_eventos",
    "crm_atividades", "crm_matches", "crm_briefings",
]

DDL = """
-- Etapas do funil (por tenant). Semeadas sob demanda pelo serviço.
CREATE TABLE IF NOT EXISTS crm_etapas (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    nome            VARCHAR(80) NOT NULL,
    ordem           INT NOT NULL,
    probabilidade   INT NOT NULL DEFAULT 0 CHECK (probabilidade BETWEEN 0 AND 100),
    alerta_dias     INT CHECK (alerta_dias IS NULL OR alerta_dias > 0),
    cor             VARCHAR(20) NOT NULL DEFAULT 'slate',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, nome)
);
CREATE INDEX IF NOT EXISTS idx_crm_etapas_tenant ON crm_etapas(tenant_id, ordem);

-- Clientes do corretor (leads), com perfil de busca estruturado.
CREATE TABLE IF NOT EXISTS crm_leads (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    corretor_id     UUID NOT NULL REFERENCES corretores(id) ON DELETE CASCADE,
    nome            VARCHAR(255) NOT NULL,
    telefone        VARCHAR(20),
    email           VARCHAR(255),
    origem          VARCHAR(40) NOT NULL DEFAULT 'whatsapp',
    temperatura     VARCHAR(10) NOT NULL DEFAULT 'morno'
                        CHECK (temperatura IN ('quente','morno','frio')),
    status          VARCHAR(10) NOT NULL DEFAULT 'lead'
                        CHECK (status IN ('lead','cliente','arquivado')),
    perfil          JSONB NOT NULL DEFAULT '{}',
    observacoes     TEXT,
    codigo_imoview  INT,
    ultimo_contato  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_leads_corretor ON crm_leads(tenant_id, corretor_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_leads_nome ON crm_leads(tenant_id, lower(nome));

-- Negócios do funil.
CREATE TABLE IF NOT EXISTS crm_negocios (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    corretor_id         UUID NOT NULL REFERENCES corretores(id) ON DELETE CASCADE,
    lead_id             UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
    etapa_id            UUID NOT NULL REFERENCES crm_etapas(id),
    titulo              VARCHAR(255),
    valor               NUMERIC(14,2) NOT NULL DEFAULT 0,
    status              VARCHAR(10) NOT NULL DEFAULT 'aberto'
                            CHECK (status IN ('aberto','ganho','perdido')),
    motivo_perda        VARCHAR(255),
    fechamento_previsto DATE,
    imovel_codigo       INT,
    etapa_desde         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fechado_em          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_negocios_tenant ON crm_negocios(tenant_id, status, etapa_id);
CREATE INDEX IF NOT EXISTS idx_crm_negocios_corretor ON crm_negocios(tenant_id, corretor_id, status);

-- Histórico do negócio (mudança de etapa, ganho, perda).
CREATE TABLE IF NOT EXISTS crm_negocio_eventos (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    negocio_id      UUID NOT NULL REFERENCES crm_negocios(id) ON DELETE CASCADE,
    tipo            VARCHAR(30) NOT NULL,
    de              VARCHAR(80),
    para            VARCHAR(80),
    autor           VARCHAR(20) NOT NULL DEFAULT 'agent'
                        CHECK (autor IN ('agent','portal','scheduler')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_eventos_negocio ON crm_negocio_eventos(negocio_id, created_at);

-- Agenda.
CREATE TABLE IF NOT EXISTS crm_atividades (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    corretor_id         UUID NOT NULL REFERENCES corretores(id) ON DELETE CASCADE,
    lead_id             UUID REFERENCES crm_leads(id) ON DELETE SET NULL,
    negocio_id          UUID REFERENCES crm_negocios(id) ON DELETE SET NULL,
    tipo                VARCHAR(20) NOT NULL DEFAULT 'tarefa'
                            CHECK (tipo IN ('visita','reuniao','ligacao','follow_up','whatsapp','tarefa','email','documento')),
    titulo              VARCHAR(255) NOT NULL,
    inicio              TIMESTAMPTZ,
    duracao_min         INT NOT NULL DEFAULT 60,
    local               VARCHAR(255),
    imovel_codigo       INT,
    status              VARCHAR(12) NOT NULL DEFAULT 'aberta'
                            CHECK (status IN ('aberta','concluida','cancelada')),
    lembrete_min        INT NOT NULL DEFAULT 60,
    lembrete_enviado_em TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_atividades_agenda ON crm_atividades(tenant_id, corretor_id, status, inicio);

-- Imóveis já avisados para cada lead (evita repetir o mesmo match).
CREATE TABLE IF NOT EXISTS crm_matches (
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    lead_id         UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
    imovel_codigo   INT NOT NULL,
    notificado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (lead_id, imovel_codigo)
);

-- Um briefing por corretor por dia.
CREATE TABLE IF NOT EXISTS crm_briefings (
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    corretor_id     UUID NOT NULL REFERENCES corretores(id) ON DELETE CASCADE,
    dia             DATE NOT NULL,
    enviado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (corretor_id, dia)
);
"""


def upgrade() -> None:
    # asyncpg não aceita vários comandos num único execute.
    for comando in DDL.split(";"):
        if comando.strip():
            op.execute(comando)
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
    for tabela in ("crm_etapas", "crm_leads", "crm_negocios", "crm_atividades"):
        op.execute(f"""
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_updated_at_{tabela}'
                ) THEN
                    CREATE TRIGGER trg_updated_at_{tabela} BEFORE UPDATE ON {tabela}
                    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
                END IF;
            END $$;
        """)


def downgrade() -> None:
    for tabela in reversed(TABELAS):
        op.execute(f"DROP TABLE IF EXISTS {tabela} CASCADE")
