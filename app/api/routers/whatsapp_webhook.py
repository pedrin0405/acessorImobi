"""
Webhook de ingestão de mensagens do WhatsApp via Evolution API.

Pipeline determinístico:
1. Responde 202 imediatamente
2. Resolve tenant pelo instanceId (nunca pelo corpo da mensagem)
3. Normaliza telefone, localiza corretor, verifica status
4. Deduplica por message_id
5. Persiste a mensagem
6. Enfileira job na fila do ARQ
"""
import hashlib
from typing import Any, Dict

import structlog
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request

from app.domain.conversa.ingestao import processar_webhook
from app.shared.config import get_settings

router = APIRouter()
log = structlog.get_logger()
settings = get_settings()


def _verify_evolution_signature(body: bytes, signature: str) -> bool:
    """Verifica a assinatura HMAC do webhook da Evolution API."""
    expected = hashlib.sha256(
        (settings.evolution_api_key + body.decode()).encode()
    ).hexdigest()
    return signature == expected


@router.post("/{instance_id}", status_code=202, summary="Ingestão de mensagem WhatsApp")
async def receive_webhook(
    instance_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    x_evolution_signature: str = Header(default=""),
):
    """
    Ponto de entrada único para todos os eventos do Evolution API.
    - Responde 202 imediatamente (sem esperar processamento)
    - O processamento real ocorre no worker, após enfileiramento
    """
    body = await request.body()

    # Verificação de assinatura (skip em development)
    if settings.environment == "production":
        if not _verify_evolution_signature(body, x_evolution_signature):
            log.warning("webhook_signature_invalid", instance_id=instance_id)
            raise HTTPException(status_code=401, detail="Assinatura inválida")

    try:
        payload: Dict[str, Any] = await request.json()
    except Exception:
        log.warning("webhook_invalid_json", instance_id=instance_id)
        return {"status": "ignored", "reason": "invalid_json"}

    # Processa em background sem bloquear a resposta
    background_tasks.add_task(
        processar_webhook,
        instance_id=instance_id,
        payload=payload,
    )

    return {"status": "accepted"}
