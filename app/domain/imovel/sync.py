"""
Sincronização dos imóveis do Imoview para o cache local (imoveis_cache).

Usada pelo agendador (a cada ciclo) e pelo botão "Sincronizar agora" do portal. O
andamento e o resultado ficam em imoview_sync_status; uma trava no Redis impede duas
sincronizações do mesmo tenant ao mesmo tempo.

- Só grava o que mudou (hash do conteúdo); o resto apenas renova `synced_at`.
- O que deixou de vir do Imoview é desativado (`ativo = false`), nunca apagado, e só
  quando a leitura foi completa.
"""
import hashlib
import json
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy import text

from app.integration.imoview.client import (
    CircuitBreakerOpen,
    ImoviewAuthError,
    ImoviewClient,
    ImoviewError,
    ImoviewRateLimitError,
    ImoviewUnavailableError,
)
from app.integration.imoview.seguranca import UrlInvalida, validar_base_url
from app.shared.database import get_session
from app.shared.redis import get_redis_pool
from app.shared.security import decrypt_credentials

log = structlog.get_logger()

REGISTROS_POR_PAGINA = 20  # a API do Imoview recusa mais que 20 por página
MAX_PAGINAS = 300
FINALIDADES = ((1, "aluguel"), (2, "venda"))
LOCK_TTL = 1800
CHAVE_PEDIDOS = "imoview:sync:pedidos"
CHAVE_LOCK = "imoview:sync:lock:{}"
# Sem atualização por tanto tempo, uma sincronização "executando" é tratada como interrompida.
PARADA_APOS = timedelta(minutes=10)
# Se mais que isso do cache sumisse de uma vez, o mais provável é uma leitura incompleta.
LIMITE_DESATIVAR = 0.5

_TZ = ZoneInfo("America/Sao_Paulo")
_SCRIPT_LIBERAR = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0"

CARACTERISTICAS = {
    "arcondicionado": "Ar-condicionado", "areaservico": "Área de serviço", "armariocozinha": "Armário na cozinha",
    "armarioquarto": "Armário no quarto", "armariobanheiro": "Armário no banheiro", "box": "Box", "closet": "Closet",
    "despensa": "Despensa", "escritorio": "Escritório", "lavabo": "Lavabo", "mobiliado": "Mobiliado",
    "rouparia": "Rouparia", "dce": "Dependência de empregada", "aguaindividual": "Água individual",
    "alarme": "Alarme", "aquecedorgas": "Aquecedor a gás", "aquecedoreletrico": "Aquecedor elétrico",
    "aquecedorsolar": "Aquecedor solar", "cercaeletrica": "Cerca elétrica", "circuitotv": "Circuito de TV",
    "gascanalizado": "Gás canalizado", "interfone": "Interfone", "jardim": "Jardim", "lavanderia": "Lavanderia",
    "portaoeletronico": "Portão eletrônico", "portaria24horas": "Portaria 24h", "seguranca24horas": "Segurança 24h",
    "quintal": "Quintal", "gramado": "Gramado", "academia": "Academia", "churrasqueira": "Churrasqueira",
    "hidromassagem": "Hidromassagem", "homecinema": "Home cinema", "piscina": "Piscina", "playground": "Playground",
    "quadraesportiva": "Quadra esportiva", "quadratenis": "Quadra de tênis", "salamassagem": "Sala de massagem",
    "salaofestas": "Salão de festas", "salaojogos": "Salão de jogos", "sauna": "Sauna", "wifi": "Wi-Fi",
    "espacogourmet": "Espaço gourmet", "garageband": "Garage band", "quadrasquash": "Quadra de squash",
    "beachtenis": "Beach tennis", "varandagourmet": "Varanda gourmet", "lareira": "Lareira",
    "cabeamentoestruturado": "Cabeamento estruturado", "tvacabo": "TV a cabo", "conexaointernet": "Internet",
    "vistamar": "Vista para o mar", "vistamontanha": "Vista para a montanha", "vistalago": "Vista para o lago",
    "permiteanimais": "Aceita animais", "solmanha": "Sol da manhã",
}


