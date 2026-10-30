"""Configurações do portal da imobiliária

Revision ID: 012_configuracoes
Revises: 011_imoview_integracao
Create Date: 2026-10-30 00:00:00.000000

- tenants.dados: dados da imobiliária, listas, tipos de atividade, roleta e lembretes.
- tenant_admins: perfil (telefone, CRECI, foto) e invalidação de sessões.
- localidades (cidades e bairros) com RLS.
- Libera o tipo de atividade (a validação passa a ser da aplicação) para tipos personalizados.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '012_configuracoes'
down_revision: Union[str, None] = '011_imoview_integracao'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABELAS = ["localidades_cidades", "localidades_bairros"]


def upgrade() -> None:
    op.execute("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS dados JSONB NOT NULL DEFAULT '{}'")
    op.execute("""
        ALTER TABLE tenant_admins
            ADD COLUMN IF NOT EXISTS telefone VARCHAR(30),
            ADD COLUMN IF NOT EXISTS creci_uf VARCHAR(2),
            ADD COLUMN IF NOT EXISTS creci_numero VARCHAR(20),
            ADD COLUMN IF NOT EXISTS foto TEXT,
            ADD COLUMN IF NOT EXISTS tokens_validos_apos TIMESTAMPTZ
    """)
    op.execute("ALTER TABLE crm_atividades DROP CONSTRAINT IF EXISTS crm_atividades_tipo_check")
    op.execute("""
        CREATE TABLE IF NOT EXISTS localidades_cidades (
            id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            nome        VARCHAR(120) NOT NULL,
            uf          VARCHAR(2),
            arquivada   BOOLEAN NOT NULL DEFAULT FALSE,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_localidades_cidade
        ON localidades_cidades(tenant_id, lower(nome), COALESCE(uf, ''))
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS localidades_bairros (
            id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            cidade_id   UUID NOT NULL REFERENCES localidades_cidades(id) ON DELETE CASCADE,
            nome        VARCHAR(120) NOT NULL,
            arquivado   BOOLEAN NOT NULL DEFAULT FALSE,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_localidades_bairro
        ON localidades_bairros(cidade_id, lower(nome))
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
    op.execute("DROP TABLE IF EXISTS localidades_bairros CASCADE")
    op.execute("DROP TABLE IF EXISTS localidades_cidades CASCADE")
