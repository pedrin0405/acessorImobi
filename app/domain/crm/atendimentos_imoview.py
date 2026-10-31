"""
Fases dos atendimentos do CRM do Imoview espelhadas nas negociações do portal.

- A API de atendimentos não informa a fase no item: só o filtro `fase` (1..8) a revela. Por isso a leitura
  percorre cada (finalidade, fase) e grava a fase em `imoview_atendimentos`.
- Os nomes das fases não são expostos sem o login de app do Imoview. O gestor liga cada fase a uma etapa do
  portal (tenants.dados.imoview_funil); sem mapa, nada se move. Só a situação tem regra fixa, e só com
  "Espelhar o Imoview" ligado: Negócio realizado -> ganho, Descartado -> perdido.
- Imoview -> portal: o sync move o negócio só quando a fase/situação do atendimento MUDOU (não desfaz uma
  mudança feita no portal enquanto o Imoview não mexe).
- Portal -> Imoview: a escrita exige o código de acesso do usuário do Imoview e a API não documenta o contrato.
  Em vez de escrever às cegas, a mudança entra na fila `imoview_alteracoes_pendentes`, pronta para um
  `EnviadorImoview`. Nada aqui escreve no Imoview.
"""
import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Protocol, Tuple
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy import text

from app.domain.crm.fluxo_imoview import ETAPA_DO_ESTAGIO, ESTAGIOS, ROTULO_ESTAGIO, deduzir_estagio, montar_detalhes
from app.domain.crm.importacao_imoview import _data
from app.domain.imovel.sync import SemCredenciais, carregar_credenciais, inteiro, mensagem_de_erro, sem_acento
from app.integration.imoview.client import ImoviewClient, ImoviewRateLimitError, ImoviewUnavailableError
from app.integration.imoview.seguranca import validar_base_url
from app.shared.database import get_admin_session, get_session
from app.shared.redis import get_redis_pool

log = structlog.get_logger()

FINALIDADES = ("2", "1")  # 2 = venda, 1 = aluguel (obrigatório: sem finalidade a API devolve vazio)
FASES = tuple(range(1, 9))
POR_PAGINA = 20
CONCORRENCIA = 3
CHAVE_PEDIDOS = "imoview:funil:pedidos"
CHAVE_LOCK = "imoview:funil:lock:{}"
LOCK_TTL = 6 * 3600
PARADA_APOS = timedelta(minutes=10)
MARGEM_INCREMENTAL = timedelta(hours=2)
_TZ = ZoneInfo("America/Sao_Paulo")
_SCRIPT_LIBERAR = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0"
MOTIVO_DESCARTE = "Descartado no Imoview"

SITUACAO_ATIVA, SITUACAO_GANHO, SITUACAO_DESCARTADO = "em_atendimento", "negocio_realizado", "descartado"


# --- Funções puras --------------------------------------------------------------------

def situacao_tipo(bruto: Optional[str]) -> str:
    s = sem_acento(bruto).lower()
    if "negocio realizado" in s or "fechad" in s:
        return SITUACAO_GANHO
    if "descartad" in s:
        return SITUACAO_DESCARTADO
    return SITUACAO_ATIVA


def normalizar_atendimento(bruto: Dict[str, Any], finalidade: int, fase: int) -> Optional[Dict[str, Any]]:
    codigo = inteiro(bruto.get("codigo"))
    if not codigo:
        return None
    lead = bruto.get("lead") if isinstance(bruto.get("lead"), dict) else {}
    detalhes = montar_detalhes(bruto, _data)
    texto = lambda v, n: (str(v or "").strip()[:n] or None)  # noqa: E731
    return {
        "codigo": codigo, "finalidade": finalidade, "fase": fase,
        "lead_codigo": inteiro(lead.get("codigo")),
        "situacao": texto(bruto.get("situacao"), 40),
        "situacao_tipo": situacao_tipo(bruto.get("situacao")),
        "termometro": texto(bruto.get("termometro"), 20),
        "corretor_codigo": inteiro(bruto.get("corretorcodigo")),
        "incluido_em": _data(bruto.get("datahorainclusao")),
        "alterado_em": _data(bruto.get("datahoraultimaalteracao")) or _data(bruto.get("datahorainclusao")),
        "estagio": deduzir_estagio(bruto),
        "funil": texto(bruto.get("funil"), 60), "midia": texto(bruto.get("midia"), 120), "campanha": texto(bruto.get("campanha"), 200),
        "unidade": texto(bruto.get("unidadenome"), 120), "corretor_nome": texto(bruto.get("corretor"), 120),
        "mql_nome": texto(bruto.get("mql"), 120), "qualificado": bruto.get("leadqualificado") is True,
        "entrada_em": _data(bruto.get("datahoraentradalead")), "primeira_resposta_em": _data(bruto.get("datahora1Resposta")),
        "ultima_interacao_em": _data(bruto.get("datahoraultimainteracao")),
        "previsao_fechamento_em": _data(bruto.get("dataprevisaofechamento")), "fechamento_em": _data(bruto.get("datafechamento")),
        "n_interacoes": len(detalhes["interacoes"]), "n_visitas": len(detalhes["visitas"]), "n_propostas": len(detalhes["propostas"]),
        "detalhes": json.dumps(detalhes, ensure_ascii=False),
    }


