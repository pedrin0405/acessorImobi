"""Link do imóvel no site da imobiliária: {site}/imovel/{titulo-em-slug}/{codigo}.

O site resolve o anúncio pelo código (o texto do meio só deixa o endereço legível), então basta
montar o endereço a partir do título que o Imoview já entrega.
"""
import re
import unicodedata
from typing import Optional
from urllib.parse import urlparse

from sqlalchemy import text

_LOTE = 500


def normalizar_base(site: Optional[str]) -> Optional[str]:
    """'www.exemplo.com.br/' -> 'https://www.exemplo.com.br'; None se não for um endereço válido."""
    bruto = (site or "").strip()
    if not bruto:
        return None
    if not re.match(r"^https?://", bruto, re.I):
        bruto = "https://" + bruto
    partes = urlparse(bruto)
    if not partes.netloc or "." not in partes.netloc or " " in partes.netloc:
        return None
    return f"{partes.scheme.lower()}://{partes.netloc.lower()}"


def slug(texto: Optional[str], limite: int = 80) -> str:
    sem_acento = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", sem_acento.lower()).strip("-")
    return s[:limite].strip("-")


def link_do_site(base: Optional[str], codigo: int, titulo: Optional[str], tipo: Optional[str] = None, bairro: Optional[str] = None) -> Optional[str]:
    """Sem título usa 'tipo-bairro'; o código é o que identifica o imóvel."""
    if not base or not codigo:
        return None
    meio = slug(titulo) or slug(f"{tipo or 'imovel'} {bairro or ''}") or "imovel"
    return f"{base}/imovel/{meio}/{codigo}"


def link_do_imovel(base: Optional[str], atual: Optional[str], codigo: int, titulo: Optional[str], tipo: Optional[str] = None, bairro: Optional[str] = None) -> Optional[str]:
    """O link guardado no cache ou, se ainda vazio, o calculado pelo site da imobiliária (vale já na leitura, sem esperar o sync)."""
    return atual or link_do_site(base, codigo, titulo, tipo, bairro)


async def base_do_tenant(session, tenant_id) -> Optional[str]:
    site = (await session.execute(
        text("SELECT dados->'imobiliaria'->>'site' FROM tenants WHERE id = :tid"), {"tid": str(tenant_id)}
    )).scalar()
    return normalizar_base(site)


async def aplicar_links(session, tenant_id, base: Optional[str]) -> int:
    """Preenche o link dos imóveis já em cache (vazios ou gerados antes, p.ex. com outro site).

    Links vindos do Imoview (`urlpublica`) só são trocados se o endereço seguir o mesmo padrão
    /imovel/…/código; sem site configurado, os gerados por nós são apagados.
    """
    rows = (await session.execute(
        text("""SELECT codigo_imoview, titulo, tipo, bairro FROM imoveis_cache
                WHERE tenant_id = :tid AND (link_anuncio IS NULL OR link_anuncio = '' OR link_anuncio LIKE '%/imovel/%/%')"""),
        {"tid": str(tenant_id)},
    )).fetchall()
    atualizados = 0
    for i in range(0, len(rows), _LOTE):
        lote = rows[i:i + _LOTE]
        await session.execute(
            text("UPDATE imoveis_cache SET link_anuncio = d.link, updated_at = NOW() "
                 "FROM (SELECT unnest(CAST(:codigos AS int[])) AS codigo, unnest(CAST(:links AS text[])) AS link) d "
                 "WHERE imoveis_cache.tenant_id = :tid AND imoveis_cache.codigo_imoview = d.codigo"),
            {"tid": str(tenant_id), "codigos": [r.codigo_imoview for r in lote],
             "links": [link_do_site(base, r.codigo_imoview, r.titulo, r.tipo, r.bairro) or "" for r in lote]},
        )
        atualizados += len(lote)
    return atualizados
