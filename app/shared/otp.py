"""
Código de acesso de uso único para o portal do corretor.

Enviado pelo WhatsApp do agente da imobiliária ao número do corretor. Só o
hash fica no Redis; vale 5 minutos e aceita poucas tentativas.
"""
import hashlib
import hmac
import json
import secrets
from uuid import UUID

import structlog
from sqlalchemy.sql import text

from app.integration.whatsapp.evolution import EvolutionClient
from app.shared.config import get_settings
from app.shared.database import get_admin_session
from app.shared.redis import get_redis_pool

log = structlog.get_logger()
settings = get_settings()

VALIDADE_SEGUNDOS = 300
INTERVALO_REENVIO = 60
MAX_TENTATIVAS = 5


class CodigoIndisponivel(Exception):
    def __init__(self, mensagem: str, status_code: int):
        super().__init__(mensagem)
        self.status_code = status_code


def _hash(codigo: str) -> str:
    return hmac.new(settings.secret_key.encode(), codigo.encode(), hashlib.sha256).hexdigest()


def _chave(tenant_id: UUID, telefone: str) -> str:
    return f"otp:corretor:{tenant_id}:{telefone}"


async def enviar_codigo(tenant_id: UUID, telefone: str) -> None:
    redis = get_redis_pool()
    # Um envio por minuto por número (evita usar o agente para spam).
    if not await redis.set(f"{_chave(tenant_id, telefone)}:cd", "1", nx=True, ex=INTERVALO_REENVIO):
        raise CodigoIndisponivel("Aguarde um minuto para pedir outro código.", 429)

    async with get_admin_session() as session:
        row = await session.execute(
            text("""
                SELECT instance_id FROM whatsapp_sessions
                WHERE tenant_id = :tid AND tipo = 'agente' AND status = 'connected'
                LIMIT 1
            """),
            {"tid": str(tenant_id)},
        )
        sessao = row.first()
    if not sessao:
        await redis.delete(f"{_chave(tenant_id, telefone)}:cd")
        raise CodigoIndisponivel(
            "O WhatsApp da imobiliária está desconectado. Peça ao administrador para reconectar.", 503
        )

    codigo = f"{secrets.randbelow(1_000_000):06d}"
    await redis.set(
        _chave(tenant_id, telefone),
        json.dumps({"hash": _hash(codigo), "tentativas": 0}),
        ex=VALIDADE_SEGUNDOS,
    )
    # Envio direto (sem passar pelo histórico da conversa com o agente).
    await EvolutionClient().send_text(
        instance_id=sessao.instance_id,
        to=telefone,
        text=f"🔐 Seu código de acesso ao Portal do Corretor: *{codigo}*\nVale por 5 minutos. Não compartilhe.",
    )
    log.info("otp_corretor_enviado", tenant_id=str(tenant_id)[:8])


async def validar_codigo(tenant_id: UUID, telefone: str, codigo: str) -> bool:
    redis = get_redis_pool()
    chave = _chave(tenant_id, telefone)
    bruto = await redis.get(chave)
    if not bruto:
        return False
    dados = json.loads(bruto)
    if hmac.compare_digest(dados["hash"], _hash((codigo or "").strip())):
        await redis.delete(chave)  # uso único
        return True
    dados["tentativas"] += 1
    if dados["tentativas"] >= MAX_TENTATIVAS:
        await redis.delete(chave)
    else:
        ttl = await redis.ttl(chave)
        await redis.set(chave, json.dumps(dados), ex=max(1, ttl))
    return False
