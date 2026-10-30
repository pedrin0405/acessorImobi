"""Memória de longo prazo das conversas do agente (RAG)

Revision ID: 010_memoria_conversa
Revises: 009_conversa_notas
Create Date: 2026-10-30 00:00:00.000000

`conversa_memoria` guarda um embedding (Gemini, 768 dimensões) por mensagem útil
de cada corretor, para recuperar trechos antigos quando o assunto volta.
`embedding` NULL marca mensagem ignorada (ruído como "ok"): o registro existe
só para o indexador não reprocessá-la.
`conversa_resumos` guarda o resumo incremental do que ficou fora da janela recente.

Sem índice vetorial (ANN) de propósito: toda busca é limitada a um corretor
(milhares de linhas), então a varredura exata pelo índice (tenant, corretor)
é rápida e nunca perde resultado, o que um HNSW com filtro pode fazer.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '010_memoria_conversa'
down_revision: Union[str, None] = '009_conversa_notas'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABELAS = ["conversa_memoria", "conversa_resumos"]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("""
        CREATE TABLE IF NOT EXISTS conversa_memoria (
            id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            corretor_id UUID NOT NULL REFERENCES corretores(id) ON DELETE CASCADE,
            mensagem_id UUID NOT NULL UNIQUE,
            papel       VARCHAR(10) NOT NULL CHECK (papel IN ('inbound','outbound')),
            conteudo    TEXT NOT NULL,
            embedding   vector(768),
            criada_em   TIMESTAMPTZ NOT NULL
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_conversa_memoria_corretor
        ON conversa_memoria(tenant_id, corretor_id, criada_em)
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS conversa_resumos (
            tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            corretor_id         UUID NOT NULL REFERENCES corretores(id) ON DELETE CASCADE,
            resumo              TEXT NOT NULL,
            ate_em              TIMESTAMPTZ NOT NULL,
            mensagens_resumidas INT NOT NULL DEFAULT 0,
            atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (tenant_id, corretor_id)
        )
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
    op.execute("DROP TABLE IF EXISTS conversa_resumos CASCADE")
    op.execute("DROP TABLE IF EXISTS conversa_memoria CASCADE")
