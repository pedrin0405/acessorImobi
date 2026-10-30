"""
Memória de longo prazo das conversas do agente (RAG).

A janela recente (últimas mensagens) continua indo inteira ao modelo. O que ficou
fora dela vem de duas fontes, ambas montadas aqui:

- **resumo incremental** do que já saiu da janela (preferências, clientes citados,
  pendências), atualizado a cada N mensagens;
- **trechos recuperados por similaridade** (embedding Gemini + pgvector): quando o
  corretor muda de assunto e depois volta, a conversa antiga volta junto.

Tudo é tolerante a falha: sem Gemini, sem embeddings ou com timeout, o agente segue
só com a janela recente. A indexação e o resumo rodam em segundo plano, depois da
resposta, sem segurar o lock da conversa.
"""
import asyncio
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union
from uuid import UUID
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy import text

from app.integration.llm.gemini import GeminiClient, GeminiError
from app.shared.config import get_settings
from app.shared.database import get_admin_session, get_session
from app.shared.redis import get_redis_pool

log = structlog.get_logger()
settings = get_settings()

_LOTE_EMBEDDING = 64
_MAX_CONTEUDO = 600
_MAX_MSGS_RESUMO = 60
_TRIVIAL_CURTA = 25  # abaixo disso a consulta ganha a mensagem anterior do corretor
_tarefas: set = set()  # referências fortes: tarefa em segundo plano não pode ser coletada


# --- Filtro de ruído e texto indexável --------------------------------------------

_RUIDO = re.compile(
    r"(oi+|ola+|opa|eai|e ai|bom dia|boa tarde|boa noite|tudo bem|tudo bom|teste|testando|ok|okay|"
    r"sim|nao|isso|pode|blz|beleza|show|valeu|obrigad[oa]|obg|vlw|certo|entendi|combinado|fechado|"
    r"ate mais|tchau|de nada|por nada|perfeito|otimo|claro|ta bom)[\s!.?,]*"
)


def _normalizar(texto: str) -> str:
    sem_acento = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode()
    return sem_acento.lower().strip()


def eh_ruido(texto: str) -> bool:
    """Saudação, 'ok', 'sim' e afins: não valem uma entrada na memória."""
    norm = _normalizar(texto)
    if len(norm) < 3:
        return True
    if _RUIDO.fullmatch(norm):
        return True
    # Uma palavra solta sem número não carrega assunto; duas ou mais (ex.: um nome) carregam.
    return len(norm.split()) <= 1 and not any(c.isdigit() for c in norm)


def _linha_imovel(legenda: str) -> str:
    """Legenda longa da foto de um imóvel vira uma linha: tipo, bairro, valor, código."""
    limpo = (legenda or "").replace("*", "")
    linhas = [l.strip() for l in limpo.split("\n") if l.strip()]
    primeira = re.sub(r"^[^A-Za-z0-9À-ÿ]+", "", linhas[0]) if linhas else "Imóvel"
    partes = [primeira]
    quartos = re.search(r"(\d+)\s*quarto", limpo, re.I)
    if quartos:
        partes.append(f"{quartos.group(1)} quartos")
    valor = re.search(r"R\$\s?[\d.]+(?:,\d{2})?(?:/m[êe]s)?", limpo)
    if valor:
        partes.append(valor.group(0))
    codigo = re.search(r"C[óo]digo:\s*(\d+)", limpo, re.I)
    if codigo:
        partes.append(f"cód. {codigo.group(1)}")
    return "Enviou um imóvel: " + " · ".join(partes)


def texto_indexavel(msg: Dict[str, Any]) -> Optional[str]:
    """Texto que entra na memória para a mensagem, ou None se for ruído/vazia."""
    tipo = msg.get("tipo")
    conteudo = (msg.get("transcricao") or msg.get("conteudo") or "").strip()
    if not conteudo:
        return None
    if tipo == "image":
        return _linha_imovel(conteudo)
    if eh_ruido(conteudo):
        return None
    return conteudo[:_MAX_CONTEUDO]


