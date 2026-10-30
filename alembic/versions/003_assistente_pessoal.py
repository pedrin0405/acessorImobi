"""Assistente pessoal do corretor: número pessoal conectado e atendimentos observados

Revision ID: 003_assistente_pessoal
Revises: 002_crm_copiloto
Create Date: 2026-10-30 00:00:00.000000

O corretor conecta o próprio WhatsApp. O agente só LÊ as conversas dele com
clientes para resumir, analisar e sugerir; nunca envia nada por esse número.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '003_assistente_pessoal'
down_revision: Union[str, None] = '002_crm_copiloto'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


COMANDOS = [
    # Sessões passam a ter dono: o agente da imobiliária ou um corretor.
    "ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS tipo VARCHAR(10) NOT NULL DEFAULT 'agente'",
    "ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS corretor_id UUID REFERENCES corretores(id) ON DELETE CASCADE",
    """
    DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_sessions_tipo_check') THEN
            ALTER TABLE whatsapp_sessions ADD CONSTRAINT whatsapp_sessions_tipo_check
                CHECK (tipo IN ('agente','corretor') AND (tipo = 'agente') = (corretor_id IS NULL));
        END IF;
    END $$
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_ws_corretor ON whatsapp_sessions(corretor_id) WHERE corretor_id IS NOT NULL",

    # Preferências do assistente por corretor (ativo, avisos, carteira automática).
    "ALTER TABLE corretores ADD COLUMN IF NOT EXISTS assistente_config JSONB NOT NULL DEFAULT '{}'",

    # Um atendimento por cliente (contato) de cada corretor.
    """
    CREATE TABLE IF NOT EXISTS atendimentos (
        id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        corretor_id         UUID NOT NULL REFERENCES corretores(id) ON DELETE CASCADE,
        telefone_cliente    VARCHAR(20) NOT NULL,
        nome_contato        VARCHAR(255),
        lead_id             UUID REFERENCES crm_leads(id) ON DELETE SET NULL,
        imobiliario         BOOLEAN,
        aguardando_corretor BOOLEAN NOT NULL DEFAULT FALSE,
        ultima_mensagem_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ultima_do_cliente_em TIMESTAMPTZ,
        analise             JSONB NOT NULL DEFAULT '{}',
        analisado_em        TIMESTAMPTZ,
        avisado_em          TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (corretor_id, telefone_cliente)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_atendimentos_corretor ON atendimentos(tenant_id, corretor_id, ultima_mensagem_em DESC)",

    """
    CREATE TABLE IF NOT EXISTS atendimento_mensagens (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        atendimento_id  UUID NOT NULL REFERENCES atendimentos(id) ON DELETE CASCADE,
        message_id      VARCHAR(255) NOT NULL,
        autor           VARCHAR(10) NOT NULL CHECK (autor IN ('cliente','corretor')),
        tipo            VARCHAR(20) NOT NULL DEFAULT 'text'
                            CHECK (tipo IN ('text','audio','image','document')),
        conteudo        TEXT,
        transcricao     TEXT,
        midia           JSONB,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (tenant_id, message_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_atend_msgs ON atendimento_mensagens(atendimento_id, created_at)",
]


def upgrade() -> None:
    for comando in COMANDOS:
        op.execute(comando)
    for tabela in ("atendimentos", "atendimento_mensagens"):
        op.execute(f"ALTER TABLE {tabela} ENABLE ROW LEVEL SECURITY")
        op.execute(f"""
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_policies WHERE tablename = '{tabela}' AND policyname = 'tenant_isolation'
                ) THEN
                    CREATE POLICY tenant_isolation ON {tabela}
                    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
                END IF;
            END $$
        """)
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_updated_at_atendimentos') THEN
                CREATE TRIGGER trg_updated_at_atendimentos BEFORE UPDATE ON atendimentos
                FOR EACH ROW EXECUTE FUNCTION set_updated_at();
            END IF;
        END $$
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS atendimento_mensagens CASCADE")
    op.execute("DROP TABLE IF EXISTS atendimentos CASCADE")
    op.execute("ALTER TABLE corretores DROP COLUMN IF EXISTS assistente_config")
    op.execute("DROP INDEX IF EXISTS uq_ws_corretor")
    op.execute("ALTER TABLE whatsapp_sessions DROP CONSTRAINT IF EXISTS whatsapp_sessions_tipo_check")
    op.execute("ALTER TABLE whatsapp_sessions DROP COLUMN IF EXISTS corretor_id")
    op.execute("ALTER TABLE whatsapp_sessions DROP COLUMN IF EXISTS tipo")
