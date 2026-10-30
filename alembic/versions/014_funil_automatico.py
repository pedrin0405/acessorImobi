"""Funil automático: todo cliente vira negócio na primeira etapa + ficha completa do Imoview

Revision ID: 014_funil_automatico
Revises: 013_leads_imoview
Create Date: 2026-10-30 00:00:00.000000

- crm_negocios.corretor_id aceita NULL (cliente sem responsável também aparece no funil) e ganha
  `automatico` (negócio criado pelo sistema; vira manual quando alguém o trabalha).
- crm_leads.dados_imoview (JSONB) guarda o cadastro do Imoview, sem CPF/CNPJ nem documentos.
- Índices do quadro: paginação por coluna e junção lead -> negócio.
- Backfill em lotes: semeia as etapas padrão de quem ainda não tem e abre um negócio na primeira
  etapa para cada cliente que não tem nenhum (idempotente: só quem não tem negócio).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = '014_funil_automatico'
down_revision: Union[str, None] = '013_leads_imoview'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ETAPAS = [("Lead", 5, 14, "slate"), ("Contato feito", 15, 14, "sky"), ("Qualificado", 30, 14, "sky"),
          ("Visita agendada", 50, 14, "amber"), ("Visita realizada", 60, 14, "amber"),
          ("Proposta", 70, 14, "amber"), ("Negociação", 85, 14, "emerald")]
LOTE = 5000


def upgrade() -> None:
    op.execute("ALTER TABLE crm_negocios ALTER COLUMN corretor_id DROP NOT NULL")
    op.execute("ALTER TABLE crm_negocios ADD COLUMN IF NOT EXISTS automatico BOOLEAN NOT NULL DEFAULT FALSE")
    op.execute("""
        ALTER TABLE crm_leads
            ADD COLUMN IF NOT EXISTS dados_imoview JSONB NOT NULL DEFAULT '{}',
            ADD COLUMN IF NOT EXISTS imoview_alterado_em TIMESTAMPTZ
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_crm_negocios_lead ON crm_negocios(lead_id)")
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_crm_negocios_coluna
        ON crm_negocios(tenant_id, etapa_id, status, updated_at DESC)
    """)

    conn = op.get_bind()
    # etapas padrão para quem ainda não tem (só quando já há clientes)
    for ordem, (nome, prob, alerta, cor) in enumerate(ETAPAS):
        conn.execute(sa.text(
            """
            INSERT INTO crm_etapas (tenant_id, nome, ordem, probabilidade, alerta_dias, cor)
            SELECT t.id, :nome, :ordem, :prob, :alerta, :cor FROM tenants t
            WHERE NOT EXISTS (SELECT 1 FROM crm_etapas e WHERE e.tenant_id = t.id)
              AND EXISTS (SELECT 1 FROM crm_leads l WHERE l.tenant_id = t.id)
            ON CONFLICT (tenant_id, nome) DO NOTHING
            """),
            {"nome": nome, "ordem": ordem, "prob": prob, "alerta": alerta, "cor": cor},
        )

    # um negócio na primeira etapa para cada cliente sem negócio, em lotes
    while True:
        feito = conn.execute(sa.text(
            """
            WITH lote AS (
                SELECT l.id, l.tenant_id, l.corretor_id, l.nome, l.created_at,
                       (SELECT e.id FROM crm_etapas e WHERE e.tenant_id = l.tenant_id ORDER BY e.ordem LIMIT 1) AS etapa_id
                FROM crm_leads l
                WHERE l.status <> 'arquivado'
                  AND EXISTS (SELECT 1 FROM crm_etapas e WHERE e.tenant_id = l.tenant_id)
                  AND NOT EXISTS (SELECT 1 FROM crm_negocios n WHERE n.lead_id = l.id)
                LIMIT :lote
            ), novos AS (
                INSERT INTO crm_negocios (tenant_id, corretor_id, lead_id, etapa_id, titulo, valor, automatico, created_at, etapa_desde)
                SELECT tenant_id, corretor_id, id, etapa_id, LEFT(nome, 255), 0, TRUE, created_at, NOW()
                FROM lote WHERE etapa_id IS NOT NULL
                RETURNING id, tenant_id, etapa_id
            )
            INSERT INTO crm_negocio_eventos (tenant_id, negocio_id, tipo, para, autor)
            SELECT n.tenant_id, n.id, 'criado', e.nome, 'scheduler' FROM novos n JOIN crm_etapas e ON e.id = n.etapa_id
            """),
            {"lote": LOTE},
        ).rowcount
        if not feito:
            break


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_crm_negocios_coluna")
    op.execute("DROP INDEX IF EXISTS idx_crm_negocios_lead")