def _rotulo(direcao: str) -> str:
    return "Corretor" if direcao == "inbound" else "Acessor"


def _vetor(v: Sequence[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in v) + "]"


def disponivel() -> bool:
    return bool(settings.memoria_ativa and settings.gemini_api_key)


async def _embed(textos: List[str], tarefa: str) -> List[List[float]]:
    """Ponto único de chamada ao modelo de embedding (os testes trocam esta função)."""
    return await GeminiClient().embed(textos, tarefa=tarefa)


# --- Indexação ---------------------------------------------------------------------

async def indexar_pendentes(
    session, tenant_id: UUID, corretor_id: Optional[UUID] = None, limite: int = 200
) -> int:
    """
    Indexa mensagens ainda sem registro em conversa_memoria (mais antigas primeiro).
    Ruído entra com embedding NULL, só para não ser reprocessado. Falha de embedding
    não grava nada: a próxima execução tenta de novo.
    """
    filtro = "AND m.corretor_id = :cid" if corretor_id else ""
    params: Dict[str, Any] = {"tid": str(tenant_id), "limite": limite}
    if corretor_id:
        params["cid"] = str(corretor_id)
    rows = await session.execute(
        text(f"""
            SELECT m.id, m.corretor_id, m.direcao, m.tipo, m.conteudo, m.transcricao, m.created_at
            FROM mensagens m
            LEFT JOIN conversa_memoria cm ON cm.mensagem_id = m.id
            WHERE m.tenant_id = :tid {filtro} AND cm.id IS NULL
            ORDER BY m.created_at
            LIMIT :limite
        """),
        params,
    )
    pendentes = rows.fetchall()
    if not pendentes:
        return 0

    uteis: List[Tuple[Any, str]] = []
    ignoradas: List[Any] = []
    for r in pendentes:
        alvo = texto_indexavel({"tipo": r.tipo, "conteudo": r.conteudo, "transcricao": r.transcricao})
        (uteis if alvo else ignoradas).append((r, alvo) if alvo else r)

    inseridas = 0
    for r in ignoradas:
        await _inserir(session, tenant_id, r, r.conteudo or "", None)
        inseridas += 1

    for i in range(0, len(uteis), _LOTE_EMBEDDING):
        lote = uteis[i:i + _LOTE_EMBEDDING]
        try:
            vetores = await _embed([t for _, t in lote], "RETRIEVAL_DOCUMENT")
        except GeminiError as e:
            log.warning("memoria_embedding_falhou", error=str(e)[:160])
            break
        for (r, alvo), vetor in zip(lote, vetores):
            await _inserir(session, tenant_id, r, alvo, vetor)
            inseridas += 1
    return inseridas


async def _inserir(session, tenant_id: UUID, r, conteudo: str, vetor: Optional[Sequence[float]]) -> None:
    await session.execute(
        text("""
            INSERT INTO conversa_memoria (tenant_id, corretor_id, mensagem_id, papel, conteudo, embedding, criada_em)
            VALUES (:tid, :cid, :mid, :papel, :conteudo, CAST(:vec AS vector), :criada)
            ON CONFLICT (mensagem_id) DO NOTHING
        """),
        {
            "tid": str(tenant_id), "cid": str(r.corretor_id), "mid": str(r.id), "papel": r.direcao,
            "conteudo": conteudo[:_MAX_CONTEUDO], "vec": _vetor(vetor) if vetor is not None else None,
            "criada": r.created_at,
        },
    )


# --- Recuperação -------------------------------------------------------------------

def _anaforica(mensagem: str) -> bool:
    """'e o outro?', 'quanto custa?': curta e sem nome próprio nem número, só faz sentido com o assunto anterior."""
    palavras = re.findall(r"[\wÀ-ÿ$]+", mensagem)
    if len(mensagem) >= _TRIVIAL_CURTA and len(palavras) > 4:
        return False
    if any(any(c.isdigit() for c in p) for p in palavras):
        return False
    return not any(p[:1].isupper() for p in palavras[1:])


def consulta_de_busca(mensagem: str, historico: List[Dict[str, Any]]) -> List[str]:
    """
    Textos a embutir para a busca. Mensagem com assunto próprio vai sozinha. Anafórica ("e o
    cachorro dela?") vai de duas formas: sozinha e com a pergunta anterior, porque o "dela"
    pode ser do assunto de agora ou de um assunto antigo; os resultados são intercalados.
    """
    mensagem = (mensagem or "").strip()
    if not _anaforica(mensagem):
        return [mensagem]
    for h in reversed(historico or []):
        if h.get("direcao") == "inbound" and (h.get("conteudo") or "").strip():
            return [mensagem, f"{(h['conteudo'] or '').strip()[:300]} {mensagem}".strip()]
    return [mensagem]


async def recuperar_com_sessao(
    session,
    tenant_id: UUID,
    corretor_id: UUID,
    corte: Optional[str],
    consulta: Union[str, List[str]],
    pular_busca: bool = False,
) -> Dict[str, Any]:
    """
    Resumo + trechos relevantes anteriores a `corte` (início da janela recente).
    Só gasta o embedding se existir memória antiga para consultar.
    """
    resultado: Dict[str, Any] = {"resumo": None, "trechos": [], "ms": 0, "pulou": None}
    inicio = asyncio.get_event_loop().time()
    if isinstance(corte, str):
        corte = datetime.fromisoformat(corte)

    resumo = (await session.execute(
        text("SELECT resumo FROM conversa_resumos WHERE tenant_id = :tid AND corretor_id = :cid"),
        {"tid": str(tenant_id), "cid": str(corretor_id)},
    )).first()
    if resumo:
        resultado["resumo"] = resumo.resumo

    if pular_busca or not corte:
        resultado["pulou"] = "mensagem trivial" if pular_busca else None
        return resultado

    ha_antigas = (await session.execute(
        text("""
            SELECT 1 FROM conversa_memoria
            WHERE tenant_id = :tid AND corretor_id = :cid AND embedding IS NOT NULL AND criada_em < :corte
            LIMIT 1
        """),
        {"tid": str(tenant_id), "cid": str(corretor_id), "corte": corte},
    )).first()
    if not ha_antigas:
        resultado["pulou"] = "sem memória anterior à janela"
        return resultado

    consultas = [consulta] if isinstance(consulta, str) else list(consulta)
    vetores = await _embed(consultas, "RETRIEVAL_QUERY")  # um lote só, qualquer que seja o número de consultas
    k = max(1, settings.memoria_k)
    listas = [
        _escolher(await _buscar(session, tenant_id, corretor_id, corte, v, k * 3), k, settings.memoria_limiar)
        for v in vetores
    ]
    resultado["trechos"] = _intercalar(listas, k)
    resultado["ms"] = round((asyncio.get_event_loop().time() - inicio) * 1000)
    return resultado


async def _buscar(session, tenant_id: UUID, corretor_id: UUID, corte: datetime, vetor: Sequence[float], n: int):
    rows = await session.execute(
        text("""
            SELECT m.id, m.papel, m.conteudo, m.criada_em,
                   1 - (m.embedding <=> CAST(:q AS vector)) AS similaridade,
                   (SELECT n.papel FROM conversa_memoria n
                     WHERE n.tenant_id = m.tenant_id AND n.corretor_id = m.corretor_id
                       AND n.criada_em > m.criada_em AND n.criada_em < m.criada_em + INTERVAL '30 minutes'
                     ORDER BY n.criada_em LIMIT 1) AS seguinte_papel,
                   (SELECT n.conteudo FROM conversa_memoria n
                     WHERE n.tenant_id = m.tenant_id AND n.corretor_id = m.corretor_id
                       AND n.criada_em > m.criada_em AND n.criada_em < m.criada_em + INTERVAL '30 minutes'
                     ORDER BY n.criada_em LIMIT 1) AS seguinte
            FROM conversa_memoria m
            WHERE m.tenant_id = :tid AND m.corretor_id = :cid
              AND m.embedding IS NOT NULL AND m.criada_em < :corte
            ORDER BY m.embedding <=> CAST(:q AS vector)
            LIMIT :n
        """),
        {"tid": str(tenant_id), "cid": str(corretor_id), "corte": corte, "q": _vetor(vetor), "n": n},
    )
    return rows.fetchall()


def _intercalar(listas: List[List[Dict[str, Any]]], k: int) -> List[Dict[str, Any]]:
    """Alterna entre as listas (uma por consulta), sem repetir trecho, até k."""
    saida: List[Dict[str, Any]] = []
    vistos = set()
    for rodada in range(max((len(l) for l in listas), default=0)):
        for lista in listas:
            if rodada < len(lista):
                chave = (lista[rodada]["conteudo"] or "")[:80]
                if chave not in vistos:
                    vistos.add(chave)
                    saida.append(lista[rodada])
        if len(saida) >= k:
            break
    return saida[:k]


def _escolher(candidatos: Sequence[Any], k: int, limiar: float) -> List[Dict[str, Any]]:
    """Mantém os que passam do limiar (já em ordem de similaridade), sem repetir vizinhos, até k."""
    escolhidos: List[Dict[str, Any]] = []
    vistos = set()
    for c in candidatos:
        if float(c.similaridade) < limiar:
            continue
        chave = (c.conteudo or "")[:80]
        if chave in vistos:
            continue
        vistos.add(chave)
        escolhidos.append({
            "papel": c.papel, "conteudo": c.conteudo, "quando": c.criada_em,
            "similaridade": round(float(c.similaridade), 3),
            "seguinte_papel": c.seguinte_papel, "seguinte": c.seguinte,
        })
        if len(escolhidos) >= k:
            break
    return escolhidos


async def recuperar(
    tenant_id: UUID, corretor_id: UUID, corte: Optional[str], consulta: Union[str, List[str]], pular_busca: bool = False
) -> Optional[Dict[str, Any]]:
    """
    Versão do agente: sessão própria (roda em paralelo ao resto da preparação, que usa a
    sessão da conversa), tempo limite curto e nenhuma exceção sobe. None = sem memória.
    """
    if not disponivel():
        return None

    async def _executar() -> Dict[str, Any]:
        async with get_session(tenant_id) as session:
            return await recuperar_com_sessao(session, tenant_id, corretor_id, corte, consulta, pular_busca)

    try:
        return await asyncio.wait_for(_executar(), timeout=settings.memoria_timeout_s)
    except asyncio.TimeoutError:
        log.warning("memoria_timeout", corretor_id=str(corretor_id)[:8])
    except Exception as e:  # noqa: BLE001 - memória nunca derruba a resposta
        log.warning("memoria_recuperacao_falhou", error=str(e)[:200])
    return None


def _quando(dt: Any, fuso: ZoneInfo) -> str:
    if isinstance(dt, str):
        dt = datetime.fromisoformat(dt)
    return dt.astimezone(fuso).strftime("%d/%m %H:%M")


def bloco_prompt(memoria: Optional[Dict[str, Any]], fuso: ZoneInfo) -> str:
    """Seções do system prompt com o resumo e os trechos antigos (vazio se não há o que dizer)."""
    if not memoria:
        return ""
    partes: List[str] = []
    if memoria.get("resumo"):
        partes.append(
            "### Resumo da conversa até aqui\n"
            "O que já foi tratado com este corretor antes da janela recente de mensagens:\n"
            f"{memoria['resumo'].strip()}"
        )
    trechos = memoria.get("trechos") or []
    if trechos:
        linhas = []
        for t in trechos:
            linha = f"- ({_quando(t['quando'], fuso)}) {_rotulo(t['papel'])}: {t['conteudo']}"
            if t.get("seguinte"):
                linha += f"\n  ↳ {_rotulo(t['seguinte_papel'] or 'outbound')}: {t['seguinte']}"
            linhas.append(linha)
        partes.append(
            "### Trechos anteriores que podem ser relevantes\n"
            "Recuperados por semelhança com o que o corretor disse agora. Use só se ajudarem; se "
            "não tiverem a ver, ignore.\n" + "\n".join(linhas)
        )
    if not partes:
        return ""
    return (
        "## Memória desta conversa (passado)\n"
        "Isto é histórico antigo, não são mensagens atuais: não responda a elas nem as cite como se "
        "tivessem acabado de acontecer. Se o corretor retomar um assunto de antes, use estes dados "
        "para continuar de onde pararam (ex.: 'como você tinha comentado').\n\n"
        + "\n\n".join(partes) + "\n\n"
    )


def detalhe_passo(memoria: Optional[Dict[str, Any]]) -> Tuple[str, Dict[str, Any]]:
    """Texto e metadados da etapa 'Memória' para o processo da IA no portal."""
    if not memoria:
        return "Sem memória adicional (janela recente bastou)", {}
    trechos = memoria.get("trechos") or []
    partes = []
    if memoria.get("resumo"):
        partes.append("usou o resumo da conversa")
    if trechos:
        partes.append(f"recuperou {len(trechos)} trecho(s) antigo(s) por semelhança")
    if not partes:
        partes.append("nada anterior era relevante" if not memoria.get("pulou") else f"busca pulada ({memoria['pulou']})")
    meta: Dict[str, Any] = {}
    if trechos:
        meta["trechos"] = [f"{t['conteudo'][:70]} ({t['similaridade']})" for t in trechos]
    return ", ".join(partes).capitalize(), meta


# --- Resumo incremental --------------------------------------------------------------

_PROMPT_RESUMO = (
    "Você mantém a memória de longo prazo de uma conversa de WhatsApp entre um corretor de imóveis e o "
    "assistente Acessor. Atualize o resumo existente incorporando as mensagens novas. Escreva em português, "
    "em até 12 linhas curtas com '-', cobrindo: preferências e regras do corretor, clientes citados (nome, o "
    "que procuram, orçamento, bairro), imóveis e códigos discutidos, visitas/tarefas combinadas e pendências "
    "ou assuntos ainda em aberto. Mantenha fatos já registrados que continuam valendo, remova o que foi "
    "resolvido ou superado. Não invente nada. Responda só com o resumo."
)


def deve_resumir(novas_fora_da_janela: int) -> bool:
    return novas_fora_da_janela >= max(1, settings.memoria_resumo_a_cada)


async def atualizar_resumo(session, tenant_id: UUID, corretor_id: UUID, fuso: ZoneInfo) -> bool:
    """Resume o que saiu da janela recente desde a última vez; True se atualizou."""
    janela = max(1, settings.context_window_messages)
    corte = (await session.execute(
        text("""
            SELECT created_at FROM mensagens
            WHERE tenant_id = :tid AND corretor_id = :cid
            ORDER BY created_at DESC OFFSET :off LIMIT 1
        """),
        {"tid": str(tenant_id), "cid": str(corretor_id), "off": janela - 1},
    )).first()
    if not corte:
        return False

    atual = (await session.execute(
        text("SELECT resumo, ate_em, mensagens_resumidas FROM conversa_resumos WHERE tenant_id = :tid AND corretor_id = :cid"),
        {"tid": str(tenant_id), "cid": str(corretor_id)},
    )).first()
    desde = atual.ate_em if atual else datetime(1970, 1, 1, tzinfo=timezone.utc)

    rows = await session.execute(
        text("""
            SELECT direcao, tipo, conteudo, transcricao, created_at FROM mensagens
            WHERE tenant_id = :tid AND corretor_id = :cid AND created_at > :desde AND created_at < :corte
            ORDER BY created_at LIMIT :lim
        """),
        {"tid": str(tenant_id), "cid": str(corretor_id), "desde": desde, "corte": corte.created_at, "lim": _MAX_MSGS_RESUMO + 40},
    )
    novas = []
    for r in rows.fetchall():
        alvo = texto_indexavel({"tipo": r.tipo, "conteudo": r.conteudo, "transcricao": r.transcricao})
        if alvo:
            novas.append((r.created_at, r.direcao, alvo))
    if not deve_resumir(len(novas)):
        return False
    novas = novas[:_MAX_MSGS_RESUMO]

    entrada = (
        f"RESUMO ATUAL:\n{atual.resumo if atual else '(ainda não há)'}\n\nMENSAGENS NOVAS:\n"
        + "\n".join(f"({_quando(q, fuso)}) {_rotulo(d)}: {t}" for q, d, t in novas)
    )
    try:
        resposta = await GeminiClient().gerar(_PROMPT_RESUMO, [{"role": "user", "content": entrada}], temperature=0.3, max_tokens=900)
    except GeminiError as e:
        log.warning("memoria_resumo_falhou", error=str(e)[:160])
        return False
    novo = (resposta.get("text") or "").strip()
    if not novo:
        return False

    await session.execute(
        text("""
            INSERT INTO conversa_resumos (tenant_id, corretor_id, resumo, ate_em, mensagens_resumidas, atualizado_em)
            VALUES (:tid, :cid, :resumo, :ate, :n, NOW())
            ON CONFLICT (tenant_id, corretor_id) DO UPDATE SET
                resumo = EXCLUDED.resumo, ate_em = EXCLUDED.ate_em,
                mensagens_resumidas = conversa_resumos.mensagens_resumidas + EXCLUDED.mensagens_resumidas,
                atualizado_em = NOW()
        """),
        {"tid": str(tenant_id), "cid": str(corretor_id), "resumo": novo[:3000], "ate": novas[-1][0], "n": len(novas)},
    )
    return True


# --- Manutenção em segundo plano e backfill ------------------------------------------

async def _fuso_do_tenant(session, tenant_id: UUID) -> ZoneInfo:
    row = (await session.execute(
        text("SELECT fuso FROM tenants WHERE id = :tid"), {"tid": str(tenant_id)}
    )).first()
    try:
        return ZoneInfo((row.fuso if row else None) or settings.usage_timezone)
    except Exception:  # noqa: BLE001
        return ZoneInfo("America/Sao_Paulo")


async def manter_corretor(tenant_id: UUID, corretor_id: UUID) -> Dict[str, Any]:
    """Indexa as mensagens novas e atualiza o resumo se for a hora. Nunca levanta exceção."""
    resultado = {"indexadas": 0, "resumo": False}
    if not disponivel():
        return resultado
    redis = get_redis_pool()
    chave = f"memoria:lock:{tenant_id}:{corretor_id}"
    try:
        if not await redis.set(chave, "1", nx=True, ex=180):
            return resultado  # outra manutenção deste corretor já está rodando; a próxima pega o resto
        try:
            async with get_session(tenant_id) as session:
                resultado["indexadas"] = await indexar_pendentes(session, tenant_id, corretor_id, limite=120)
                fuso = await _fuso_do_tenant(session, tenant_id)
                resultado["resumo"] = await atualizar_resumo(session, tenant_id, corretor_id, fuso)
        finally:
            await redis.delete(chave)
    except Exception as e:  # noqa: BLE001
        log.warning("memoria_manutencao_falhou", error=str(e)[:200])
    return resultado


def agendar_manutencao(tenant_id: UUID, corretor_id: UUID) -> None:
    """Dispara `manter_corretor` sem esperar: a resposta ao corretor não depende dela."""
    tarefa = asyncio.create_task(manter_corretor(tenant_id, corretor_id))
    _tarefas.add(tarefa)
    tarefa.add_done_callback(_tarefas.discard)


async def job_backfill_memoria() -> None:
    """Scheduler: indexa o histórico antigo em lotes pequenos (idempotente)."""
    if not disponivel():
        return
    async with get_admin_session() as session:
        tenants = (await session.execute(text("SELECT id FROM tenants WHERE status = 'active'"))).fetchall()
    for (tid,) in tenants:
        try:
            async with get_session(tid) as session:
                n = await indexar_pendentes(session, tid, None, limite=settings.memoria_backfill_lote)
            if n:
                log.info("memoria_backfill", tenant_id=str(tid)[:8], indexadas=n)
        except Exception as e:  # noqa: BLE001
            log.warning("memoria_backfill_falhou", tenant_id=str(tid)[:8], error=str(e)[:160])
