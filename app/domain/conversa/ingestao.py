"""
Ingestão de mensagens WhatsApp.

Responsabilidades:
1. Resolve tenant pelo instanceId (NÃO pelo corpo da mensagem)
2. Normaliza telefone, localiza/cria corretor, verifica status
3. Deduplica por message_id
4. Persiste a mensagem
5. Enfileira job com chave de partição tenant:corretor
"""
import json
from typing import Any, Dict, Optional
from uuid import UUID

import structlog
from sqlalchemy import select, text

from app.domain.corretor.service import CorretorService
from app.shared.database import get_admin_session, get_session
from app.shared.phone import normalize_phone
from app.shared.redis import get_redis_pool
from app.shared.security import mask_phone

log = structlog.get_logger()

# Mapeamento instanceId → tenant_id (preenchido na criação de sessão WhatsApp)
# Lido do Redis para performance — cache de 5 minutos
INSTANCE_TENANT_CACHE_TTL = 300


async def _resolve_instancia(instance_id: str) -> Optional[Dict[str, Any]]:
    """
    Resolve tenant e dono da sessão (agente ou corretor) pelo instanceId.
    Busca primeiro no Redis (cache), depois no PostgreSQL.
    Nunca usa dado do corpo da mensagem para esta resolução.
    """
    redis = get_redis_pool()
    cache_key = f"instance_owner:{instance_id}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    async with get_admin_session() as session:
        row = await session.execute(
            text("SELECT tenant_id, tipo, corretor_id FROM whatsapp_sessions WHERE instance_id = :iid"),
            {"iid": instance_id},
        )
        result = row.first()

    if not result:
        return None

    info = {
        "tenant_id": str(result.tenant_id),
        "tipo": result.tipo,
        "corretor_id": str(result.corretor_id) if result.corretor_id else None,
    }
    await redis.set(cache_key, json.dumps(info), ex=INSTANCE_TENANT_CACHE_TTL)
    return info


async def _resolve_tenant_by_instance(instance_id: str) -> Optional[UUID]:
    info = await _resolve_instancia(instance_id)
    return UUID(info["tenant_id"]) if info else None


async def _deduplicate(tenant_id: UUID, message_id: str) -> bool:
    """
    Verifica se a mensagem já foi processada (idempotência).
    Retorna True se é duplicata.
    """
    redis = get_redis_pool()
    key = f"msgdedup:{tenant_id}:{message_id}"
    result = await redis.set(key, "1", nx=True, ex=3600)  # TTL 1h
    return result is None  # None = SET não executou = já existia


async def processar_webhook(instance_id: str, payload: Dict[str, Any]) -> None:
    """
    Passo de ingestão: roda na background task da API.
    NÃO processa a conversa — apenas persiste e enfileira.
    """
    # Filtra eventos que não são mensagem
    event_type = payload.get("event", "")
    if event_type not in ("messages.upsert",):
        log.debug("webhook_event_ignored", event=event_type, instance_id=instance_id)
        return

    data = payload.get("data", {})
    message = data.get("message", {})
    key = data.get("key", {})
    message_id = key.get("id", "")
    from_me = key.get("fromMe", False)

    # Número pessoal de corretor: só observação dos atendimentos (lê os dois
    # lados da conversa). Nunca entra na fila de resposta do agente.
    instancia = await _resolve_instancia(instance_id)
    if instancia and instancia["tipo"] == "corretor":
        from app.domain.atendimento.ingestao import ingerir_mensagem_atendimento

        await ingerir_mensagem_atendimento(
            UUID(instancia["tenant_id"]), UUID(instancia["corretor_id"]), data
        )
        return

    # Ignorar mensagens enviadas pelo próprio agente
    if from_me:
        return

    # O WhatsApp pode endereçar por LID; o telefone real vem em remoteJidAlt.
    telefone_raw = _extrair_telefone(key)
    if not telefone_raw:
        log.warning(
            "webhook_sem_telefone_resolvivel",
            remote_jid=str(key.get("remoteJid") or "")[:32],
            addressing_mode=key.get("addressingMode"),
        )
        return

    # --- 1. Resolve tenant pelo instanceId ---
    tenant_id = await _resolve_tenant_by_instance(instance_id)
    if not tenant_id:
        log.warning("webhook_instance_sem_tenant", instance_id=instance_id)
        return

    # --- 2. Normaliza telefone ---
    try:
        telefone = normalize_phone(telefone_raw)
    except ValueError:
        # O tamanho ajuda a identificar JIDs móveis antigos (12 dígitos), que
        # não têm o nono dígito e antes eram descartados silenciosamente.
        log.warning(
            "webhook_telefone_invalido",
            raw=mask_phone(telefone_raw),
            tamanho=len(telefone_raw),
        )
        return

    # --- 3. Deduplica ---
    if message_id and await _deduplicate(tenant_id, message_id):
        log.debug("webhook_mensagem_duplicada", message_id=message_id)
        return

    # --- 4. Extrai conteúdo da mensagem ---
    tipo, conteudo, audio_url = _extrair_conteudo(message, data)

    # Mensagem sem conteúdo não deve acionar a IA nem entrar no histórico.
    if tipo == "text" and not (conteudo or "").strip():
        log.info("webhook_mensagem_sem_conteudo", message_id=message_id, tipo=tipo)
        return
    if tipo == "audio" and not audio_url:
        # O webhook nem sempre traz a mídia no payload; o worker busca o
        # base64 na Evolution via message key. Só aborta se não houver key.
        if not key.get("id"):
            log.warning("webhook_audio_sem_midia", message_id=message_id)
            return
        log.info("webhook_audio_sem_url_será_buscado", message_id=message_id)

    # --- 5. Localiza ou cria corretor ---
    async with get_session(tenant_id) as session:
        corretor_service = CorretorService(session)
        corretor = await corretor_service.get_ou_criar(
            tenant_id=tenant_id,
            telefone=telefone,
        )

        # --- 6. Persiste a mensagem ---
        msg_insert = text("""
            INSERT INTO mensagens (
                tenant_id, corretor_id, message_id,
                direcao, tipo, conteudo, status
            ) VALUES (
                :tenant_id, :corretor_id, :message_id,
                'inbound', :tipo, :conteudo, 'queued'
            )
            ON CONFLICT (tenant_id, message_id) DO NOTHING
            RETURNING id
        """)
        result = await session.execute(msg_insert, {
            "tenant_id": str(tenant_id),
            "corretor_id": str(corretor.id),
            "message_id": message_id,
            "tipo": tipo,
            "conteudo": conteudo,
        })
        msg_row = result.first()

    if not msg_row:
        # Conflito de inserção = duplicata resolvida pelo banco
        return

    mensagem_id = str(msg_row[0])

    # --- 7. Enfileira para o worker ---
    redis = get_redis_pool()
    # Para áudio sem mídia utilizável no payload, guarda o objeto da mensagem
    # (sem base64) para a Evolution decodificar a mídia sem depender do banco dela.
    mensagem_original = None
    if tipo == "audio" and (not audio_url or "mmg.whatsapp.net" in (audio_url or "")):
        mensagem_original = data.get("message") or {}
    job_payload = json.dumps({
        "tenant_id": str(tenant_id),
        "corretor_id": str(corretor.id),
        "mensagem_id": mensagem_id,
        "tipo": tipo,
        "audio_url": audio_url,
        # Key da mensagem: permite ao worker baixar a mídia via Evolution
        # quando o webhook não traz a URL/base64.
        "message_key": {
            "remoteJid": key.get("remoteJid"),
            "remoteJidAlt": key.get("remoteJidAlt"),
            "fromMe": key.get("fromMe", False),
            "id": key.get("id"),
            "participant": key.get("participant"),
        },
        "message": mensagem_original,
    })
    # Fila particionada por conversa: garante ordem por conversa, paralelismo entre conversas
    queue_key = f"queue:conversa:{tenant_id}:{corretor.id}"
    await redis.rpush(queue_key, job_payload)
    await redis.sadd("queue:active_conversations", queue_key)

    log.info(
        "mensagem_enfileirada",
        tenant_id=str(tenant_id)[:8],
        corretor_id=str(corretor.id)[:8],
        tipo=tipo,
    )


