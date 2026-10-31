"""Refaz os links dos imóveis em cache a partir do site de cada imobiliária

Revision ID: 022_site_padrao
Revises: 021_valor_do_crm
Create Date: 2026-11-01 14:00:00.000000

O link do anúncio nasce do site informado em Configurações → Dados da imobiliária (cada imobiliária o seu; nada
fixo no projeto). Esta migração só preenche os links vazios dos imóveis já em cache das que já informaram o site.
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


revision: str = '022_site_padrao'
down_revision: Union[str, None] = '021_valor_do_crm'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from app.domain.imovel.link import link_do_site, normalizar_base

    conn = op.get_bind()
    linhas = conn.execute(text("""
        SELECT i.tenant_id, i.codigo_imoview, i.titulo, i.tipo, i.bairro, t.dados->'imobiliaria'->>'site' AS site
        FROM imoveis_cache i JOIN tenants t ON t.id = i.tenant_id
        WHERE coalesce(i.link_anuncio, '') = '' AND coalesce(t.dados->'imobiliaria'->>'site', '') <> ''
    """)).fetchall()
    for r in linhas:
        link = link_do_site(normalizar_base(r.site), r.codigo_imoview, r.titulo, r.tipo, r.bairro)
        if link:
            conn.execute(text("UPDATE imoveis_cache SET link_anuncio = :l WHERE tenant_id = :t AND codigo_imoview = :c"),
                         {"l": link, "t": r.tenant_id, "c": r.codigo_imoview})


def downgrade() -> None:
    pass
