"""Fluxo: atendimentos do Imoview com interações, interesses, visitas, propostas e negócios

Revision ID: 017_fluxo_atendimentos
Revises: 016_funil_imoview
Create Date: 2026-10-30 12:00:00.000000

- imoview_atendimentos guarda o conteúdo completo do atendimento (a API já devolve tudo no mesmo item):
  origem (funil, mídia, campanha), datas, perfil de interesse, imóveis do carrinho, visitas, propostas,
  negócios e interações. `estagio` é deduzido desse conteúdo e decide a etapa do negócio no Fluxo.
- crm_negocios.imoview_estagio guarda o estágio que valeu na última leitura (detecta mudança).
"""
from typing import Sequence, Union

from alembic import op


revision: str = '017_fluxo_atendimentos'
down_revision: Union[str, None] = '016_funil_imoview'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE imoview_atendimentos
            ADD COLUMN IF NOT EXISTS estagio VARCHAR(20),
            ADD COLUMN IF NOT EXISTS funil VARCHAR(60),
            ADD COLUMN IF NOT EXISTS midia VARCHAR(120),
            ADD COLUMN IF NOT EXISTS campanha VARCHAR(200),
            ADD COLUMN IF NOT EXISTS unidade VARCHAR(120),
            ADD COLUMN IF NOT EXISTS corretor_nome VARCHAR(120),
            ADD COLUMN IF NOT EXISTS mql_nome VARCHAR(120),
            ADD COLUMN IF NOT EXISTS qualificado BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS entrada_em TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS primeira_resposta_em TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS ultima_interacao_em TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS previsao_fechamento_em TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS fechamento_em TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS n_interacoes INT NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS n_visitas INT NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS n_propostas INT NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS detalhes JSONB
    """)
    op.execute("ALTER TABLE crm_negocios ADD COLUMN IF NOT EXISTS imoview_estagio VARCHAR(20)")
    # Releitura completa necessária para preencher o conteúdo dos atendimentos já gravados.
    op.execute("UPDATE imoview_funil_sync SET ultimo_sucesso_em = NULL, leitura_desde = NULL WHERE ultimo_sucesso_em IS NOT NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE crm_negocios DROP COLUMN IF EXISTS imoview_estagio")
    op.execute("""
        ALTER TABLE imoview_atendimentos
            DROP COLUMN IF EXISTS estagio, DROP COLUMN IF EXISTS funil, DROP COLUMN IF EXISTS midia,
            DROP COLUMN IF EXISTS campanha, DROP COLUMN IF EXISTS unidade, DROP COLUMN IF EXISTS corretor_nome,
            DROP COLUMN IF EXISTS mql_nome, DROP COLUMN IF EXISTS qualificado, DROP COLUMN IF EXISTS entrada_em,
            DROP COLUMN IF EXISTS primeira_resposta_em, DROP COLUMN IF EXISTS ultima_interacao_em,
            DROP COLUMN IF EXISTS previsao_fechamento_em, DROP COLUMN IF EXISTS fechamento_em,
            DROP COLUMN IF EXISTS n_interacoes, DROP COLUMN IF EXISTS n_visitas, DROP COLUMN IF EXISTS n_propostas,
            DROP COLUMN IF EXISTS detalhes
    """)