class SemCredenciais(Exception):
    """O tenant ainda não configurou a integração com o Imoview."""


# --- Conversões ---------------------------------------------------------------

def numero_br(bruto: Any) -> Optional[float]:
    """'R$ 2.000.000,00' -> 2000000.0; '117,00' -> 117.0; '1.234,56' -> 1234.56; vazio -> None."""
    if bruto is None or isinstance(bruto, bool):
        return None
    if isinstance(bruto, (int, float)):
        return float(bruto)
    limpo = re.sub(r"[^\d,.\-]", "", str(bruto))
    if not limpo or limpo in ("-", ",", "."):
        return None
    if "," in limpo:
        limpo = limpo.replace(".", "").replace(",", ".")
    elif limpo.count(".") > 1:
        limpo = limpo.replace(".", "")
    try:
        return float(limpo)
    except ValueError:
        return None


def inteiro(bruto: Any) -> Optional[int]:
    valor = numero_br(bruto)
    return int(valor) if valor is not None else None


def data_br(bruto: Any) -> Optional[str]:
    """'24/10/2026 09:31:32' (horário de Brasília) -> ISO 8601 com fuso."""
    if not bruto:
        return None
    for formato in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y"):
        try:
            return datetime.strptime(str(bruto).strip(), formato).replace(tzinfo=_TZ).isoformat()
        except ValueError:
            continue
    return None


def sem_acento(texto: Optional[str]) -> str:
    """Minúsculo, sem acento e sem espaços repetidos: forma usada na coluna `busca`."""
    base = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", base.lower()).strip()


def _https(url: Any) -> Optional[str]:
    return url if isinstance(url, str) and url.startswith("https://") else None


def normalizar_imovel(im: Dict[str, Any], finalidade: str) -> Optional[Dict[str, Any]]:
    """Converte um imóvel do Imoview em colunas do cache + `dados_extras` (com hash do conteúdo)."""
    codigo = inteiro(im.get("codigo"))
    if not codigo:
        return None

    fotos: List[Dict[str, str]] = []
    for f in im.get("fotos") or []:
        if isinstance(f, dict) and _https(f.get("url")):
            fotos.append({"url": f["url"], "descricao": (f.get("descricao") or "")[:200]})
    foto_url = _https(im.get("urlfotoprincipal")) or (fotos[0]["url"] if fotos else "")

    extras_lista = []
    for e in im.get("extras") or []:
        nome = (e.get("nome") or e.get("descricao") or "") if isinstance(e, dict) else str(e)
        if nome.strip():
            extras_lista.append(nome.strip()[:80])

    endereco = {
        "logradouro": im.get("endereco") or "", "numero": im.get("numero") or "",
        "complemento": (im.get("complemento") or "").strip(), "bairro": im.get("bairro") or "",
        "cidade": im.get("cidade") or "", "estado": im.get("estado") or "", "cep": im.get("cep") or "",
        "edificio": (im.get("edificio") or "").strip(), "condominio": (im.get("nomecondominio") or "").strip(),
    }
    extras: Dict[str, Any] = {
        "foto_url": foto_url, "fotos": fotos[:40],
        "descricao": (im.get("descricao") or "").strip(),
        "endereco": endereco,
        "latitude": numero_br(im.get("latitude")), "longitude": numero_br(im.get("longitude")),
        "destinacao": im.get("destinacao") or "",
        "area_interna": numero_br(im.get("areainterna")), "area_lote": numero_br(im.get("arealote")),
        "salas": inteiro(im.get("numerosalas")), "varandas": inteiro(im.get("numerovarandas")),
        "tipo_vagas": im.get("tipovagas") or "", "andar": inteiro(im.get("numeroandar")),
        "ano_construcao": inteiro(im.get("anoconstrucao")) if (inteiro(im.get("anoconstrucao")) or 0) > 1900 else None,
        "valor_iptu": numero_br(im.get("valoriptu")), "valor_m2": numero_br(im.get("valorm2")),
        "aceita_financiamento": bool(im.get("aceitafinanciamento")), "aceita_permuta": bool(im.get("aceitapermuta")),
        "exclusivo": bool(im.get("exclusivo")), "url_video": _https(im.get("urlvideo")) or "",
        "caracteristicas": [rotulo for chave, rotulo in CARACTERISTICAS.items() if im.get(chave) is True],
        "extras": extras_lista[:30],
        "cadastrado_em": data_br(im.get("datahoracadastro")), "alterado_em": data_br(im.get("datahoraultimaalteracao")),
    }
    extras = {k: v for k, v in extras.items() if v not in (None, "", [], {})}

    titulo = (im.get("titulo") or "").strip() or None
    tipo = im.get("tipo") or "Imóvel"
    colunas = {
        "codigo": codigo, "finalidade": finalidade, "tipo": tipo, "bairro": im.get("bairro"),
        "cidade": im.get("cidade"), "estado": (im.get("estado") or "")[:2] or None,
        "area_m2": numero_br(im.get("areaprincipal")) or numero_br(im.get("areainterna")),
        "quartos": inteiro(im.get("numeroquartos")), "vagas": inteiro(im.get("numerovagas")),
        "banheiros": inteiro(im.get("numerobanhos")), "suites": inteiro(im.get("numerosuites")),
        "valor": numero_br(im.get("valor")), "valor_condominio": numero_br(im.get("valorcondominio")),
        "situacao": im.get("situacao"), "link": im.get("urlpublica") or None, "titulo": titulo,
        "destaque": str(im.get("destaque") or "").strip().lower() == "destaque",
        "busca": sem_acento(f"{codigo} {tipo} {im.get('bairro') or ''} {im.get('cidade') or ''} {titulo or ''}"),
    }
    hash_conteudo = hashlib.md5(json.dumps([colunas, extras], sort_keys=True, default=str).encode()).hexdigest()
    return {**colunas, "extras": {**extras, "hash": hash_conteudo}, "hash": hash_conteudo}


