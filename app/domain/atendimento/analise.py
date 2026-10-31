"""
Análise dos atendimentos do corretor (roda no worker, único processo que usa IA).

Lê a conversa do WhatsApp pessoal com o cliente, decide se é um atendimento
imobiliário, resume, extrai o perfil de busca, aponta objeções e próximo
passo e escreve uma sugestão de resposta para o CORRETOR copiar. Liga o
atendimento a um cliente da carteira (ou cria um) e, se o cliente estiver
esperando, avisa o corretor pelo número do agente. Nunca escreve ao cliente.
"""
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Dict, List, Optional
from uuid import UUID
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy.sql import text

from app.domain.atendimento.ingestao import agendar_analise
from app.domain.crm.mensagens import dentro_da_janela
from app.domain.crm.service import CrmService, normalizar_perfil, resumo_perfil
from app.domain.whatsapp.corretor import config_assistente
from app.integration.llm.gemini import GeminiClient, GeminiError
from app.shared.config import get_settings
from app.shared.database import get_session

log = structlog.get_logger()
settings = get_settings()

MAX_MENSAGENS = 60
MAX_CARACTERES = 9000
MAX_TRANSCRICOES_POR_ANALISE = 3
# Só avisa o corretor de mensagens do cliente com até 3 horas.
JANELA_AVISO = timedelta(hours=3)

PROMPT_ANALISE = """Você é o assistente pessoal de um corretor de imóveis. Você lê a conversa de WhatsApp entre o CORRETOR e um CONTATO e ajuda o corretor a vender. Você nunca fala com o contato.

Responda somente com um objeto JSON com estas chaves:
- "imobiliario": true se a conversa trata de comprar, vender ou alugar imóvel; false para família, amigos, fornecedores ou assuntos sem relação. Se false, deixe as demais chaves vazias.
- "nome_cliente": nome do contato se ele aparecer na conversa, senão null.
- "resumo": 2 ou 3 frases sobre o que aconteceu no atendimento até agora.
- "perfil": o que o cliente procura, só com o que ele disse. Chaves opcionais: "interesse" (lista com "comprar", "alugar" ou "vender"), "tipos" (lista), "bairros" (lista), "quartos_min", "vagas_min", "valor_max", "area_min" (números), "prazo" ("imediato", "3_meses", "6_meses" ou "sem_pressa").
- "temperatura": "quente" (pediu visita, perguntou condição específica, quer fechar), "morno" ou "frio" (sem retorno, interesse vago).
- "objecoes": lista curta de objeções ou dúvidas do cliente (preço, financiamento, localização...).
- "alertas": lista curta de pendências do corretor (prometeu enviar algo, cliente pediu documento, prazo combinado).
- "etapa_sugerida": uma de {etapas}, ou null.
- "proximo_passo": uma ação concreta para o corretor, em uma frase.
- "sugestao_resposta": se a última mensagem é do cliente, uma mensagem curta e natural que o corretor possa copiar e enviar. Se o corretor falou por último, null.

Regras da sugestão (o corretor pode enviá-la sem reler):
- Nunca afirme fatos que não estejam na conversa: preço, condições, se aceita FGTS ou financiamento, disponibilidade, documentação, horários livres do corretor.
- Quando o cliente perguntou algo que só o corretor sabe, escreva um marcador entre colchetes para ele completar, por exemplo [confirmar se aceita FGTS] ou [horário disponível].
- Cumpra o que o corretor prometeu (ex.: enviar a planta) sem inventar o conteúdo.

Não invente dados em nenhum campo. Use o mesmo idioma do cliente na sugestão."""


def montar_transcricao(mensagens: List[Dict[str, Any]], fuso: ZoneInfo) -> str:
    """Conversa em texto, da mais antiga para a mais recente, cortando o começo se passar do limite."""
    linhas = []
    for m in mensagens:
        quando = m["created_at"].astimezone(fuso).strftime("%d/%m %H:%M")
        autor = "Corretor" if m["autor"] == "corretor" else "Cliente"
        texto = (m.get("transcricao") or m.get("conteudo") or "").strip()
        if not texto:
            texto = {"audio": "[áudio sem transcrição]", "image": "[imagem]", "document": "[documento]"}.get(m["tipo"], "")
        elif m["tipo"] == "audio":
            texto = f"[áudio] {texto}"
        linhas.append(f"[{quando}] {autor}: {texto[:500]}")
    while len("\n".join(linhas)) > MAX_CARACTERES and len(linhas) > 1:
        linhas.pop(0)
    return "\n".join(linhas)


