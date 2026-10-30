"""
Ingestão das conversas do WhatsApp pessoal do corretor com os clientes.

Só guarda e agenda a análise. O assistente não responde ao cliente: tudo o
que ele produz (resumo, análise, sugestão) vai para o corretor pelo número do
agente da imobiliária.
"""
import json
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import UUID

import structlog
from sqlalchemy.sql import text

from app.domain.conversa.ingestao import _extrair_conteudo, _extrair_telefone
from app.domain.whatsapp.corretor import config_assistente
from app.shared.config import get_settings
from app.shared.database import get_session
from app.shared.phone import normalize_phone
from app.shared.redis import get_redis_pool

log = structlog.get_logger()
settings = get_settings()

FILA_ANALISE = "atendimentos:pendentes"


def membro_fila(tenant_id: UUID, corretor_id: UUID, atendimento_id: str) -> str:
    return f"{tenant_id}:{corretor_id}:{atendimento_id}"


async def agendar_analise(tenant_id: UUID, corretor_id: UUID, atendimento_id: str, atraso_s: float) -> None:
    """Debounce: cada mensagem nova empurra a análise para depois."""
    await get_redis_pool().zadd(
        FILA_ANALISE, {membro_fila(tenant_id, corretor_id, atendimento_id): time.time() + atraso_s}
    )


def _momento(data: Dict[str, Any]) -> datetime:
    """Horário real da mensagem (messageTimestamp em segundos), ou agora."""
    try:
        ts = int(data.get("messageTimestamp") or 0)
    except (TypeError, ValueError):
        ts = 0
    return datetime.fromtimestamp(ts, timezone.utc) if ts > 0 else datetime.now(timezone.utc)


async def ingerir_mensagem_atendimento(
    tenant_id: UUID, corretor_id: UUID, data: Dict[str, Any], agendar: bool = True
) -> Optional[str]:
    """Guarda a mensagem; devolve o id do atendimento quando ela é nova."""
    key = data.get("key") or {}
    message_id = key.get("id") or ""
    from_me = bool(key.get("fromMe"))

    telefone_raw = _extrair_telefone(key)  # ignora grupos e broadcasts
    if not telefone_raw or not message_id:
        return None
    try:
        telefone = normalize_phone(telefone_raw)
    except ValueError:
        return None

    async with get_session(tenant_id) as session:
        row = await session.execute(
            text("""
                SELECT c.telefone, c.assistente_config, ws.status
                FROM corretores c
                JOIN whatsapp_sessions ws ON ws.corretor_id = c.id
                WHERE c.id = :cid AND c.status = 'active'
            """),
            {"cid": str(corretor_id)},
        )
        corretor = row.first()
        # Só lê com a sessão verificada (número confere) e o assistente ligado.
        if not corretor or corretor.status != "connected":
            return None
        if not config_assistente(corretor.assistente_config)["ativo"]:
            return None

        # Conversas do corretor com o próprio agente (ou consigo) não são atendimentos.
        agentes = await session.execute(
            text("SELECT numero FROM whatsapp_sessions WHERE tenant_id = :tid AND tipo = 'agente'"),
            {"tid": str(tenant_id)},
        )
        if telefone == corretor.telefone or telefone in {r.numero for r in agentes.fetchall()}:
            return None

        tipo, conteudo, audio_url = _extrair_conteudo(data.get("message") or {}, data)
        if tipo == "text" and not (conteudo or "").strip():
            return None
        midia = None
        if tipo == "audio":
            # Guarda só a referência; a transcrição acontece na análise (worker).
            mensagem = {k: v for k, v in (data.get("message") or {}).items() if k != "base64"}
            midia = {"key": key, "message": mensagem, "url": audio_url if (audio_url or "").startswith("http") else None}

        autor = "corretor" if from_me else "cliente"
        nome = None if from_me else (data.get("pushName") or None)
        atendimento = await session.execute(
            text("""
                INSERT INTO atendimentos (tenant_id, corretor_id, telefone_cliente, nome_contato)
                VALUES (:tid, :cid, :tel, :nome)
                ON CONFLICT (corretor_id, telefone_cliente) DO UPDATE SET
                    nome_contato = COALESCE(EXCLUDED.nome_contato, atendimentos.nome_contato)
                RETURNING id
            """),
            {"tid": str(tenant_id), "cid": str(corretor_id), "tel": telefone,
             "nome": (nome or "")[:255] or None},
        )
        atendimento_id = str(atendimento.scalar())
        inserida = await session.execute(
            text("""
                INSERT INTO atendimento_mensagens (
                    tenant_id, atendimento_id, message_id, autor, tipo, conteudo, midia, created_at
                ) VALUES (:tid, :aid, :mid, :autor, :tipo, :conteudo, CAST(:midia AS jsonb), :quando)
                ON CONFLICT (tenant_id, message_id) DO NOTHING
                RETURNING id
            """),
            {"tid": str(tenant_id), "aid": atendimento_id, "mid": message_id, "autor": autor,
             "tipo": tipo, "conteudo": conteudo, "midia": json.dumps(midia) if midia else None,
             "quando": _momento(data)},
        )
        if not inserida.first():
            return None  # duplicada (webhook repetido ou já importada)

        # Estado do atendimento recalculado das mensagens: vale para mensagens
        # ao vivo e para as importadas fora de ordem.
        await session.execute(
            text("""
                UPDATE atendimentos a SET
                    ultima_mensagem_em = u.created_at,
                    aguardando_corretor = (u.autor = 'cliente'),
                    ultima_do_cliente_em = c.ultima
                FROM (
                    SELECT autor, created_at FROM atendimento_mensagens
                    WHERE atendimento_id = :aid ORDER BY created_at DESC LIMIT 1
                ) u,
                (
                    SELECT MAX(created_at) AS ultima FROM atendimento_mensagens
                    WHERE atendimento_id = :aid AND autor = 'cliente'
                ) c
                WHERE a.id = :aid
            """),
            {"aid": atendimento_id},
        )

    if agendar:
        await agendar_analise(tenant_id, corretor_id, atendimento_id, settings.assistente_analise_atraso_min * 60)
    log.info("atendimento_mensagem_ingerida", tenant_id=str(tenant_id)[:8], autor=autor, tipo=tipo)
    return atendimento_id