# --- Credenciais --------------------------------------------------------------

async def carregar_credenciais(tenant_id: UUID) -> Optional[Dict[str, Any]]:
    async with get_session(tenant_id) as session:
        linha = (await session.execute(
            text("SELECT imoview_creds FROM tenants WHERE id = :tid"), {"tid": str(tenant_id)}
        )).first()
    if not linha or not linha.imoview_creds:
        return None
    return json.loads(decrypt_credentials(linha.imoview_creds))


# --- Status -------------------------------------------------------------------

_COLUNAS_STATUS = {
    "estado", "origem", "etapa", "iniciado_em", "concluido_em", "ultimo_sucesso_em",
    "total_remoto", "processados", "novos", "atualizados", "desativados", "erro",
}


async def _gravar_status(tenant_id: UUID, **campos: Any) -> None:
    assert set(campos) <= _COLUNAS_STATUS
    nomes = list(campos)
    async with get_session(tenant_id) as session:
        await session.execute(
            text(f"""
                INSERT INTO imoview_sync_status (tenant_id, {', '.join(nomes)}, atualizado_em)
                VALUES (:tid, {', '.join(':' + n for n in nomes)}, NOW())
                ON CONFLICT (tenant_id) DO UPDATE SET
                    {', '.join(f'{n} = EXCLUDED.{n}' for n in nomes)}, atualizado_em = NOW()
            """),
            {"tid": str(tenant_id), **campos},
        )