def texto_aviso(nome: str, analise: Dict[str, Any], minutos: int, n_matches: int) -> str:
    """Aviso ao corretor quando um cliente está esperando resposta."""
    espera = f"há {minutos} min" if minutos < 120 else f"há {minutos // 60} h"
    partes = [f"💬 *{nome}* está esperando sua resposta ({espera})."]
    if analise.get("resumo"):
        partes.append(analise["resumo"])
    perfil = normalizar_perfil(analise.get("perfil"))
    if perfil:
        partes.append(f"🎯 Procura: {resumo_perfil(perfil)}")
    if analise.get("alertas"):
        partes.append("⚠️ " + "; ".join(analise["alertas"][:3]))
    if analise.get("sugestao_resposta"):
        partes.append(f"💡 Sugestão de resposta (é só copiar):\n{analise['sugestao_resposta']}")
    if analise.get("proximo_passo"):
        partes.append(f"➡️ {analise['proximo_passo']}")
    if n_matches:
        rotulo = "imóvel da carteira combina" if n_matches == 1 else "imóveis da carteira combinam"
        partes.append(f"🏠 {n_matches} {rotulo}. Me peça \"o que combina com {nome}\".")
    return "\n\n".join(partes)


def texto_resumo(nome: str, analise: Dict[str, Any], aguardando: bool) -> str:
    """Resumo pedido pelo corretor ao agente."""
    if analise.get("imobiliario") is False:
        return f"A conversa com {nome} não parece ser um atendimento imobiliário."
    partes = [f"📋 *{nome}*" + (" — esperando sua resposta" if aguardando else "")]
    if analise.get("resumo"):
        partes.append(analise["resumo"])
    perfil = normalizar_perfil(analise.get("perfil"))
    if perfil:
        partes.append(f"🎯 Procura: {resumo_perfil(perfil)}")
    if analise.get("objecoes"):
        partes.append("🤔 Objeções: " + "; ".join(analise["objecoes"][:4]))
    if analise.get("alertas"):
        partes.append("⚠️ Pendências: " + "; ".join(analise["alertas"][:4]))
    if analise.get("temperatura"):
        partes.append(f"🌡️ Temperatura: {analise['temperatura']}")
    if analise.get("proximo_passo"):
        partes.append(f"➡️ Próximo passo: {analise['proximo_passo']}")
    if analise.get("sugestao_resposta"):
        partes.append(f"💡 Sugestão de resposta:\n{analise['sugestao_resposta']}")
    return "\n\n".join(partes)


async def _transcrever_audios(session, tenant_id: UUID, corretor_id: UUID, atendimento_id: str) -> None:
    from app.integration.transcription.whisper import transcrever_audio
    from app.integration.whatsapp.evolution import EvolutionClient

    rows = await session.execute(
        text("""
            SELECT m.id, m.midia, ws.instance_id
            FROM atendimento_mensagens m
            JOIN whatsapp_sessions ws ON ws.corretor_id = :cid
            WHERE m.atendimento_id = :aid AND m.tipo = 'audio'
              AND m.transcricao IS NULL AND m.midia IS NOT NULL
            ORDER BY m.created_at DESC
            LIMIT :lim
        """),
        {"cid": str(corretor_id), "aid": atendimento_id, "lim": MAX_TRANSCRICOES_POR_ANALISE},
    )
    for r in rows.fetchall():
        midia = r.midia or {}
        texto = None
        try:
            base64 = await EvolutionClient().get_media_base64(r.instance_id, midia.get("key") or {}, midia.get("message"))
            fonte = f"data:audio/ogg;base64,{base64}" if base64 else midia.get("url")
            if fonte:
                texto = await transcrever_audio(fonte)
        except Exception as e:  # noqa: BLE001 - segue sem a transcrição
            log.warning("atendimento_transcricao_falhou", error=str(e)[:200])
        await session.execute(
            # "" marca como tentado, para não insistir a cada análise.
            text("UPDATE atendimento_mensagens SET transcricao = :t WHERE id = :id"),
            {"t": (texto or "").strip(), "id": str(r.id)},
        )


