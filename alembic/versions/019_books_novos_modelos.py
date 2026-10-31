"""Novos modelos de fábrica dos books (Editorial, Vitrine e Ficha)

Revision ID: 019_books_novos_modelos
Revises: 018_books_modelos
Create Date: 2026-10-31 18:00:00.000000

O desenho dos três layouts foi refeito. Os modelos de fábrica já criados (Clássico, Galeria de fotos e Resumido)
são trocados pelos novos, com o mesmo layout; modelos criados pela imobiliária não são tocados.
"""
import json
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


revision: str = '019_books_novos_modelos'
down_revision: Union[str, None] = '018_books_modelos'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NOVOS = {
    "classico": ("Editorial", {"layout": "classico", "cor_primaria": "#1f3a2e", "cor_secundaria": "#b4532a", "fonte": "classica", "fotos_por_imovel": 4, "mostrar_capa": True, "mostrar_descricao": True, "mostrar_caracteristicas": True}),
    "galeria": ("Vitrine", {"layout": "galeria", "cor_primaria": "#0f1115", "cor_secundaria": "#e8b04a", "fonte": "moderna", "fotos_por_imovel": 6, "mostrar_capa": True, "mostrar_descricao": True, "mostrar_caracteristicas": False}),
    "compacto": ("Ficha", {"layout": "compacto", "cor_primaria": "#14213d", "cor_secundaria": "#ff5a36", "fonte": "moderna", "fotos_por_imovel": 3, "mostrar_capa": True, "mostrar_descricao": False, "mostrar_caracteristicas": False}),
}


def upgrade() -> None:
    conn = op.get_bind()
    for layout, (nome, config) in NOVOS.items():
        conn.execute(
            text("""
                UPDATE book_modelos m SET nome = :nome, config = m.config || CAST(:config AS jsonb), updated_at = NOW()
                WHERE m.sistema AND m.config->>'layout' = :layout
                  AND NOT EXISTS (SELECT 1 FROM book_modelos o WHERE o.tenant_id = m.tenant_id AND lower(o.nome) = lower(:nome) AND o.id <> m.id)
            """),
            {"nome": nome, "config": json.dumps(config), "layout": layout},
        )


def downgrade() -> None:
    pass