async def obter_status(session, tenant_id: UUID) -> Dict[str, Any]:
    """Estado da sincronização e totais do cache, para o portal."""
    linha = (await session.execute(
        text("SELECT * FROM imoview_sync_status WHERE tenant_id = :tid"), {"tid": str(tenant_id)}
    )).first()
    totais = (await session.execute(
        text("""
            SELECT COUNT(*) FILTER (WHERE ativo) AS ativos, COUNT(*) FILTER (WHERE NOT ativo) AS inativos,
                   MAX(synced_at) AS ultima_leitura
            FROM imoveis_cache WHERE tenant_id = :tid
        """),
        {"tid": str(tenant_id)},
    )).first()

    redis = get_redis_pool()
    na_fila = bool(await redis.sismember(CHAVE_PEDIDOS, str(tenant_id)))
    estado = linha.estado if linha else "ocioso"
    if estado == "executando" and linha and datetime.now(timezone.utc) - linha.atualizado_em > PARADA_APOS:
        estado = "erro"  # processo interrompido no meio

    def iso(valor):
        return valor.isoformat() if valor else None

    return {
        "estado": "na_fila" if na_fila and estado != "executando" else estado,
        "origem": linha.origem if linha else None,
        "etapa": linha.etapa if (linha and estado == "executando") else None,
        "iniciado_em": iso(linha.iniciado_em) if linha else None,
        "concluido_em": iso(linha.concluido_em) if linha else None,
        "ultimo_sucesso_em": iso(linha.ultimo_sucesso_em) if linha else None,
        "total_remoto": linha.total_remoto if linha else 0,
        "processados": linha.processados if linha else 0,
        "novos": linha.novos if linha else 0,
        "atualizados": linha.atualizados if linha else 0,
        "desativados": linha.desativados if linha else 0,
        "erro": (linha.erro if estado == "erro" else None) if linha else None,
        "aviso": linha.erro if (linha and estado == "ok" and linha.erro) else None,
        "imoveis_ativos": totais.ativos or 0,
        "imoveis_inativos": totais.inativos or 0,
        "ultima_leitura": iso(totais.ultima_leitura),
    }


# --- Pedidos manuais ----------------------------------------------------------

async def solicitar_sync(tenant_id: UUID) -> str:
    """Pede uma sincronização; o agendador a atende em poucos segundos. Devolve 'executando' ou 'na_fila'."""
    redis = get_redis_pool()
    if await redis.exists(CHAVE_LOCK.format(tenant_id)):
        return "executando"
    await redis.sadd(CHAVE_PEDIDOS, str(tenant_id))
    return "na_fila"


async def processar_pedidos() -> int:
    """Atende os pedidos manuais pendentes (chamado pelo agendador). Devolve quantos tenants rodaram."""
    pedidos = await get_redis_pool().spop(CHAVE_PEDIDOS, 20) or []
    for pedido in pedidos:
        try:
            await sincronizar_tenant(UUID(pedido), origem="manual")
        except Exception as e:  # noqa: BLE001 - um tenant com problema não trava os outros
            log.error("sync_pedido_falhou", tenant_id=str(pedido)[:8], error=str(e)[:200])
    return len(pedidos)


# --- Sincronização ------------------------------------------------------------

_UPSERT = text("""
    INSERT INTO imoveis_cache (
        tenant_id, codigo_imoview, finalidade, tipo, bairro, cidade, estado, area_m2, quartos, vagas,
        banheiros, suites, valor, valor_condominio, situacao, link_anuncio, titulo, destaque, busca,
        ativo, dados_extras, synced_at
    ) VALUES (
        :tid, :codigo, :finalidade, :tipo, :bairro, :cidade, :estado, :area_m2, :quartos, :vagas,
        :banheiros, :suites, :valor, :valor_condominio, :situacao, :link, :titulo, :destaque, :busca,
        TRUE, CAST(:extras AS jsonb), NOW()
    )
    ON CONFLICT (tenant_id, codigo_imoview) DO UPDATE SET
        finalidade = EXCLUDED.finalidade, tipo = EXCLUDED.tipo, bairro = EXCLUDED.bairro,
        cidade = EXCLUDED.cidade, estado = EXCLUDED.estado, area_m2 = EXCLUDED.area_m2,
        quartos = EXCLUDED.quartos, vagas = EXCLUDED.vagas, banheiros = EXCLUDED.banheiros,
        suites = EXCLUDED.suites, valor = EXCLUDED.valor, valor_condominio = EXCLUDED.valor_condominio,
        situacao = EXCLUDED.situacao, link_anuncio = EXCLUDED.link_anuncio, titulo = EXCLUDED.titulo,
        destaque = EXCLUDED.destaque, busca = EXCLUDED.busca, ativo = TRUE,
        dados_extras = EXCLUDED.dados_extras, synced_at = NOW()
""")

