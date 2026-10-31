"""Monta o book: lê os imóveis do cache, baixa as fotos, aplica o modelo e devolve o PDF."""
import asyncio
import base64
import ipaddress
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse
from uuid import UUID

import httpx
import structlog
from sqlalchemy import text

from app.domain.book import config as cfg
from app.domain.book.modelos import ModelosBook
from app.domain.book.pdf import renderizar
from app.domain.imovel import consulta

log = structlog.get_logger()

MAX_IMOVEIS = 12
MAX_FOTO_BYTES = 6 * 1024 * 1024
TIMEOUT_FOTO = 8.0
CONCORRENCIA = 6


class BookErro(ValueError):
    pass


def _url_publica(url: Any) -> bool:
    """Só https para hosts públicos: o endereço vem do cache, mas nunca deve apontar para a rede interna."""
    try:
        u = urlparse(str(url))
    except ValueError:
        return False
    if u.scheme != "https" or not u.hostname or u.hostname == "localhost" or u.hostname.endswith((".local", ".internal")):
        return False
    try:
        ip = ipaddress.ip_address(u.hostname)
    except ValueError:
        return True
    return ip.is_global


async def _baixar(cliente: httpx.AsyncClient, sem: asyncio.Semaphore, url: str) -> Optional[bytes]:
    if not _url_publica(url):
        return None
    async with sem:
        try:
            r = await cliente.get(url)
            if r.status_code == 200 and 0 < len(r.content) <= MAX_FOTO_BYTES and r.headers.get("content-type", "").startswith("image/"):
                return r.content
        except httpx.HTTPError as e:
            log.info("book_foto_falhou", error=type(e).__name__)
    return None


async def baixar_fotos(imoveis: List[Dict[str, Any]], por_imovel: int) -> None:
    """Preenche `_fotos` (bytes) de cada imóvel; fotos que falham são puladas e as seguintes entram no lugar."""
    sem = asyncio.Semaphore(CONCORRENCIA)
    async with httpx.AsyncClient(timeout=TIMEOUT_FOTO, follow_redirects=False) as cliente:
        async def um(im):
            urls = [f["url"] for f in (im.get("fotos") or []) if isinstance(f, dict) and f.get("url")]
            if im.get("foto_url") and im["foto_url"] not in urls:
                urls.insert(0, im["foto_url"])
            baixadas = await asyncio.gather(*[_baixar(cliente, sem, u) for u in urls[: por_imovel + 3]])
            im["_fotos"] = [b for b in baixadas if b][:por_imovel]
        await asyncio.gather(*[um(im) for im in imoveis])


async def dados_da_imobiliaria(session, tenant_id: UUID) -> Dict[str, Any]:
    linha = (await session.execute(text("SELECT nome, dados FROM tenants WHERE id = :tid"), {"tid": str(tenant_id)})).first()
    im = ((linha.dados or {}).get("imobiliaria") or {}) if linha else {}
    logo = None
    m = re.match(r"^data:image/(?:png|jpeg|webp);base64,(.+)$", im.get("logo") or "")
    if m:
        try:
            logo = base64.b64decode(m.group(1))
        except ValueError:
            logo = None
    telefone = "".join(ch for ch in str(im.get("telefone") or "") if ch.isdigit())
    if len(telefone) in (10, 11):
        telefone = f"({telefone[:2]}) {telefone[2:-4]}-{telefone[-4:]}"
    creci = " ".join(p for p in (im.get("creci_numero"), im.get("creci_uf")) if p)
    return {"nome": linha.nome if linha else "", "telefone": telefone, "email": im.get("email_contato") or "",
            "site": im.get("site") or "", "creci": creci, "logo": logo}


async def gerar_book(
    session, tenant_id: UUID, codigos: List[int], modelo_id: Optional[UUID] = None, titulo: Optional[str] = None,
    corretor: Optional[Dict[str, Any]] = None, config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Devolve {pdf, imoveis, modelo, titulo, arquivo}. `config` (prévia de um modelo não salvo) substitui o do modelo."""
    codigos = list(dict.fromkeys(int(c) for c in codigos))[:MAX_IMOVEIS]
    if not codigos:
        raise BookErro("Escolha ao menos um imóvel para o book.")
    modelo = await ModelosBook(session).obter(tenant_id, modelo_id)
    configuracao = cfg.normalizar(config, modelo["config"]) if config else modelo["config"]
    imoveis = []
    for codigo in codigos:
        detalhe = await consulta.obter_detalhe(session, tenant_id, codigo)
        if detalhe:
            imoveis.append(detalhe)
    if not imoveis:
        raise BookErro("Não encontrei esses imóveis na carteira.")
    await baixar_fotos(imoveis, configuracao["fotos_por_imovel"])
    empresa = await dados_da_imobiliaria(session, tenant_id)
    pdf = await asyncio.to_thread(renderizar, configuracao, imoveis, empresa, corretor, titulo)
    sufixo = re.sub(r"[^a-z0-9]+", "-", (titulo or imoveis[0].get("bairro") or "imoveis").lower()).strip("-")[:30] or "imoveis"
    return {"pdf": pdf, "imoveis": imoveis, "modelo": modelo["nome"], "titulo": titulo or configuracao["titulo_capa"],
            "arquivo": f"book-{sufixo}.pdf"}


async def codigos_de_exemplo(session, tenant_id: UUID, n: int = 3) -> List[int]:
    linhas = (await session.execute(
        text("""SELECT codigo_imoview FROM imoveis_cache WHERE tenant_id = :tid AND ativo
                ORDER BY (dados_extras ? 'fotos') DESC, (dados_extras ? 'descricao') DESC, valor DESC NULLS LAST LIMIT :n"""),
        {"tid": str(tenant_id), "n": n},
    )).fetchall()
    return [r.codigo_imoview for r in linhas]