async def analisar(
    session,
    tenant_id: UUID,
    corretor_id: UUID,
    atendimento_id: str,
    avisar: bool = True,
    levantar_erro_da_ia: bool = False,
) -> Optional[Dict[str, Any]]:
    """Analisa o atendimento, atualiza carteira e análise e, se cabível, avisa o corretor."""
    row = await session.execute(
        text("""
            SELECT a.*, c.nome AS corretor_nome, c.telefone AS corretor_telefone,
                   c.assistente_config, t.fuso, t.horario_inicio, t.horario_fim
            FROM atendimentos a
            JOIN corretores c ON c.id = a.corretor_id
            JOIN tenants t ON t.id = a.tenant_id
            WHERE a.id = :aid AND a.tenant_id = :tid AND a.corretor_id = :cid
        """),
        {"aid": atendimento_id, "tid": str(tenant_id), "cid": str(corretor_id)},
    )
    at = row.first()
    if not at:
        return None
    config = config_assistente(at.assistente_config)
    if not config["ativo"]:
        return None
    if at.tipo_manual and at.tipo_contato != "imobiliario":
        return None  # o corretor disse que é pessoal/outro: não gasta IA, não cria cliente e não avisa
    fuso = ZoneInfo(at.fuso or settings.usage_timezone)

    await _transcrever_audios(session, tenant_id, corretor_id, atendimento_id)
    msgs = await session.execute(
        text("""
            SELECT autor, tipo, conteudo, transcricao, created_at FROM (
                SELECT * FROM atendimento_mensagens WHERE atendimento_id = :aid
                ORDER BY created_at DESC LIMIT :lim
            ) ultimas ORDER BY created_at
        """),
        {"aid": atendimento_id, "lim": MAX_MENSAGENS},
    )
    mensagens = [dict(m._mapping) for m in msgs.fetchall()]
    if not mensagens:
        return None

    crm = CrmService(session)
    etapas = ", ".join(e["nome"] for e in await crm.etapas(tenant_id))
    try:
        analise = await GeminiClient().gerar_json(
            PROMPT_ANALISE.replace("{etapas}", etapas),
            f"Contato: {at.nome_contato or 'sem nome'} ({at.telefone_cliente})\n\nConversa:\n"
            + montar_transcricao(mensagens, fuso),
        )
    except GeminiError as e:
        log.warning("atendimento_analise_falhou", error=str(e)[:200])
        if levantar_erro_da_ia:
            raise
        return None

    imobiliario = True if (at.tipo_manual and at.tipo_contato == "imobiliario") else bool(analise.get("imobiliario"))
    nome = (analise.get("nome_cliente") or at.nome_contato or at.telefone_cliente).strip()[:255]
    perfil = normalizar_perfil(analise.get("perfil")) if imobiliario else {}
    temperatura = analise.get("temperatura") if analise.get("temperatura") in ("quente", "morno", "frio") else None

    # Liga o atendimento ao cliente da carteira (pelo telefone) ou cria um.
    lead_id = str(at.lead_id) if at.lead_id else None
    if imobiliario and not lead_id:
        existente = await session.execute(
            text("""
                SELECT id FROM crm_leads
                WHERE tenant_id = :tid AND corretor_id = :cid AND telefone = :tel AND status <> 'arquivado'
                ORDER BY updated_at DESC LIMIT 1
            """),
            {"tid": str(tenant_id), "cid": str(corretor_id), "tel": at.telefone_cliente},
        )
        r = existente.first()
        if r:
            lead_id = str(r.id)
        elif config["carteira_auto"]:
            lead = await crm.criar_lead(
                tenant_id, corretor_id, nome=nome, telefone=at.telefone_cliente,
                perfil=perfil, origem="whatsapp_pessoal", temperatura=temperatura or "morno",
            )
            lead_id = lead["id"]
    if imobiliario and lead_id and (perfil or temperatura):
        await crm.atualizar_lead(tenant_id, UUID(lead_id), perfil=perfil, temperatura=temperatura)

    await session.execute(
        text("""
            UPDATE atendimentos SET analise = CAST(:analise AS jsonb), analisado_em = NOW(),
                imobiliario = :imob, lead_id = :lead
            WHERE id = :aid
        """),
        {"analise": json.dumps(analise, ensure_ascii=False), "imob": imobiliario,
         "lead": lead_id, "aid": atendimento_id},
    )

    # Aviso proativo: só atendimento imobiliário com o cliente esperando,
    # uma vez por mensagem nova do cliente, no horário comercial.
    ja_avisado = at.avisado_em and at.ultima_do_cliente_em and at.avisado_em >= at.ultima_do_cliente_em
    # Conversa antiga (ex.: histórico importado ao conectar) não gera aviso.
    recente = at.ultima_do_cliente_em and datetime.now(timezone.utc) - at.ultima_do_cliente_em < JANELA_AVISO
    if avisar and imobiliario and config["avisos"] and at.aguardando_corretor and not ja_avisado and recente:
        agora = datetime.now(fuso)
        if not dentro_da_janela(agora, at.horario_inicio, at.horario_fim):
            abertura = datetime.combine(agora.date(), at.horario_inicio, fuso)
            if agora.time() >= at.horario_fim:
                abertura += timedelta(days=1)
            await agendar_analise(tenant_id, corretor_id, atendimento_id, (abertura - agora).total_seconds())
        else:
            n_matches = 0
            if lead_id:
                lead = await crm.get_lead(tenant_id, UUID(lead_id))
                if lead and lead.get("perfil"):
                    n_matches = len(await crm.match(tenant_id, lead))
            minutos = int((datetime.now(fuso) - at.ultima_do_cliente_em.astimezone(fuso)).total_seconds() // 60)
            from app.worker.pipeline import _enviar_resposta

            await _enviar_resposta(
                tenant_id=tenant_id,
                corretor=SimpleNamespace(id=corretor_id, telefone=at.corretor_telefone),
                texto=texto_aviso(nome, analise, max(1, minutos), n_matches),
                session=session,
            )
            await session.execute(
                text("UPDATE atendimentos SET avisado_em = NOW() WHERE id = :aid"), {"aid": atendimento_id}
            )
            log.info("atendimento_aviso_enviado", tenant_id=str(tenant_id)[:8])
    return analise


PROMPT_SUGESTAO = """Você escreve a próxima mensagem de WhatsApp de um corretor de imóveis para o contato, a partir da conversa.
Responda somente com JSON: {"sugestao": "<mensagem>"}.
Regras: mensagem curta e natural, no tom e idioma do corretor e do cliente, pronta para enviar; se o cliente falou por último, responda ao que ele disse; se o corretor falou por último, escreva um acompanhamento gentil (follow-up) sem pressionar. Nunca afirme fatos que não estejam na conversa (preço, condições, FGTS, financiamento, disponibilidade, horários). Quando faltar uma informação que só o corretor sabe, deixe um marcador entre colchetes, por exemplo [confirmar horário]. Não use markdown nem assine."""


async def sugerir_resposta(session, tenant_id: UUID, corretor_id: UUID, atendimento_id: str, instrucao: Optional[str] = None) -> Optional[str]:
    """Rascunho da próxima mensagem para o cliente, gerado na hora a partir da conversa (None se não há conversa)."""
    at = (await session.execute(
        text("""SELECT a.nome_contato, a.telefone_cliente, t.fuso, c.nome AS corretor FROM atendimentos a
                JOIN tenants t ON t.id = a.tenant_id JOIN corretores c ON c.id = a.corretor_id
                WHERE a.id = :aid AND a.tenant_id = :tid AND a.corretor_id = :cid"""),
        {"aid": atendimento_id, "tid": str(tenant_id), "cid": str(corretor_id)})).first()
    if not at:
        return None
    msgs = (await session.execute(
        text("""SELECT autor, tipo, conteudo, transcricao, created_at FROM (
                    SELECT * FROM atendimento_mensagens WHERE atendimento_id = :aid ORDER BY created_at DESC LIMIT :lim
                ) u ORDER BY created_at"""),
        {"aid": atendimento_id, "lim": 40})).fetchall()
    if not msgs:
        return None
    fuso = ZoneInfo(at.fuso or settings.usage_timezone)
    conteudo = f"Corretor: {at.corretor or 'corretor'}\nContato: {at.nome_contato or 'sem nome'}\n\nConversa:\n" + montar_transcricao([dict(m._mapping) for m in msgs], fuso)
    if instrucao:
        conteudo += f"\n\nPedido do corretor para esta mensagem: {instrucao.strip()[:300]}"
    resposta = await GeminiClient().gerar_json(PROMPT_SUGESTAO, conteudo, max_tokens=600)
    texto = str(resposta.get("sugestao") or "").strip()
    return texto or None


async def processar_job_analise(job: Dict[str, Any]) -> None:
    """Entrada pelo worker (fila da conversa do corretor, já com o lock)."""
    tenant_id, corretor_id = UUID(job["tenant_id"]), UUID(job["corretor_id"])
    async with get_session(tenant_id) as session:
        await analisar(session, tenant_id, corretor_id, job["atendimento_id"], avisar=True)