_RENOVAR = text("""
    UPDATE imoveis_cache SET synced_at = NOW(), ativo = TRUE
    WHERE tenant_id = :tid AND codigo_imoview = ANY(:codigos)
""")


def mensagem_de_erro(e: Exception) -> str:
    """Texto seguro para mostrar ao usuário (nunca inclui a chave nem a resposta crua)."""
    if isinstance(e, SemCredenciais):
        return "A integração com o Imoview ainda não foi configurada."
    if isinstance(e, UrlInvalida):
        return str(e)
    if isinstance(e, ImoviewAuthError):
        return "O Imoview recusou a chave de acesso. Confira a chave e tente de novo."
    if isinstance(e, ImoviewRateLimitError):
        return "O Imoview limitou as requisições por ora. A próxima sincronização tenta de novo."
    if isinstance(e, (CircuitBreakerOpen, ImoviewUnavailableError)):
        return "O Imoview está indisponível no momento. Tente de novo em instantes."
    if isinstance(e, ImoviewError):
        return "O Imoview respondeu com erro. Tente de novo em instantes."
    return "A sincronização falhou por um erro inesperado."


async def sincronizar_tenant(
    tenant_id: UUID,
    origem: str = "agendada",
    cliente: Optional[Any] = None,
    validar_dns: bool = True,
) -> Dict[str, Any]:
    """
    Lê todos os imóveis disponíveis do Imoview e atualiza o cache.

    `cliente` (opcional) permite injetar um cliente já pronto (testes); sem ele, usa as
    credenciais salvas do tenant. Devolve o resumo da execução.
    """
    redis = get_redis_pool()
    chave_lock, token = CHAVE_LOCK.format(tenant_id), uuid4().hex
    if not await redis.set(chave_lock, token, nx=True, ex=LOCK_TTL):
        return {"ignorado": True, "motivo": "já em andamento"}

    agora = lambda: datetime.now(timezone.utc)  # noqa: E731
    contagem = {"processados": 0, "novos": 0, "atualizados": 0, "desativados": 0, "total_remoto": 0}
    try:
        await _gravar_status(
            tenant_id, estado="executando", origem=origem, etapa="conectando", iniciado_em=agora(),
            concluido_em=None, erro=None, **contagem,
        )
        if cliente is None:
            creds = await carregar_credenciais(tenant_id)
            if not creds or not creds.get("chave"):
                raise SemCredenciais()
            base = await validar_base_url(creds["base_url"]) if validar_dns else creds["base_url"]
            cliente = ImoviewClient(base_url=base, chave=creds["chave"], codigo_acesso=creds.get("codigo_acesso"))

        async with get_session(tenant_id) as session:
            linhas = (await session.execute(
                text("SELECT codigo_imoview, ativo, dados_extras->>'hash' AS hash FROM imoveis_cache WHERE tenant_id = :tid"),
                {"tid": str(tenant_id)},
            )).fetchall()
        existentes: Dict[int, Tuple[bool, Optional[str]]] = {l.codigo_imoview: (l.ativo, l.hash) for l in linhas}

        vistos: set = set()
        leitura_completa = True
        for codigo_finalidade, nome in FINALIDADES:
            pagina, quantidade = 1, 0
            while True:
                if pagina > MAX_PAGINAS:
                    leitura_completa = False
                    break
                resposta = await cliente.buscar_imoveis(
                    finalidade=codigo_finalidade, pagina=pagina, registros=REGISTROS_POR_PAGINA
                )
                lista = resposta.get("lista", []) if isinstance(resposta, dict) else []
                if not lista:
                    break
                if pagina == 1:
                    quantidade = inteiro(resposta.get("quantidade")) or 0
                    contagem["total_remoto"] += quantidade

                novos_ou_alterados, iguais = [], []
                for bruto in lista:
                    n = normalizar_imovel(bruto, nome)
                    if not n:
                        continue
                    vistos.add(n["codigo"])
                    anterior = existentes.get(n["codigo"])
                    if anterior and anterior[0] and anterior[1] == n["hash"]:
                        iguais.append(n["codigo"])
                    else:
                        novos_ou_alterados.append(n)
                        contagem["atualizados" if anterior else "novos"] += 1

                async with get_session(tenant_id) as session:
                    if novos_ou_alterados:
                        await session.execute(_UPSERT, [
                            {
                                "tid": str(tenant_id), "codigo": n["codigo"], "finalidade": n["finalidade"],
                                "tipo": n["tipo"], "bairro": n["bairro"], "cidade": n["cidade"], "estado": n["estado"],
                                "area_m2": n["area_m2"], "quartos": n["quartos"], "vagas": n["vagas"],
                                "banheiros": n["banheiros"], "suites": n["suites"], "valor": n["valor"],
                                "valor_condominio": n["valor_condominio"], "situacao": n["situacao"], "link": n["link"],
                                "titulo": n["titulo"], "destaque": n["destaque"], "busca": n["busca"],
                                "extras": json.dumps(n["extras"], ensure_ascii=False),
                            }
                            for n in novos_ou_alterados
                        ])
                    if iguais:
                        await session.execute(_RENOVAR, {"tid": str(tenant_id), "codigos": iguais})

                contagem["processados"] += len(lista)
                await _gravar_status(tenant_id, etapa=f"lendo {nome}", **contagem)
                if quantidade and pagina * REGISTROS_POR_PAGINA >= quantidade:
                    break
                pagina += 1

        aviso: Optional[str] = None
        ativos_antes = [c for c, (ativo, _) in existentes.items() if ativo]
        sumidos = [c for c in ativos_antes if c not in vistos]
        if sumidos and leitura_completa and vistos:
            if len(ativos_antes) > 20 and len(sumidos) / len(ativos_antes) > LIMITE_DESATIVAR:
                aviso = (
                    f"{len(sumidos)} imóveis deixaram de aparecer no Imoview de uma vez; por precaução "
                    "nenhum foi desativado. Confira o Imoview e sincronize de novo."
                )
                log.warning("sync_imoveis_desativacao_em_massa_bloqueada", tenant_id=str(tenant_id)[:8], sumidos=len(sumidos))
            else:
                async with get_session(tenant_id) as session:
                    await session.execute(
                        text("UPDATE imoveis_cache SET ativo = FALSE WHERE tenant_id = :tid AND codigo_imoview = ANY(:codigos)"),
                        {"tid": str(tenant_id), "codigos": sumidos},
                    )
                contagem["desativados"] = len(sumidos)
        elif sumidos and not leitura_completa:
            aviso = "A leitura não chegou ao fim; nada foi desativado."

        await _gravar_status(
            tenant_id, estado="ok", etapa=None, concluido_em=agora(), ultimo_sucesso_em=agora(), erro=aviso, **contagem
        )
        log.info("sync_imoveis_concluido", tenant_id=str(tenant_id)[:8], origem=origem, **contagem)
        return {"ok": True, **contagem, "aviso": aviso}

    except Exception as e:  # noqa: BLE001 - qualquer falha vira status 'erro' legível
        if not isinstance(e, (SemCredenciais, UrlInvalida, ImoviewError)):
            log.error("sync_imoveis_falha", tenant_id=str(tenant_id)[:8], error=str(e)[:300])
        else:
            log.warning("sync_imoveis_falha", tenant_id=str(tenant_id)[:8], motivo=type(e).__name__)
        await _gravar_status(tenant_id, estado="erro", etapa=None, concluido_em=agora(), erro=mensagem_de_erro(e), **contagem)
        return {"ok": False, "erro": mensagem_de_erro(e), **contagem}
    finally:
        await redis.eval(_SCRIPT_LIBERAR, 1, chave_lock, token)
