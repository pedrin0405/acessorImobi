"""Valor dos negócios vindo do CRM do Imoview

Revision ID: 021_valor_do_crm
Revises: 020_assistente_blocos
Create Date: 2026-11-01 10:00:00.000000

O valor do atendimento é deduzido do que o Imoview registrou (negócio, proposta, imóvel da visita ou do carrinho,
orçamento do perfil) e passa a ser o valor do negócio no Fluxo, salvo quando alguém o digitou à mão no portal
(`valor_manual`). A comissão do negócio fechado também é guardada.
"""
import json
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


revision: str = '021_valor_do_crm'
down_revision: Union[str, None] = '020_assistente_blocos'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE imoview_atendimentos
            ADD COLUMN IF NOT EXISTS valor_crm NUMERIC(14,2),
            ADD COLUMN IF NOT EXISTS valor_tipo VARCHAR(12),
            ADD COLUMN IF NOT EXISTS comissao NUMERIC(14,2)
    """)
    op.execute("ALTER TABLE crm_negocios ADD COLUMN IF NOT EXISTS valor_manual BOOLEAN NOT NULL DEFAULT FALSE")
    op.execute("UPDATE crm_negocios SET valor_manual = TRUE WHERE valor > 0 AND NOT automatico")

    # Atendimentos já lidos guardam o conteúdo em `detalhes`: o valor sai dele sem nova leitura do Imoview.
    from app.domain.crm.fluxo_imoview import valor_do_atendimento

    conn = op.get_bind()
    linhas = conn.execute(text("SELECT tenant_id, codigo, detalhes FROM imoview_atendimentos WHERE detalhes IS NOT NULL")).fetchall()
    for r in linhas:
        valor, tipo, comissao = valor_do_atendimento(r.detalhes if isinstance(r.detalhes, dict) else json.loads(r.detalhes))
        if valor is not None:
            conn.execute(
                text("UPDATE imoview_atendimentos SET valor_crm = :v, valor_tipo = :t, comissao = :c WHERE tenant_id = :tid AND codigo = :cod"),
                {"v": valor, "t": tipo, "c": comissao, "tid": r.tenant_id, "cod": r.codigo},
            )
    op.execute("""
        UPDATE crm_negocios n SET valor = a.valor_crm
        FROM imoview_atendimentos a
        WHERE a.tenant_id = n.tenant_id AND a.codigo = n.imoview_atendimento AND NOT n.valor_manual AND a.valor_crm IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE crm_negocios DROP COLUMN IF EXISTS valor_manual")
    op.execute("ALTER TABLE imoview_atendimentos DROP COLUMN IF EXISTS valor_crm, DROP COLUMN IF EXISTS valor_tipo, DROP COLUMN IF EXISTS comissao")
