"""
Importação dos leads do Imoview para a carteira de clientes do portal.

- Só leads (relacionamento "lead"); CPF/CNPJ e demais dados cadastrais não são importados.
- O Imoview não informa o corretor: o lead entra SEM responsável e o gestor atribui (ou a
  roleta distribui). A carteira de cada corretor no WhatsApp continua só com os dele.
- Quem já existe pelo telefone (anotado antes por um corretor) é vinculado, não duplicado.
- A API lista do mais antigo para o mais novo, então depois da primeira importação completa
  só o fim da lista é lido. Importação completa tem checkpoint e retoma de onde parou.
"""
import asyncio
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy import text

from app.domain.imovel.sync import SemCredenciais, carregar_credenciais, inteiro, mensagem_de_erro
from app.integration.imoview.client import ImoviewClient, ImoviewRateLimitError, ImoviewUnavailableError
from app.integration.imoview.seguranca import validar_base_url
from app.shared.database import get_admin_session, get_session
from app.shared.phone import normalize_phone
from app.shared.redis import get_redis_pool

log = structlog.get_logger()

TIPO_RELACIONAMENTO_LEAD = "1"  # no Imoview: 1 = lead, 2 = locador, 3 = locatário, 6 = proprietário, 7 = comprador
POR_PAGINA = 20  # a API recusa mais que 20 por página
CONCORRENCIA = 3
CHAVE_PEDIDOS = "imoview:leads:pedidos"
CHAVE_LOCK = "imoview:leads:lock:{}"
LOCK_TTL = 6 * 3600
PARADA_APOS = timedelta(minutes=10)
FRIO_APOS = timedelta(days=365)
_TZ = ZoneInfo("America/Sao_Paulo")
_SCRIPT_LIBERAR = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0"


# --- Normalização (funções puras) -----------------------------------------------

def _data(bruto: Any) -> Optional[datetime]:
    """'21/06/2018 14:40' (horário de Brasília) -> datetime com fuso."""
    if not bruto:
        return None
    for formato in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y"):
        try:
            return datetime.strptime(str(bruto).strip(), formato).replace(tzinfo=_TZ)
        except ValueError:
            continue
    return None


def telefone_busca(texto: Optional[str]) -> Optional[str]:
    """Últimos 11 dígitos: casa '(63) 99999-0000', '+55 63 99999-0000' e '63999990000'."""
    digitos = re.sub(r"\D", "", texto or "")
    return digitos[-11:] if len(digitos) >= 8 else None


def _escolher_telefone(telefones: Any) -> Optional[str]:
    lista = [t for t in (telefones or []) if isinstance(t, dict) and t.get("numero")]
    if not lista:
        return None
    lista.sort(key=lambda t: 0 if str(t.get("tipo", "")).lower().startswith("celular") else 1)
    bruto = str(lista[0]["numero"])
    try:
        return normalize_phone(bruto)
    except ValueError:
        digitos = re.sub(r"\D", "", bruto)
        return digitos[:20] if 8 <= len(digitos) <= 15 else None


def _escolher_email(emails: Any) -> Optional[str]:
    for e in emails or []:
        valor = (e.get("email") if isinstance(e, dict) else e) or ""
        valor = str(valor).strip().lower()
        if "@" in valor and 3 <= len(valor) <= 255:
            return valor
    return None


