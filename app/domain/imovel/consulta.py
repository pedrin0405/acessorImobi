"""
Consulta dos imóveis em cache para a página "Imóveis" do portal da imobiliária.

Tudo sai do cache local (imoveis_cache): filtros, busca sem acento, ordenação,
paginação e facetas com contagem. O detalhe completa do Imoview uma única vez quando
o cache ainda não tem descrição ou fotos.
"""
import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

import structlog
from sqlalchemy import text

from app.domain.imovel.link import base_do_tenant, link_do_imovel

from app.domain.imovel.sync import (
    carregar_credenciais,
    normalizar_imovel,
    sem_acento,
)
from app.integration.imoview.client import ImoviewClient, ImoviewError
from app.integration.imoview.seguranca import UrlInvalida, validar_base_url

log = structlog.get_logger()

POR_PAGINA_PADRAO = 24
POR_PAGINA_MAX = 60
MAX_LISTA = 20

ORDENACOES = {
    "recentes": "(dados_extras->>'cadastrado_em') DESC NULLS LAST, codigo_imoview DESC",
    "valor_asc": "valor ASC NULLS LAST, codigo_imoview DESC",
    "valor_desc": "valor DESC NULLS LAST, codigo_imoview DESC",
    "area_desc": "area_m2 DESC NULLS LAST, codigo_imoview DESC",
    "codigo_desc": "codigo_imoview DESC",
}


def _lista(valor: Optional[str]) -> List[str]:
    return [v.strip() for v in (valor or "").split(",") if v.strip()][:MAX_LISTA]


def montar_filtros(
    tenant_id: UUID,
    filtros: Dict[str, Any],
    ignorar: Tuple[str, ...] = (),
) -> Tuple[str, Dict[str, Any]]:
    """
    Cláusula WHERE e parâmetros para os filtros recebidos. `ignorar` tira dimensões do filtro
    (usado nas facetas: o contador de "tipo" não deve ser limitado pelo próprio filtro de tipo).
    """
    onde = ["tenant_id = :tid"]
    params: Dict[str, Any] = {"tid": str(tenant_id)}
    if not filtros.get("incluir_inativos"):
        onde.append("ativo = TRUE")

    busca = sem_acento(filtros.get("busca"))
    if busca and "busca" not in ignorar:
        for i, palavra in enumerate(busca.split()[:6]):
            onde.append(f"busca ILIKE :b{i}")
            params[f"b{i}"] = f"%{palavra}%"
    if filtros.get("finalidade") in ("aluguel", "venda") and "finalidade" not in ignorar:
        onde.append("finalidade = :finalidade")
        params["finalidade"] = filtros["finalidade"]
    for campo in ("tipo", "bairro", "cidade"):
        valores = _lista(filtros.get(campo))
        if valores and campo not in ignorar:
            onde.append(f"{campo} = ANY(:{campo})")
            params[campo] = valores

    minimos = {"quartos": "quartos", "vagas": "vagas", "banheiros": "banheiros"}
    for chave, coluna in minimos.items():
        if filtros.get(f"{chave}_min") is not None and chave not in ignorar:
            onde.append(f"{coluna} >= :{chave}_min")
            params[f"{chave}_min"] = int(filtros[f"{chave}_min"])
    for chave, coluna in (("valor", "valor"), ("area", "area_m2")):
        if chave in ignorar:
            continue
        if filtros.get(f"{chave}_min") is not None:
            onde.append(f"{coluna} >= :{chave}_min")
            params[f"{chave}_min"] = float(filtros[f"{chave}_min"])
        if filtros.get(f"{chave}_max") is not None:
            onde.append(f"{coluna} <= :{chave}_max")
            params[f"{chave}_max"] = float(filtros[f"{chave}_max"])
    if filtros.get("destaque"):
        onde.append("destaque = TRUE")
    return " AND ".join(onde), params


