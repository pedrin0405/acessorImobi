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

log = structlog.get_logger()

# Mapeamento instanceId → tenant_id (preenchido na criação de sessão WhatsApp)
# Lido do Redis para performance — cache de 5 minutos
INSTANCE_TENANT_CACHE_TTL = 300


async def _resolve_tenant_by_instance(instance_id: str) -> Optional[UUID]:
    """
    Resolve o tenant_id a partir do instanceId da sessão WhatsApp.
    Busca primeiro no Redis (cache), depois no PostgreSQL.
    Nunca usa dado do corpo da mensagem para esta resolução.
    """
    redis = get_redis_pool()
    cache_key = f"instance_tenant:{instance_id}"
    cached = await redis.get(cache_key)
    if cached:
        return UUID(cached)

    async with get_admin_session() as session:
        row = await session.execute(
            text("SELECT tenant_id FROM whatsapp_sessions WHERE instance_id = :iid"),
            {"iid": instance_id},
        )
        result = row.first()

    if not result:
        return None

    tenant_id = result[0]
    await redis.set(cache_key, str(tenant_id), ex=INSTANCE_TENANT_CACHE_TTL)
    return tenant_id


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

    # Ignorar mensagens enviadas pelo próprio agente
    if from_me:
        return

    remote_jid = key.get("remoteJid", "")
    # Normaliza o número removendo o sufixo '@s.whatsapp.net'
    telefone_raw = remote_jid.split("@")[0] if "@" in remote_jid else remote_jid

    # --- 1. Resolve tenant pelo instanceId ---
    tenant_id = await _resolve_tenant_by_instance(instance_id)
    if not tenant_id:
        log.warning("webhook_instance_sem_tenant", instance_id=instance_id)
        return

    # --- 2. Normaliza telefone ---
    try:
        telefone = normalize_phone(telefone_raw)
    except ValueError:
        log.warning("webhook_telefone_invalido", raw=telefone_raw[:10])
        return

    # --- 3. Deduplica ---
    if message_id and await _deduplicate(tenant_id, message_id):
        log.debug("webhook_mensagem_duplicada", message_id=message_id)
        return

    # --- 4. Extrai conteúdo da mensagem ---
    tipo, conteudo, audio_url = _extrair_conteudo(message, data)

    # --- 5. Localiza ou cria corretor ---
    async with get_session(tenant_id) as session:
        corretor_service = CorretorService(session)
        corretor = await corretor_service.get_ou_criar(
            tenant_id=tenant_id,
            telefone=telefone,
        )

        # --- 6. Persiste a mensagem ---
        from sqlalchemy import insert
        from app.shared.database import get_session  # evitar ciclo
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
    job_payload = json.dumps({
        "tenant_id": str(tenant_id),
        "corretor_id": str(corretor.id),
        "mensagem_id": mensagem_id,
        "tipo": tipo,
        "audio_url": audio_url,
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


def _extrair_conteudo(message: Dict, data: Dict):
    """Extrai tipo e conteúdo da mensagem Evolution API."""
    tipo = "text"
    conteudo = None
    audio_url = None

    if "conversation" in message:
        conteudo = message["conversation"]
    elif "extendedTextMessage" in message:
        conteudo = message["extendedTextMessage"].get("text", "")
    elif "audioMessage" in message:
        tipo = "audio"
        # URL da mídia do Evolution API — será baixada e armazenada no MinIO pelo worker
        audio_url = data.get("mediaUrl") or data.get("base64")
    elif "imageMessage" in message:
        tipo = "image"
        conteudo = message["imageMessage"].get("caption", "")
    elif "documentMessage" in message:
        tipo = "document"
        conteudo = message["documentMessage"].get("fileName", "")

    return tipo, conteudo, audio_url