def normalizar_lead(bruto: Dict[str, Any], agora: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    """Registro do Imoview -> linha de crm_leads. None se não houver código ou nome."""
    codigo = inteiro(bruto.get("codigo"))
    nome = " ".join(str(bruto.get("nome") or "").split())[:255]
    if not codigo or not nome:
        return None
    agora = agora or datetime.now(timezone.utc)
    telefone = _escolher_telefone(bruto.get("telefones"))
    incluido = _data(bruto.get("datainclusao"))
    alterado = _data(bruto.get("dataultimaalteracao")) or incluido
    # Lead sem nenhuma movimentação há mais de um ano é tratado como frio; o resto, morno.
    frio = bool(alterado and agora - alterado > FRIO_APOS)
    return {
        "codigo": codigo, "nome": nome, "telefone": telefone, "busca": telefone_busca(telefone),
        "email": _escolher_email(bruto.get("emails")), "incluido": incluido, "alterado": alterado,
        "temperatura": "frio" if frio else "morno",
    }


def paginas_a_ler(total: int, ultimo_total: int, completo: bool, checkpoint: Optional[int] = None) -> Tuple[int, int]:
    """Faixa de páginas (início, fim) a ler. Leads novos ficam no fim da lista."""
    ultima = max(1, -(-total // POR_PAGINA))
    if completo or ultimo_total <= 0:
        return max(1, min(checkpoint or 1, ultima)), ultima
    if total > ultimo_total:
        pagina_do_ultimo = (ultimo_total - 1) // POR_PAGINA + 1
        return max(1, pagina_do_ultimo - 1), ultima
    return max(1, ultima - 1), ultima  # nada novo: relê só o fim (alterações recentes)


# --- Status -----------------------------------------------------------------------

_COLUNAS = {
    "estado", "origem", "modo", "etapa", "iniciado_em", "concluido_em", "ultimo_sucesso_em", "total_remoto",
    "ultimo_total", "processados", "novos", "atualizados", "vinculados", "checkpoint", "erro",
}


async def _gravar_status(tenant_id: UUID, **campos: Any) -> None:
    assert set(campos) <= _COLUNAS
    nomes = list(campos)
    async with get_session(tenant_id) as s:
        await s.execute(
            text(f"""
                INSERT INTO imoview_leads_sync (tenant_id, {', '.join(nomes)}, atualizado_em)
                VALUES (:tid, {', '.join(':' + n for n in nomes)}, NOW())
                ON CONFLICT (tenant_id) DO UPDATE SET {', '.join(f'{n} = EXCLUDED.{n}' for n in nomes)}, atualizado_em = NOW()
            """),
            {"tid": str(tenant_id), **campos},
        )


async def obter_status(session, tenant_id: UUID) -> Dict[str, Any]:
    linha = (await session.execute(text("SELECT * FROM imoview_leads_sync WHERE tenant_id = :tid"), {"tid": str(tenant_id)})).first()
    totais = (await session.execute(
        text("""SELECT COUNT(*) FILTER (WHERE origem = 'imoview') AS importados,
                       COUNT(*) FILTER (WHERE corretor_id IS NULL) AS sem_responsavel,
                       COUNT(*) AS total
                FROM crm_leads WHERE tenant_id = :tid AND status <> 'arquivado'"""),
        {"tid": str(tenant_id)},
    )).first()
    dados = (await session.execute(text("SELECT dados FROM tenants WHERE id = :tid"), {"tid": str(tenant_id)})).scalar() or {}
    redis = get_redis_pool()
    na_fila = False
    for modo in ("completo", "incremental"):
        na_fila = na_fila or bool(await redis.sismember(CHAVE_PEDIDOS, f"{tenant_id}:{modo}"))
    estado = linha.estado if linha else "ocioso"
    if estado == "executando" and linha and datetime.now(timezone.utc) - linha.atualizado_em > PARADA_APOS:
        estado = "erro"  # o processo parou no meio; a próxima execução retoma do checkpoint

    iso = lambda v: v.isoformat() if v else None  # noqa: E731
    return {
        "estado": "na_fila" if na_fila and estado != "executando" else estado,
        "modo": linha.modo if linha else None,
        "etapa": linha.etapa if (linha and estado == "executando") else None,
        "iniciado_em": iso(linha.iniciado_em) if linha else None,
        "concluido_em": iso(linha.concluido_em) if linha else None,
        "ultimo_sucesso_em": iso(linha.ultimo_sucesso_em) if linha else None,
        "total_remoto": linha.total_remoto if linha else 0,
        "processados": linha.processados if linha else 0,
        "novos": linha.novos if linha else 0,
        "atualizados": linha.atualizados if linha else 0,
        "vinculados": linha.vinculados if linha else 0,
        "pode_retomar": bool(linha and linha.checkpoint and estado in ("erro", "executando")),
        "erro": (linha.erro if estado == "erro" else None) if linha else None,
        "automatica": bool((dados.get("imoview_leads") or {}).get("auto", True)),
        "leads_importados": totais.importados or 0,
        "leads_sem_responsavel": totais.sem_responsavel or 0,
        "leads_total": totais.total or 0,
    }


async def definir_automatica(session, tenant_id: UUID, ligada: bool) -> None:
    await session.execute(
        text("UPDATE tenants SET dados = jsonb_set(dados, '{imoview_leads}', CAST(:v AS jsonb), true) WHERE id = :tid"),
        {"tid": str(tenant_id), "v": json.dumps({"auto": ligada})},
    )


# --- Pedidos manuais ----------------------------------------------------------------

async def solicitar(tenant_id: UUID, completo: bool) -> str:
    """Pede uma importação; o agendador a atende em poucos segundos."""
    redis = get_redis_pool()
    if await redis.exists(CHAVE_LOCK.format(tenant_id)):
        return "executando"
    await redis.sadd(CHAVE_PEDIDOS, f"{tenant_id}:{'completo' if completo else 'incremental'}")
    return "na_fila"


_tarefas: set = set()  # mantém referência às importações em andamento (senão o GC pode descartá-las)


async def _rodar_pedido(tenant_id: UUID, completo: bool) -> None:
    try:
        await sincronizar_leads(tenant_id, origem="manual", completo=completo)
    except Exception as e:  # noqa: BLE001 - um tenant com problema não trava os outros
        log.error("leads_pedido_falhou", tenant_id=str(tenant_id)[:8], error=str(e)[:200])


async def processar_pedidos() -> int:
    """Dispara, em segundo plano, as importações pedidas pelo portal. Não espera terminar: a completa é longa."""
    pedidos = await get_redis_pool().spop(CHAVE_PEDIDOS, 20) or []
    for pedido in pedidos:
        tenant, _, modo = str(pedido).partition(":")
        tarefa = asyncio.create_task(_rodar_pedido(UUID(tenant), modo == "completo"))
        _tarefas.add(tarefa)
        tarefa.add_done_callback(_tarefas.discard)
    return len(pedidos)


# --- Gravação ------------------------------------------------------------------------

_UPSERT = text("""
    INSERT INTO crm_leads (
        tenant_id, corretor_id, nome, telefone, telefone_busca, email, origem, temperatura, status, perfil,
        codigo_imoview, imoview_incluido_em, importado_em, created_at, updated_at
    ) VALUES (
        :tid, NULL, :nome, :telefone, :busca, :email, 'imoview', :temperatura, 'lead', '{}',
        :codigo, :incluido, NOW(), COALESCE(:incluido, NOW()), COALESCE(:alterado, NOW())
    )
    ON CONFLICT (tenant_id, codigo_imoview) WHERE codigo_imoview IS NOT NULL DO UPDATE SET
        nome = EXCLUDED.nome, telefone = EXCLUDED.telefone, telefone_busca = EXCLUDED.telefone_busca,
        email = EXCLUDED.email, imoview_incluido_em = EXCLUDED.imoview_incluido_em, updated_at = EXCLUDED.updated_at
    WHERE crm_leads.origem = 'imoview'
      AND (crm_leads.nome, crm_leads.telefone, crm_leads.email) IS DISTINCT FROM (EXCLUDED.nome, EXCLUDED.telefone, EXCLUDED.email)
""")


async def gravar_pagina(tenant_id: UUID, leads: List[Dict[str, Any]]) -> Dict[str, int]:
    """Grava uma página: atualiza os já importados, vincula quem o corretor já anotou e insere o resto."""
    if not leads:
        return {"novos": 0, "atualizados": 0, "vinculados": 0}
    tid = str(tenant_id)
    async with get_session(tenant_id) as s:
        ja = {r[0] for r in (await s.execute(
            text("SELECT codigo_imoview FROM crm_leads WHERE tenant_id = :tid AND codigo_imoview = ANY(:c)"),
            {"tid": tid, "c": [l["codigo"] for l in leads]},
        )).fetchall()}
        novas = [l for l in leads if l["codigo"] not in ja]

        livres: Dict[str, str] = {}
        fones = sorted({l["busca"] for l in novas if l["busca"]})
        if fones:
            livres = {r.telefone_busca: str(r.id) for r in (await s.execute(
                text("""SELECT DISTINCT ON (telefone_busca) id, telefone_busca FROM crm_leads
                        WHERE tenant_id = :tid AND codigo_imoview IS NULL AND origem <> 'imoview'
                          AND telefone_busca = ANY(:fones) ORDER BY telefone_busca, created_at"""),
                {"tid": tid, "fones": fones},
            )).fetchall()}

        vinculados, gravar = 0, [l for l in leads if l["codigo"] in ja]
        usados: set = set()
        for l in novas:
            alvo = livres.get(l["busca"]) if l["busca"] and l["busca"] not in usados else None
            if alvo:
                await s.execute(
                    text("""UPDATE crm_leads SET codigo_imoview = :cod, imoview_incluido_em = :inc,
                                   email = COALESCE(email, :email), updated_at = NOW() WHERE id = :id"""),
                    {"cod": l["codigo"], "inc": l["incluido"], "email": l["email"], "id": alvo},
                )
                usados.add(l["busca"])
                vinculados += 1
            else:
                gravar.append(l)
        if gravar:
            await s.execute(_UPSERT, [
                {"tid": tid, "nome": l["nome"], "telefone": l["telefone"], "busca": l["busca"], "email": l["email"],
                 "temperatura": l["temperatura"], "codigo": l["codigo"], "incluido": l["incluido"], "alterado": l["alterado"]}
                for l in gravar
            ])
    return {"novos": len(gravar) - len(ja), "atualizados": len(ja), "vinculados": vinculados}


# --- Sincronização --------------------------------------------------------------------

async def _ler_pagina(cliente: Any, pagina: int) -> Dict[str, Any]:
    for tentativa in range(4):
        try:
            return await cliente.retornar_clientes(pagina=pagina, registros=POR_PAGINA, tipo_relacionamento=TIPO_RELACIONAMENTO_LEAD)
        except (ImoviewRateLimitError, ImoviewUnavailableError):
            if tentativa == 3:
                raise
            await asyncio.sleep(2 ** tentativa)
    raise RuntimeError("inalcançável")


async def sincronizar_leads(
    tenant_id: UUID, origem: str = "agendada", completo: bool = False, cliente: Optional[Any] = None, validar_dns: bool = True,
) -> Dict[str, Any]:
    redis = get_redis_pool()
    chave, token = CHAVE_LOCK.format(tenant_id), uuid4().hex
    if not await redis.set(chave, token, nx=True, ex=LOCK_TTL):
        return {"ignorado": True, "motivo": "já em andamento"}

    agora = lambda: datetime.now(timezone.utc)  # noqa: E731
    conta = {"processados": 0, "novos": 0, "atualizados": 0, "vinculados": 0}
    try:
        async with get_session(tenant_id) as s:
            ant = (await s.execute(text("SELECT ultimo_total, checkpoint, estado FROM imoview_leads_sync WHERE tenant_id = :tid"), {"tid": str(tenant_id)})).first()
        ultimo_total = ant.ultimo_total if ant else 0
        retomar = ant.checkpoint if (ant and ant.checkpoint and (completo or ultimo_total <= 0)) else None
        modo = "completo" if (completo or ultimo_total <= 0) else "incremental"
        await _gravar_status(tenant_id, estado="executando", origem=origem, modo=modo, etapa="conectando", iniciado_em=agora(),
                             concluido_em=None, erro=None, **conta)

        if cliente is None:
            creds = await carregar_credenciais(tenant_id)
            if not creds or not creds.get("chave"):
                raise SemCredenciais()
            base = await validar_base_url(creds["base_url"]) if validar_dns else creds["base_url"]
            cliente = ImoviewClient(base_url=base, chave=creds["chave"], codigo_acesso=creds.get("codigo_acesso"))

        primeira = await _ler_pagina(cliente, 1)
        total = inteiro(primeira.get("quantidade")) or 0
        inicio, fim = paginas_a_ler(total, ultimo_total, modo == "completo", retomar)
        await _gravar_status(tenant_id, total_remoto=total, etapa=f"lendo páginas {inicio}–{fim}")

        pagina = inicio
        while pagina <= fim:
            lote = list(range(pagina, min(pagina + CONCORRENCIA, fim + 1)))
            respostas = await asyncio.gather(*[
                asyncio.sleep(0, result=primeira) if p == 1 else _ler_pagina(cliente, p) for p in lote
            ])
            leads: Dict[int, Dict[str, Any]] = {}
            for resposta in respostas:
                for bruto in (resposta.get("lista") or []) if isinstance(resposta, dict) else []:
                    n = normalizar_lead(bruto)
                    if n:
                        leads[n["codigo"]] = n
            r = await gravar_pagina(tenant_id, list(leads.values()))
            conta["processados"] += len(leads)
            for k in ("novos", "atualizados", "vinculados"):
                conta[k] += r[k]
            pagina = lote[-1] + 1
            await _gravar_status(tenant_id, etapa=f"lendo páginas {inicio}–{fim}", checkpoint=pagina if modo == "completo" else None, **conta)

        await _gravar_status(tenant_id, estado="ok", etapa=None, concluido_em=agora(), ultimo_sucesso_em=agora(),
                             ultimo_total=total, checkpoint=None, erro=None, **conta)
        log.info("leads_imoview_sincronizados", tenant_id=str(tenant_id)[:8], modo=modo, **conta)
        return {"modo": modo, "total_remoto": total, **conta}
    except Exception as e:  # noqa: BLE001 - o motivo vai para o portal, o checkpoint fica para retomar
        log.warning("leads_imoview_falhou", tenant_id=str(tenant_id)[:8], error=str(e)[:200])
        await _gravar_status(tenant_id, estado="erro", etapa=None, concluido_em=agora(), erro=mensagem_de_erro(e))
        return {"erro": mensagem_de_erro(e)}
    finally:
        await redis.eval(_SCRIPT_LIBERAR, 1, chave, token)


# --- Jobs do agendador -------------------------------------------------------------------

async def _tenants_com_integracao(so_automaticos: bool = True) -> List[UUID]:
    async with get_admin_session() as s:
        linhas = (await s.execute(text("SELECT id, dados FROM tenants WHERE status = 'active' AND imoview_creds IS NOT NULL"))).fetchall()
    return [
        l.id for l in linhas
        if not so_automaticos or ((l.dados or {}).get("imoview_leads") or {}).get("auto", True)
    ]


async def job_sync_leads() -> None:
    """A cada 30 min: lê só o fim da lista (leads novos). Na primeira vez, importa tudo."""
    for tid in await _tenants_com_integracao():
        await sincronizar_leads(tid, origem="agendada", completo=False)


async def job_sync_leads_completo() -> None:
    """Uma vez por semana: relê tudo, para pegar alterações e leads que viraram lead depois."""
    for tid in await _tenants_com_integracao():
        await sincronizar_leads(tid, origem="agendada", completo=True)