def ler_config(dados: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """tenants.dados.imoview_funil -> {'espelhar': bool, 'fases': {1: etapa_id|None, ...}, 'auto': bool}."""
    bruto = (dados or {}).get("imoview_funil") or {}
    fases: Dict[int, Optional[str]] = {}
    for chave, etapa in (bruto.get("fases") or {}).items():
        try:
            n = int(chave)
        except (TypeError, ValueError):
            continue
        if n in FASES and etapa:
            fases[n] = str(etapa)
    return {"espelhar": bool(bruto.get("espelhar", True)), "fases": fases, "auto": bool(bruto.get("auto", True))}


def etapa_da_fase(config: Dict[str, Any], fase: Optional[int]) -> Optional[str]:
    return config["fases"].get(fase) if fase else None


def fase_da_etapa(config: Dict[str, Any], etapa_id: str) -> Optional[int]:
    """Mapa inverso. Se várias fases apontam para a mesma etapa, vale a menor."""
    candidatas = sorted(f for f, e in config["fases"].items() if e == str(etapa_id))
    return candidatas[0] if candidatas else None


def formatar_filtro_data(quando: datetime) -> str:
    return quando.astimezone(_TZ).strftime("%d/%m/%Y %H:%M")


def combinacoes(retomar: Optional[Dict[str, Any]] = None) -> List[Tuple[str, int]]:
    """(finalidade, fase) na ordem de leitura; `retomar` pula o que já foi lido."""
    todas = [(f, n) for f in FINALIDADES for n in FASES]
    if retomar and (retomar.get("fin"), retomar.get("fase")) in todas:
        return todas[todas.index((retomar["fin"], retomar["fase"])):]
    return todas


# --- Status --------------------------------------------------------------------------

_COLUNAS = {
    "estado", "origem", "modo", "etapa", "iniciado_em", "concluido_em", "ultimo_sucesso_em", "leitura_desde",
    "total_remoto", "processados", "negocios_ligados", "negocios_movidos", "checkpoint", "erro",
}


async def _gravar_status(tenant_id: UUID, **campos: Any) -> None:
    assert set(campos) <= _COLUNAS
    if "checkpoint" in campos and campos["checkpoint"] is not None:
        campos["checkpoint"] = json.dumps(campos["checkpoint"])
    nomes = list(campos)
    valores = ", ".join(f"CAST(:{n} AS jsonb)" if n == "checkpoint" else f":{n}" for n in nomes)
    async with get_session(tenant_id) as s:
        await s.execute(
            text(f"""
                INSERT INTO imoview_funil_sync (tenant_id, {', '.join(nomes)}, atualizado_em)
                VALUES (:tid, {valores}, NOW())
                ON CONFLICT (tenant_id) DO UPDATE SET {', '.join(f'{n} = EXCLUDED.{n}' for n in nomes)}, atualizado_em = NOW()
            """),
            {"tid": str(tenant_id), **campos},
        )


async def obter_status(session, tenant_id: UUID) -> Dict[str, Any]:
    tid = str(tenant_id)
    linha = (await session.execute(text("SELECT * FROM imoview_funil_sync WHERE tenant_id = :tid"), {"tid": tid})).first()
    dados = (await session.execute(text("SELECT dados FROM tenants WHERE id = :tid"), {"tid": tid})).scalar() or {}
    config = ler_config(dados)
    etapas = [
        {"id": str(r.id), "nome": r.nome, "ordem": r.ordem}
        for r in (await session.execute(text("SELECT id, nome, ordem FROM crm_etapas WHERE tenant_id = :tid ORDER BY ordem"), {"tid": tid})).fetchall()
    ]
    por_fase = {
        r.fase: {"em_atendimento": r.ativos, "total": r.total}
        for r in (await session.execute(
            text("""SELECT fase, COUNT(*) AS total, COUNT(*) FILTER (WHERE situacao_tipo = 'em_atendimento') AS ativos
                    FROM imoview_atendimentos WHERE tenant_id = :tid GROUP BY fase"""), {"tid": tid},
        )).fetchall()
    }
    por_estagio_n = {
        r.estagio: r.n for r in (await session.execute(
            text("""SELECT estagio, COUNT(*) AS n FROM imoview_atendimentos
                    WHERE tenant_id = :tid AND situacao_tipo = 'em_atendimento' GROUP BY estagio"""), {"tid": tid},
        )).fetchall()
    }
    por_nome_etapa = await _etapas_por_estagio(session, tid)
    ligados = (await session.execute(
        text("SELECT COUNT(*) FROM crm_negocios WHERE tenant_id = :tid AND imoview_atendimento IS NOT NULL"), {"tid": tid},
    )).scalar() or 0
    sem_lead = (await session.execute(
        text("""SELECT COUNT(DISTINCT a.lead_codigo) FROM imoview_atendimentos a
                WHERE a.tenant_id = :tid AND a.lead_codigo IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM crm_leads l WHERE l.tenant_id = a.tenant_id AND l.codigo_imoview = a.lead_codigo)"""),
        {"tid": tid},
    )).scalar() or 0
    pendentes = [
        {"id": str(r.id), "negocio_id": str(r.negocio_id), "cliente": r.cliente, "atendimento": r.atendimento, "tipo": r.tipo,
         "fase_alvo": r.fase_alvo, "motivo": r.motivo, "criada_em": r.criada_em.isoformat()}
        for r in (await session.execute(
            text("""SELECT p.*, l.nome AS cliente FROM imoview_alteracoes_pendentes p
                    JOIN crm_negocios n ON n.id = p.negocio_id JOIN crm_leads l ON l.id = n.lead_id
                    WHERE p.tenant_id = :tid AND p.aplicada_em IS NULL AND p.descartada_em IS NULL
                    ORDER BY p.criada_em DESC LIMIT 20"""), {"tid": tid},
        )).fetchall()
    ]
    total_pendentes = (await session.execute(
        text("SELECT COUNT(*) FROM imoview_alteracoes_pendentes WHERE tenant_id = :tid AND aplicada_em IS NULL AND descartada_em IS NULL"),
        {"tid": tid},
    )).scalar() or 0

    redis = get_redis_pool()
    na_fila = any([bool(await redis.sismember(CHAVE_PEDIDOS, f"{tid}:{m}")) for m in ("completo", "incremental")])
    estado = linha.estado if linha else "ocioso"
    if estado == "executando" and linha and datetime.now(timezone.utc) - linha.atualizado_em > PARADA_APOS:
        estado = "erro"
    iso = lambda v: v.isoformat() if v else None  # noqa: E731
    return {
        "estado": "na_fila" if na_fila and estado != "executando" else estado,
        "modo": linha.modo if linha else None,
        "etapa": linha.etapa if (linha and estado == "executando") else None,
        "ultimo_sucesso_em": iso(linha.ultimo_sucesso_em) if linha else None,
        "total_remoto": linha.total_remoto if linha else 0,
        "processados": linha.processados if linha else 0,
        "pode_retomar": bool(linha and linha.checkpoint and estado in ("erro", "executando")),
        "erro": (linha.erro if estado == "erro" else None) if linha else None,
        "espelhar": config["espelhar"], "automatica": config["auto"],
        "fases": [
            {"fase": f, "etapa_id": config["fases"].get(f), **por_fase.get(f, {"em_atendimento": 0, "total": 0})} for f in FASES
        ],
        "etapas": etapas,
        "por_estagio": [
            {"estagio": e, "rotulo": ROTULO_ESTAGIO[e], "etapa_id": por_nome_etapa.get(e), "em_atendimento": por_estagio_n.get(e, 0)} for e in ESTAGIOS
        ],
        "negocios_ligados": ligados, "clientes_sem_cadastro": sem_lead,
        "pendentes": pendentes, "total_pendentes": total_pendentes,
        "escrita_disponivel": False,  # exige o código de acesso do usuário do Imoview (ver EnviadorImoview)
    }


# --- Configuração ---------------------------------------------------------------------

async def salvar_config(session, tenant_id: UUID, espelhar: bool, fases: Dict[str, Optional[str]], auto: Optional[bool] = None) -> Dict[str, Any]:
    tid = str(tenant_id)
    ids = {str(r[0]) for r in (await session.execute(text("SELECT id FROM crm_etapas WHERE tenant_id = :tid"), {"tid": tid})).fetchall()}
    limpo: Dict[str, str] = {}
    for chave, etapa in (fases or {}).items():
        if str(chave) not in {str(f) for f in FASES} or not etapa:
            continue
        if str(etapa) not in ids:
            raise ValueError("Etapa inexistente neste funil.")
        limpo[str(chave)] = str(etapa)
    atual = ler_config((await session.execute(text("SELECT dados FROM tenants WHERE id = :tid"), {"tid": tid})).scalar())
    novo = {"espelhar": bool(espelhar), "fases": limpo, "auto": atual["auto"] if auto is None else bool(auto)}
    await session.execute(
        text("""UPDATE tenants SET dados = jsonb_set(COALESCE(dados, '{}'::jsonb), '{imoview_funil}', CAST(:v AS jsonb), true) WHERE id = :tid"""),
        {"tid": tid, "v": json.dumps(novo)},
    )
    return novo


# --- Aplicação nas negociações -------------------------------------------------------------

_ATIVO = """
    ativo AS (
        SELECT DISTINCT ON (a.lead_codigo) a.lead_codigo, a.codigo, a.fase, a.estagio, a.situacao_tipo, a.alterado_em
        FROM imoview_atendimentos a WHERE a.tenant_id = :tid AND a.lead_codigo IS NOT NULL
        ORDER BY a.lead_codigo, (a.situacao_tipo = 'em_atendimento') DESC, a.alterado_em DESC NULLS LAST, a.codigo DESC
    ),
    alvo AS (
        SELECT DISTINCT ON (n.lead_id) n.id AS nid, a.codigo, a.fase, a.estagio, a.situacao_tipo, a.alterado_em,
               (n.imoview_atendimento IS DISTINCT FROM a.codigo OR n.imoview_fase IS DISTINCT FROM a.fase
                OR n.imoview_situacao IS DISTINCT FROM a.situacao_tipo OR n.imoview_estagio IS DISTINCT FROM a.estagio) AS mudou,
               (n.imoview_atualizado_em IS DISTINCT FROM a.alterado_em) AS alterado
        FROM ativo a
        JOIN crm_leads l ON l.tenant_id = :tid AND l.codigo_imoview = a.lead_codigo
        JOIN crm_negocios n ON n.lead_id = l.id AND n.tenant_id = :tid
        ORDER BY n.lead_id, (n.status = 'aberto') DESC, n.created_at DESC
    )
"""


async def ligar_negocios(s, tenant_id: UUID) -> List[str]:
    """Grava no negócio do cliente o atendimento que vale. Devolve os negócios em que fase/situação mudou."""
    linhas = (await s.execute(
        text(f"""
            WITH {_ATIVO}
            UPDATE crm_negocios n SET imoview_atendimento = alvo.codigo, imoview_fase = alvo.fase,
                   imoview_situacao = alvo.situacao_tipo, imoview_estagio = alvo.estagio, imoview_atualizado_em = alvo.alterado_em
            FROM alvo WHERE n.id = alvo.nid AND (alvo.mudou OR alvo.alterado)
            RETURNING n.id, alvo.mudou
        """),
        {"tid": str(tenant_id)},
    )).fetchall()
    return [str(l.id) for l in linhas if l.mudou]


async def _etapas_por_estagio(s, tid: str) -> Dict[str, str]:
    """Estágio -> id da etapa do portal com o nome correspondente (etapas renomeadas ou removidas ficam de fora)."""
    por_nome = {
        sem_acento(r.nome): str(r.id)
        for r in (await s.execute(text("SELECT id, nome FROM crm_etapas WHERE tenant_id = :tid"), {"tid": tid})).fetchall()
    }
    return {e: por_nome[ETAPA_DO_ESTAGIO[e]] for e in ESTAGIOS if ETAPA_DO_ESTAGIO[e] in por_nome}


async def espelhar_negocios(s, tenant_id: UUID, config: Dict[str, Any], ids: Optional[List[str]]) -> int:
    """Move/fecha os negócios conforme o Imoview. `ids=None` aplica a todos (ao ligar o espelho)."""
    if not config["espelhar"] or (ids is not None and not ids):
        return 0
    tid, movidos = str(tenant_id), 0
    escopo = "" if ids is None else "AND n.id = ANY(CAST(:ids AS uuid[]))"
    base = {"tid": tid, **({} if ids is None else {"ids": ids})}

    fases = sorted(config["fases"])
    por_estagio = await _etapas_por_estagio(s, tid)
    estagios = sorted(por_estagio)
    r = await s.execute(
        text(f"""
            WITH mapa_fase AS (
                SELECT * FROM unnest(CAST(:fases AS int[]), CAST(CAST(:etapas_fase AS text[]) AS uuid[])) AS m(fase, etapa_id)
            ), mapa_estagio AS (
                SELECT * FROM unnest(CAST(:estagios AS text[]), CAST(CAST(:etapas_estagio AS text[]) AS uuid[])) AS m(estagio, etapa_id)
            ), alvo AS (
                SELECT n.id AS nid, n.etapa_id AS atual, COALESCE(mf.etapa_id, me.etapa_id) AS novo FROM crm_negocios n
                LEFT JOIN mapa_fase mf ON mf.fase = n.imoview_fase
                LEFT JOIN mapa_estagio me ON me.estagio = n.imoview_estagio
                WHERE n.tenant_id = :tid AND n.status = 'aberto' AND n.imoview_situacao = 'em_atendimento' {escopo}
                  AND COALESCE(mf.etapa_id, me.etapa_id) IS NOT NULL AND n.etapa_id <> COALESCE(mf.etapa_id, me.etapa_id)
            ), movido AS (
                UPDATE crm_negocios n SET etapa_id = alvo.novo, etapa_desde = NOW(), updated_at = NOW()
                FROM alvo WHERE n.id = alvo.nid RETURNING n.id, alvo.atual, alvo.novo
            )
            INSERT INTO crm_negocio_eventos (tenant_id, negocio_id, tipo, de, para, autor)
            SELECT :tid, m.id, 'etapa', ea.nome, en.nome, 'imoview'
            FROM movido m JOIN crm_etapas ea ON ea.id = m.atual JOIN crm_etapas en ON en.id = m.novo
        """),
        {**base, "fases": fases, "etapas_fase": [config["fases"][f] for f in fases],
         "estagios": estagios, "etapas_estagio": [por_estagio[e] for e in estagios]},
    )
    movidos += r.rowcount or 0

    for situacao, status, motivo in ((SITUACAO_GANHO, "ganho", None), (SITUACAO_DESCARTADO, "perdido", MOTIVO_DESCARTE)):
        r = await s.execute(
            text(f"""
                WITH fechado AS (
                    UPDATE crm_negocios n SET status = :st, motivo_perda = :motivo, fechado_em = NOW(), updated_at = NOW()
                    WHERE n.tenant_id = :tid AND n.status = 'aberto' AND n.imoview_situacao = :sit {escopo}
                    RETURNING n.id, n.etapa_id
                )
                INSERT INTO crm_negocio_eventos (tenant_id, negocio_id, tipo, de, para, autor)
                SELECT :tid, f.id, :st, e.nome, :motivo, 'imoview' FROM fechado f JOIN crm_etapas e ON e.id = f.etapa_id
            """),
            {**base, "st": status, "motivo": motivo, "sit": situacao},
        )
        movidos += r.rowcount or 0
    return movidos


async def resolver_pendencias(s, tenant_id: UUID, ids: Optional[List[str]]) -> Dict[str, int]:
    """Pendência cujo destino o Imoview já alcançou vira 'aplicada'; se o Imoview mudou para outra coisa, é descartada."""
    escopo = "" if ids is None else "AND p.negocio_id = ANY(CAST(:ids AS uuid[]))"
    params = {"tid": str(tenant_id), **({} if ids is None else {"ids": ids})}
    if ids is not None and not ids:
        return {"aplicadas": 0, "descartadas": 0}
    ja = await s.execute(
        text(f"""
            UPDATE imoview_alteracoes_pendentes p SET aplicada_em = NOW() FROM crm_negocios n
            WHERE p.negocio_id = n.id AND p.tenant_id = :tid AND p.aplicada_em IS NULL AND p.descartada_em IS NULL {escopo}
              AND ((p.tipo = 'fase' AND n.imoview_fase = p.fase_alvo AND n.imoview_situacao = 'em_atendimento')
                OR (p.tipo = 'ganho' AND n.imoview_situacao = 'negocio_realizado')
                OR (p.tipo = 'descarte' AND n.imoview_situacao = 'descartado'))
        """), params,
    )
    sobra = await s.execute(
        text(f"""
            UPDATE imoview_alteracoes_pendentes p SET descartada_em = NOW() FROM crm_negocios n
            WHERE p.negocio_id = n.id AND p.tenant_id = :tid AND p.aplicada_em IS NULL AND p.descartada_em IS NULL {escopo}
              AND n.imoview_atualizado_em > p.criada_em
        """), params,
    )
    return {"aplicadas": ja.rowcount or 0, "descartadas": sobra.rowcount or 0}


async def aplicar(tenant_id: UUID, forcar: bool = False) -> Dict[str, int]:
    """Liga os atendimentos aos negócios e, com o espelho ligado, aplica o que mudou (ou tudo, se `forcar`)."""
    async with get_session(tenant_id) as s:
        config = ler_config((await s.execute(text("SELECT dados FROM tenants WHERE id = :tid"), {"tid": str(tenant_id)})).scalar())
        mudaram = await ligar_negocios(s, tenant_id)
        alvo = None if forcar else mudaram
        pend = await resolver_pendencias(s, tenant_id, alvo)
        movidos = await espelhar_negocios(s, tenant_id, config, alvo)
    return {"ligados": len(mudaram), "movidos": movidos, **pend}


# --- Portal -> Imoview (fila de pendências) ---------------------------------------------------

class EnviadorImoview(Protocol):
    """Ponto de encaixe da escrita no Imoview. Exige o código de acesso do usuário do Imoview e o contrato
    de `Atendimento/App_*`, que a documentação pública não descreve: ainda não há implementação."""

    async def enviar(self, pendencia: Dict[str, Any]) -> bool: ...


async def registrar_pendencia(
    session, tenant_id: UUID, negocio_id: UUID, etapa_id: Optional[str] = None, status: Optional[str] = None, motivo: Optional[str] = None,
) -> bool:
    """Chamada ao mover um negócio no portal. Só registra se o negócio tem atendimento no Imoview e há como traduzir."""
    tid = str(tenant_id)
    n = (await session.execute(
        text("SELECT imoview_atendimento, imoview_fase FROM crm_negocios WHERE id = :id AND tenant_id = :tid"),
        {"id": str(negocio_id), "tid": tid},
    )).first()
    if not n or not n.imoview_atendimento:
        return False
    config = ler_config((await session.execute(text("SELECT dados FROM tenants WHERE id = :tid"), {"tid": tid})).scalar())
    if status == "ganho":
        tipo, fase = "ganho", None
    elif status == "perdido":
        tipo, fase = "descarte", None
    elif etapa_id:
        fase = fase_da_etapa(config, etapa_id)
        if fase is None or fase == n.imoview_fase:
            return False
        tipo = "fase"
    else:
        return False
    await session.execute(
        text("""UPDATE imoview_alteracoes_pendentes SET descartada_em = NOW()
                WHERE negocio_id = :nid AND aplicada_em IS NULL AND descartada_em IS NULL"""), {"nid": str(negocio_id)},
    )
    await session.execute(
        text("""INSERT INTO imoview_alteracoes_pendentes (tenant_id, negocio_id, atendimento, tipo, fase_alvo, motivo)
                VALUES (:tid, :nid, :atend, :tipo, :fase, :motivo)"""),
        {"tid": tid, "nid": str(negocio_id), "atend": n.imoview_atendimento, "tipo": tipo, "fase": fase, "motivo": (motivo or None) and motivo[:200]},
    )
    return True


async def descartar_pendencia(session, tenant_id: UUID, pendencia_id: UUID) -> bool:
    r = await session.execute(
        text("""UPDATE imoview_alteracoes_pendentes SET descartada_em = NOW()
                WHERE id = :id AND tenant_id = :tid AND aplicada_em IS NULL AND descartada_em IS NULL"""),
        {"id": str(pendencia_id), "tid": str(tenant_id)},
    )
    return bool(r.rowcount)


# --- Leitura do Imoview ---------------------------------------------------------------------

async def _ler_pagina(cliente: Any, fin: str, fase: int, pagina: int, desde: Optional[datetime]) -> Dict[str, Any]:
    params: Dict[str, Any] = {"numeroPagina": pagina, "numeroRegistros": POR_PAGINA, "finalidade": fin, "fase": str(fase)}
    if desde:
        params["dataHoraInicialUltimaAlteracao"] = formatar_filtro_data(desde)
    for tentativa in range(4):
        try:
            return await cliente._request("GET", "/Atendimento/RetornarAtendimentos", params=params)
        except (ImoviewRateLimitError, ImoviewUnavailableError):
            if tentativa == 3:
                raise
            await asyncio.sleep(2 ** tentativa)
    raise RuntimeError("inalcançável")


_COLS_FLUXO = ('estagio', 'funil', 'midia', 'campanha', 'unidade', 'corretor_nome', 'mql_nome', 'qualificado', 'entrada_em', 'primeira_resposta_em', 'ultima_interacao_em', 'previsao_fechamento_em', 'fechamento_em', 'n_interacoes', 'n_visitas', 'n_propostas')

_UPSERT = text("""
    INSERT INTO imoview_atendimentos (tenant_id, codigo, finalidade, lead_codigo, fase, situacao, situacao_tipo, termometro,
                                      corretor_codigo, incluido_em, alterado_em, lido_em,
                                      %s, detalhes)
    VALUES (:tid, :codigo, :finalidade, :lead_codigo, :fase, :situacao, :situacao_tipo, :termometro,
            :corretor_codigo, :incluido_em, :alterado_em, NOW(),
            %s, CAST(:detalhes AS jsonb))
    ON CONFLICT (tenant_id, codigo) DO UPDATE SET
        finalidade = EXCLUDED.finalidade, lead_codigo = EXCLUDED.lead_codigo, fase = EXCLUDED.fase, situacao = EXCLUDED.situacao,
        situacao_tipo = EXCLUDED.situacao_tipo, termometro = EXCLUDED.termometro, corretor_codigo = EXCLUDED.corretor_codigo,
        incluido_em = EXCLUDED.incluido_em, alterado_em = EXCLUDED.alterado_em, lido_em = NOW(),
        %s, detalhes = EXCLUDED.detalhes
""" % (", ".join(_COLS_FLUXO), ", ".join(":" + c for c in _COLS_FLUXO), ", ".join(f"{c} = EXCLUDED.{c}" for c in _COLS_FLUXO)))


async def gravar_atendimentos(tenant_id: UUID, itens: List[Dict[str, Any]]) -> None:
    if not itens:
        return
    async with get_session(tenant_id) as s:
        await s.execute(_UPSERT, [{"tid": str(tenant_id), **i} for i in itens])


async def sincronizar(
    tenant_id: UUID, origem: str = "agendada", completo: bool = False, cliente: Optional[Any] = None, validar_dns: bool = True,
) -> Dict[str, Any]:
    redis = get_redis_pool()
    chave, token = CHAVE_LOCK.format(tenant_id), uuid4().hex
    if not await redis.set(chave, token, nx=True, ex=LOCK_TTL):
        return {"ignorado": True, "motivo": "já em andamento"}

    agora = lambda: datetime.now(timezone.utc)  # noqa: E731
    inicio_leitura = agora()
    conta = {"processados": 0}
    try:
        async with get_session(tenant_id) as s:
            ant = (await s.execute(text("SELECT checkpoint, leitura_desde, ultimo_sucesso_em FROM imoview_funil_sync WHERE tenant_id = :tid"), {"tid": str(tenant_id)})).first()
        primeira_vez = not (ant and ant.ultimo_sucesso_em and ant.leitura_desde)
        modo = "completo" if (completo or primeira_vez) else "incremental"
        retomar = ant.checkpoint if (ant and ant.checkpoint and modo == "completo") else None
        desde = None if modo == "completo" else (ant.leitura_desde - MARGEM_INCREMENTAL)
        await _gravar_status(tenant_id, estado="executando", origem=origem, modo=modo, etapa="conectando", iniciado_em=agora(),
                             concluido_em=None, erro=None, total_remoto=0, **conta)

        if cliente is None:
            creds = await carregar_credenciais(tenant_id)
            if not creds or not creds.get("chave"):
                raise SemCredenciais()
            base = await validar_base_url(creds["base_url"]) if validar_dns else creds["base_url"]
            cliente = ImoviewClient(base_url=base, chave=creds["chave"], codigo_acesso=creds.get("codigo_acesso"))

        # Total para a barra de progresso: primeira página de cada (finalidade, fase).
        total = 0
        primeiras: Dict[Tuple[str, int], Dict[str, Any]] = {}
        for fin, fase in combinacoes():
            primeiras[(fin, fase)] = await _ler_pagina(cliente, fin, fase, 1, desde)
            total += inteiro(primeiras[(fin, fase)].get("quantidade")) or 0
        await _gravar_status(tenant_id, total_remoto=total)

        for fin, fase in combinacoes(retomar):
            primeira = primeiras[(fin, fase)]
            quantidade = inteiro(primeira.get("quantidade")) or 0
            ultima = max(1, -(-quantidade // POR_PAGINA))
            pagina = retomar["pagina"] if (retomar and (retomar.get("fin"), retomar.get("fase")) == (fin, fase)) else 1
            retomar = None
            rotulo = f"{'venda' if fin == '2' else 'aluguel'} · fase {fase}"
            while quantidade and pagina <= ultima:
                lote = list(range(pagina, min(pagina + CONCORRENCIA, ultima + 1)))
                respostas = await asyncio.gather(*[
                    asyncio.sleep(0, result=primeira) if p == 1 else _ler_pagina(cliente, fin, fase, p, desde) for p in lote
                ])
                itens: Dict[int, Dict[str, Any]] = {}
                for resposta in respostas:
                    for bruto in (resposta.get("lista") or []) if isinstance(resposta, dict) else []:
                        n = normalizar_atendimento(bruto, int(fin), fase)
                        if n:
                            itens[n["codigo"]] = n
                await gravar_atendimentos(tenant_id, list(itens.values()))
                conta["processados"] += len(itens)
                pagina = lote[-1] + 1
                await _gravar_status(tenant_id, etapa=f"lendo {rotulo} (página {min(pagina, ultima)}/{ultima})",
                                     checkpoint={"fin": fin, "fase": fase, "pagina": pagina} if modo == "completo" else None, **conta)

        await _gravar_status(tenant_id, etapa="atualizando negociações")
        r = await aplicar(tenant_id, forcar=False)
        await _gravar_status(tenant_id, estado="ok", etapa=None, concluido_em=agora(), ultimo_sucesso_em=agora(),
                             leitura_desde=inicio_leitura, checkpoint=None, erro=None, negocios_ligados=r["ligados"],
                             negocios_movidos=r["movidos"], **conta)
        log.info("funil_imoview_sincronizado", tenant_id=str(tenant_id)[:8], modo=modo, **conta, **r)
        return {"modo": modo, "total_remoto": total, **conta, **r}
    except Exception as e:  # noqa: BLE001 - o motivo vai para o portal; o checkpoint fica para retomar
        log.warning("funil_imoview_falhou", tenant_id=str(tenant_id)[:8], error=str(e)[:200])
        await _gravar_status(tenant_id, estado="erro", etapa=None, concluido_em=agora(), erro=mensagem_de_erro(e))
        return {"erro": mensagem_de_erro(e)}
    finally:
        await redis.eval(_SCRIPT_LIBERAR, 1, chave, token)


# --- Pedidos manuais e jobs ----------------------------------------------------------------

async def solicitar(tenant_id: UUID, completo: bool) -> str:
    redis = get_redis_pool()
    if await redis.exists(CHAVE_LOCK.format(tenant_id)):
        return "executando"
    await redis.sadd(CHAVE_PEDIDOS, f"{tenant_id}:{'completo' if completo else 'incremental'}")
    return "na_fila"


_tarefas: set = set()


async def _rodar_pedido(tenant_id: UUID, completo: bool) -> None:
    try:
        await sincronizar(tenant_id, origem="manual", completo=completo)
    except Exception as e:  # noqa: BLE001
        log.error("funil_pedido_falhou", tenant_id=str(tenant_id)[:8], error=str(e)[:200])


async def processar_pedidos() -> int:
    pedidos = await get_redis_pool().spop(CHAVE_PEDIDOS, 20) or []
    for pedido in pedidos:
        tenant, _, modo = str(pedido).partition(":")
        tarefa = asyncio.create_task(_rodar_pedido(UUID(tenant), modo == "completo"))
        _tarefas.add(tarefa)
        tarefa.add_done_callback(_tarefas.discard)
    return len(pedidos)


async def _tenants_com_carga_inicial() -> List[UUID]:
    """Só quem já fez a primeira leitura (manual, depois de configurar o mapa) entra no ciclo automático."""
    async with get_admin_session() as s:
        linhas = (await s.execute(text("""
            SELECT t.id, t.dados FROM tenants t JOIN imoview_funil_sync f ON f.tenant_id = t.id
            WHERE t.status = 'active' AND t.imoview_creds IS NOT NULL AND f.ultimo_sucesso_em IS NOT NULL
        """))).fetchall()
    return [l.id for l in linhas if ler_config(l.dados)["auto"]]


async def job_sync_funil() -> None:
    """A cada 15 min: lê só os atendimentos alterados desde a última leitura."""
    for tid in await _tenants_com_carga_inicial():
        await sincronizar(tid, origem="agendada", completo=False)


async def job_sync_funil_completo() -> None:
    """Uma vez por semana: relê tudo (pega o que escapou da leitura incremental)."""
    for tid in await _tenants_com_carga_inicial():
        await sincronizar(tid, origem="agendada", completo=True)