def _extrair_telefone(key: Dict[str, Any]) -> Optional[str]:
    """
    Extrai o telefone real do JID.

    O WhatsApp passou a usar endereçamento LID: `remoteJid` pode ser
    `202237125087346@lid`, enquanto o número real vem em `remoteJidAlt`
    (ou `senderPn`/`participantPn`). Também removemos o sufixo de device
    (`:12`) que aparece em alguns JIDs multi-device.
    """
    jid_principal = str(key.get("remoteJid") or "")

    # Grupos e broadcasts não são conversas de corretor.
    if jid_principal.endswith("@g.us") or jid_principal.endswith("@broadcast"):
        return None

    candidatos = [
        key.get("remoteJidAlt"),
        key.get("senderPn"),
        key.get("participantPn"),
        key.get("participant"),
    ]

    # Só usa o remoteJid como telefone quando ele não for um LID.
    if jid_principal and not jid_principal.endswith("@lid"):
        candidatos.append(jid_principal)

    for candidato in candidatos:
        if not candidato:
            continue
        raw = "".join(
            ch for ch in str(candidato).split("@")[0].split(":")[0] if ch.isdigit()
        )
        if len(raw) >= 10:
            return raw

    return None


def _extrair_conteudo(message: Dict, data: Dict):
    """Extrai tipo e conteúdo da mensagem Evolution API."""
    tipo = "text"
    conteudo = None
    audio_url = None

    # Desembrulha mensagens efêmeras / de visualização única / com legenda
    for wrapper in (
        "ephemeralMessage",
        "viewOnceMessage",
        "viewOnceMessageV2",
        "documentWithCaptionMessage",
        "editedMessage",
    ):
        inner = message.get(wrapper)
        if isinstance(inner, dict) and isinstance(inner.get("message"), dict):
            message = inner["message"]
            break

    if "conversation" in message:
        conteudo = message["conversation"]
    elif "extendedTextMessage" in message:
        conteudo = message["extendedTextMessage"].get("text", "")
    elif "audioMessage" in message:
        tipo = "audio"
        # URL/base64 da mídia — será baixada e armazenada no MinIO pelo worker
        audio_url = (
            data.get("mediaUrl")
            or data.get("base64")
            or message.get("base64")
            or message.get("audioMessage", {}).get("base64")
        )
    elif "imageMessage" in message:
        tipo = "image"
        conteudo = message["imageMessage"].get("caption", "")
    elif "documentMessage" in message:
        tipo = "document"
        conteudo = message["documentMessage"].get("fileName", "")

    return tipo, conteudo, audio_url