def _item(r, base: Optional[str] = None) -> Dict[str, Any]:
    return {
        "codigo": r.codigo_imoview, "titulo": r.titulo, "finalidade": r.finalidade, "tipo": r.tipo,
        "bairro": r.bairro, "cidade": r.cidade, "estado": r.estado,
        "valor": float(r.valor) if r.valor is not None else None,
        "valor_condominio": float(r.valor_condominio) if r.valor_condominio is not None else None,
        "quartos": r.quartos, "suites": r.suites, "banheiros": r.banheiros, "vagas": r.vagas,
        "area_m2": float(r.area_m2) if r.area_m2 is not None else None,
        "situacao": r.situacao, "destaque": r.destaque, "ativo": r.ativo,
        "link": link_do_imovel(base, r.link_anuncio, r.codigo_imoview, r.titulo, r.tipo, r.bairro),
        "foto_url": r.foto_url or None,
    }


_COLUNAS = """codigo_imoview, titulo, finalidade, tipo, bairro, cidade, estado, valor, valor_condominio,
    quartos, suites, banheiros, vagas, area_m2, situacao, destaque, ativo, link_anuncio,
    dados_extras->>'foto_url' AS foto_url"""


async def listar(
    session,
    tenant_id: UUID,
    filtros: Dict[str, Any],
    ordem: str = "recentes",
    pagina: int = 1,
    por_pagina: int = POR_PAGINA_PADRAO,
    com_facetas: bool = True,
) -> Dict[str, Any]:
    por_pagina = max(1, min(int(por_pagina), POR_PAGINA_MAX))
    pagina = max(1, int(pagina))
    onde, params = montar_filtros(tenant_id, filtros)
    ordenacao = ORDENACOES.get(ordem, ORDENACOES["recentes"])
    # Quem busca por um código quer aquele imóvel primeiro.
    termo = (filtros.get("busca") or "").strip()
    if re.fullmatch(r"\d{3,9}", termo):
        ordenacao = f"(codigo_imoview::text = :codigo_exato) DESC, {ordenacao}"
        params["codigo_exato"] = termo

    total = (await session.execute(text(f"SELECT COUNT(*) FROM imoveis_cache WHERE {onde}"), params)).scalar() or 0
    linhas = (await session.execute(
        text(f"""
            SELECT {_COLUNAS} FROM imoveis_cache WHERE {onde}
            ORDER BY {ordenacao} LIMIT :limite OFFSET :deslocamento
        """),
        {**params, "limite": por_pagina, "deslocamento": (pagina - 1) * por_pagina},
    )).fetchall()

    base = await base_do_tenant(session, tenant_id)
    resposta: Dict[str, Any] = {
        "itens": [_item(r, base) for r in linhas],
        "total": total,
        "pagina": pagina,
        "por_pagina": por_pagina,
        "paginas": max(1, -(-total // por_pagina)),
    }
    if com_facetas:
        resposta["facetas"] = await facetas(session, tenant_id, filtros)
    return resposta


async def obter_itens(session, tenant_id: UUID, codigos: List[int]) -> List[Dict[str, Any]]:
    """Imóveis do cache pelos códigos, na ordem pedida (códigos que não existem são ignorados)."""
    if not codigos:
        return []
    linhas = (await session.execute(
        text(f"SELECT {_COLUNAS} FROM imoveis_cache WHERE tenant_id = :tid AND codigo_imoview = ANY(:codigos)"),
        {"tid": str(tenant_id), "codigos": list(codigos)},
    )).fetchall()
    base = await base_do_tenant(session, tenant_id)
    por_codigo = {r.codigo_imoview: _item(r, base) for r in linhas}
    return [por_codigo[c] for c in codigos if c in por_codigo]


async def facetas(session, tenant_id: UUID, filtros: Dict[str, Any]) -> Dict[str, Any]:
    """Contagens por finalidade, tipo, bairro e cidade, e faixas de valor e área."""
    resultado: Dict[str, Any] = {}
    for dimensao, limite in (("finalidade", 5), ("tipo", 30), ("bairro", 60), ("cidade", 30)):
        onde, params = montar_filtros(tenant_id, filtros, ignorar=(dimensao,))
        linhas = (await session.execute(
            text(f"""
                SELECT {dimensao} AS valor, COUNT(*) AS qtd FROM imoveis_cache
                WHERE {onde} AND {dimensao} IS NOT NULL AND {dimensao} <> ''
                GROUP BY {dimensao} ORDER BY qtd DESC, {dimensao} LIMIT {limite}
            """),
            params,
        )).fetchall()
        resultado[dimensao] = [{"valor": l.valor, "quantidade": l.qtd} for l in linhas]

    onde, params = montar_filtros(tenant_id, filtros, ignorar=("valor", "area"))
    faixa = (await session.execute(
        text(f"SELECT MIN(valor) AS vmin, MAX(valor) AS vmax, MIN(area_m2) AS amin, MAX(area_m2) AS amax FROM imoveis_cache WHERE {onde}"),
        params,
    )).first()
    resultado["faixas"] = {
        "valor_min": float(faixa.vmin) if faixa.vmin is not None else None,
        "valor_max": float(faixa.vmax) if faixa.vmax is not None else None,
        "area_min": float(faixa.amin) if faixa.amin is not None else None,
        "area_max": float(faixa.amax) if faixa.amax is not None else None,
    }
    return resultado


# --- Detalhe ------------------------------------------------------------------

def _reais(valor: Optional[float]) -> str:
    return "R$ " + f"{valor:,.0f}".replace(",", ".") if valor else ""


def texto_compartilhar(item: Dict[str, Any], extras: Dict[str, Any]) -> str:
    """Texto pronto para colar numa conversa com o cliente."""
    local = f"*{item['tipo'] or 'Imóvel'}* no bairro *{item['bairro'] or 'não informado'}*"
    if item.get("cidade"):
        local += f" - {item['cidade']}"
    linhas = [local]
    ficha = []
    if item.get("quartos"):
        ficha.append(f"{item['quartos']} quarto(s)")
    if item.get("suites"):
        ficha.append(f"{item['suites']} suíte(s)")
    if item.get("vagas"):
        ficha.append(f"{item['vagas']} vaga(s)")
    if item.get("area_m2"):
        ficha.append(f"{item['area_m2']:.0f} m²")
    if ficha:
        linhas.append(" • ".join(ficha))
    if item.get("valor"):
        rotulo = "Aluguel" if item["finalidade"] == "aluguel" else "Venda"
        sufixo = "/mês" if item["finalidade"] == "aluguel" else ""
        linhas.append(f"{rotulo}: *{_reais(item['valor'])}{sufixo}*")
    if item.get("valor_condominio"):
        linhas.append(f"Condomínio: {_reais(item['valor_condominio'])}")
    linhas.append(f"Código: {item['codigo']}")
    if item.get("link"):
        linhas.append(item["link"])
    return "\n".join(linhas)


def _detalhe(r, base: Optional[str] = None) -> Dict[str, Any]:
    extras = r.dados_extras if isinstance(r.dados_extras, dict) else {}
    item = _item(r, base)
    item["foto_url"] = extras.get("foto_url") or None
    detalhe = {
        **item,
        "descricao": extras.get("descricao"),
        "fotos": extras.get("fotos") or ([{"url": item["foto_url"], "descricao": ""}] if item["foto_url"] else []),
        "endereco": extras.get("endereco") or {},
        "caracteristicas": extras.get("caracteristicas") or [],
        "extras": extras.get("extras") or [],
        "salas": extras.get("salas"), "varandas": extras.get("varandas"), "andar": extras.get("andar"),
        "ano_construcao": extras.get("ano_construcao"), "tipo_vagas": extras.get("tipo_vagas"),
        "valor_iptu": extras.get("valor_iptu"), "valor_m2": extras.get("valor_m2"),
        "aceita_financiamento": bool(extras.get("aceita_financiamento")),
        "aceita_permuta": bool(extras.get("aceita_permuta")),
        "exclusivo": bool(extras.get("exclusivo")), "destinacao": extras.get("destinacao"),
        "area_lote": extras.get("area_lote"), "url_video": extras.get("url_video"),
        "latitude": extras.get("latitude"), "longitude": extras.get("longitude"),
        "cadastrado_em": extras.get("cadastrado_em"), "alterado_em": extras.get("alterado_em"),
        "sincronizado_em": r.synced_at.isoformat() if r.synced_at else None,
    }
    detalhe["texto_compartilhar"] = texto_compartilhar(item, extras)
    return detalhe


_SELECAO_DETALHE = f"SELECT {_COLUNAS}, dados_extras, synced_at FROM imoveis_cache WHERE tenant_id = :tid AND codigo_imoview = :codigo"


async def obter_detalhe(session, tenant_id: UUID, codigo: int, cliente: Optional[Any] = None) -> Optional[Dict[str, Any]]:
    """
    Detalhe de um imóvel do cache. Se o cache ainda não tem descrição nem fotos (linhas de
    antes do enriquecimento), busca no Imoview uma vez e guarda.
    """
    r = (await session.execute(text(_SELECAO_DETALHE), {"tid": str(tenant_id), "codigo": codigo})).first()
    if not r:
        return None
    extras = r.dados_extras if isinstance(r.dados_extras, dict) else {}
    if not (extras.get("descricao") or extras.get("fotos")) and not extras.get("detalhe_buscado_em"):
        if await _completar_do_imoview(session, tenant_id, r, cliente):
            r = (await session.execute(text(_SELECAO_DETALHE), {"tid": str(tenant_id), "codigo": codigo})).first()
    return _detalhe(r, await base_do_tenant(session, tenant_id))


async def _completar_do_imoview(session, tenant_id: UUID, r, cliente: Optional[Any]) -> bool:
    try:
        if cliente is None:
            creds = await carregar_credenciais(tenant_id)
            if not creds or not creds.get("chave"):
                return False
            base = await validar_base_url(creds["base_url"])
            cliente = ImoviewClient(base_url=base, chave=creds["chave"], codigo_acesso=creds.get("codigo_acesso"))
        resposta = await cliente.detalhes_imovel(r.codigo_imoview)
        bruto = resposta.get("imovel") if isinstance(resposta, dict) else None
        normalizado = normalizar_imovel(bruto, r.finalidade) if isinstance(bruto, dict) else None
    except (ImoviewError, UrlInvalida) as e:
        log.warning("detalhe_imovel_imoview_falhou", codigo=r.codigo_imoview, motivo=type(e).__name__)
        return False
    except Exception as e:  # noqa: BLE001 - o detalhe do cache continua valendo
        log.warning("detalhe_imovel_erro", codigo=r.codigo_imoview, error=str(e)[:200])
        return False

    # Marca a tentativa mesmo se o Imoview não trouxe nada, para não repetir a chamada a cada abertura.
    extras = dict(normalizado["extras"]) if normalizado else {}
    extras["detalhe_buscado_em"] = datetime.now(timezone.utc).isoformat()
    await session.execute(
        text("""
            UPDATE imoveis_cache SET dados_extras = dados_extras || CAST(:extras AS jsonb),
                   titulo = COALESCE(:titulo, titulo)
            WHERE tenant_id = :tid AND codigo_imoview = :codigo
        """),
        {
            "extras": json.dumps(extras, ensure_ascii=False), "titulo": normalizado["titulo"] if normalizado else None,
            "tid": str(tenant_id), "codigo": r.codigo_imoview,
        },
    )
    return bool(normalizado)
