"""
Contabilização do consumo de APIs externas (Gemini).

Os limites do plano gratuito são diários e por minuto, por modelo. O worker
registra cada chamada (sucesso, erro ou 429) e o painel do desenvolvedor
consulta os totais.

- Totais diários: PostgreSQL (`api_usage`).
- Requisições por minuto, último 429 e cooldown: Redis (janela deslizante).

A gravação é best-effort: uma falha aqui nunca deve derrubar o atendimento.
"""
import asyncio
import re
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy.sql import text

from app.shared.config import get_settings
from app.shared.database import get_admin_session
from app.shared.redis import get_redis_pool

log = structlog.get_logger()
settings = get_settings()

_lock_schema = asyncio.Lock()
_schema_criado = False

_DDL = """
CREATE TABLE IF NOT EXISTS api_usage (
    dia             DATE NOT NULL,
    provider        VARCHAR(30) NOT NULL,
    operation       VARCHAR(30) NOT NULL,
    model           VARCHAR(120) NOT NULL,
    requests        INTEGER NOT NULL DEFAULT 0,
    errors          INTEGER NOT NULL DEFAULT 0,
    input_tokens    BIGINT NOT NULL DEFAULT 0,
    output_tokens   BIGINT NOT NULL DEFAULT 0,
    characters      BIGINT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (dia, provider, operation, model)
);
CREATE INDEX IF NOT EXISTS idx_api_usage_dia ON api_usage (dia DESC);
ALTER TABLE api_usage ADD COLUMN IF NOT EXISTS rate_limited INTEGER NOT NULL DEFAULT 0
"""

_JANELA_RPM = 60  # segundos
_COOLDOWN_PADRAO = 60
_COOLDOWN_MAX = 300


def _chave(tipo: str, provider: str, operation: str) -> str:
    return f"usage:{tipo}:{provider}:{operation}"


async def _registrar_tempo_real(
    provider: str, operation: str, requests: int, rate_limited: int
) -> None:
    """Alimenta a janela de RPM e marca o último 429 no Redis."""
    redis = get_redis_pool()
    agora = time.time()
    chave_rpm = _chave("rpm", provider, operation)
    pipe = redis.pipeline()
    for _ in range(max(0, requests)):
        pipe.zadd(chave_rpm, {f"{agora}:{uuid.uuid4().hex[:8]}": agora})
    pipe.zremrangebyscore(chave_rpm, 0, agora - _JANELA_RPM)
    pipe.expire(chave_rpm, _JANELA_RPM * 2)
    if rate_limited:
        pipe.set(
            _chave("last429", provider, operation),
            datetime.now(timezone.utc).isoformat(),
            ex=86400,
        )
    await pipe.execute()


def segundos_retry(corpo_erro: str) -> int:
    """Extrai o retryDelay ("33s") do corpo de um 429 do Gemini."""
    match = re.search(r'"retryDelay"\s*:\s*"(\d+)(?:\.\d+)?s"', corpo_erro or "")
    segundos = int(match.group(1)) if match else _COOLDOWN_PADRAO
    return max(5, min(segundos, _COOLDOWN_MAX))


async def iniciar_cooldown(provider: str, operation: str, segundos: int) -> None:
    """Após um 429, pausa as chamadas para não insistir no limite estourado."""
    try:
        await get_redis_pool().set(
            _chave("cooldown", provider, operation), "1", ex=max(1, int(segundos))
        )
    except Exception as e:  # noqa: BLE001
        log.warning("usage_cooldown_falhou", error=str(e)[:200])


async def cooldown_restante(provider: str, operation: str) -> int:
    """Segundos restantes de pausa (0 = liberado)."""
    try:
        ttl = await get_redis_pool().ttl(_chave("cooldown", provider, operation))
    except Exception:  # noqa: BLE001 - sem Redis, não bloqueia o atendimento
        return 0
    return max(0, int(ttl or 0))


async def uso_tempo_real(provider: str, operation: str) -> Dict[str, Any]:
    """RPM do último minuto, horário do último 429 e cooldown ativo."""
    redis = get_redis_pool()
    agora = time.time()
    chave_rpm = _chave("rpm", provider, operation)
    try:
        await redis.zremrangebyscore(chave_rpm, 0, agora - _JANELA_RPM)
        rpm = await redis.zcard(chave_rpm)
        ultimo_429 = await redis.get(_chave("last429", provider, operation))
    except Exception as e:  # noqa: BLE001
        log.warning("usage_tempo_real_falhou", error=str(e)[:200])
        rpm, ultimo_429 = 0, None
    return {
        "rpm": int(rpm or 0),
        "ultimo_429": ultimo_429,
        "cooldown_segundos": await cooldown_restante(provider, operation),
    }


def dia_local() -> date:
    """Data corrente no fuso configurado (usada para os limites diários)."""
    fuso = ZoneInfo(settings.usage_timezone or "America/Sao_Paulo")
    return datetime.now(fuso).date()


async def _garantir_tabela(session) -> None:
    global _schema_criado
    if _schema_criado:
        return
    async with _lock_schema:
        if _schema_criado:
            return
        for comando in _DDL.split(";"):
            if comando.strip():
                await session.execute(text(comando))
        await session.commit()
        _schema_criado = True


async def registrar_uso(
    *,
    provider: str,
    operation: str,
    model: str,
    requests: int = 1,
    errors: int = 0,
    input_tokens: int = 0,
    output_tokens: int = 0,
    characters: int = 0,
    rate_limited: int = 0,
    dia: Optional[date] = None,
) -> None:
    """Incrementa os contadores do dia para o modelo/operação."""
    dia = dia or dia_local()
    try:
        await _registrar_tempo_real(provider, operation, requests, rate_limited)
    except Exception as e:  # noqa: BLE001 - métrica nunca derruba o atendimento
        log.warning("registrar_uso_tempo_real_falhou", provider=provider, error=str(e)[:200])
    try:
        async with get_admin_session() as session:
            await _garantir_tabela(session)
            await session.execute(
                text("""
                    INSERT INTO api_usage (
                        dia, provider, operation, model,
                        requests, errors, input_tokens, output_tokens, characters,
                        rate_limited
                    ) VALUES (
                        :dia, :provider, :operation, :model,
                        :requests, :errors, :input_tokens, :output_tokens, :characters,
                        :rate_limited
                    )
                    ON CONFLICT (dia, provider, operation, model) DO UPDATE SET
                        requests = api_usage.requests + EXCLUDED.requests,
                        errors = api_usage.errors + EXCLUDED.errors,
                        input_tokens = api_usage.input_tokens + EXCLUDED.input_tokens,
                        output_tokens = api_usage.output_tokens + EXCLUDED.output_tokens,
                        characters = api_usage.characters + EXCLUDED.characters,
                        rate_limited = api_usage.rate_limited + EXCLUDED.rate_limited,
                        updated_at = NOW()
                """),
                {
                    "dia": dia,
                    "provider": provider[:30],
                    "operation": operation[:30],
                    "model": model[:120],
                    "requests": requests,
                    "errors": errors,
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "characters": characters,
                    "rate_limited": rate_limited,
                },
            )
    except Exception as e:  # noqa: BLE001 - métrica nunca derruba o atendimento
        log.warning("registrar_uso_falhou", provider=provider, error=str(e)[:200])


async def consultar_uso(dias: int = 7) -> Dict[str, Any]:
    """Retorna totais de hoje por modelo e a série diária dos últimos dias."""
    dias = max(1, min(int(dias or 7), 90))
    hoje = dia_local()
    inicio = hoje - timedelta(days=dias - 1)

    async with get_admin_session() as session:
        await _garantir_tabela(session)
        resultado = await session.execute(
            text("""
                SELECT dia, provider, operation, model,
                       SUM(requests) AS requests,
                       SUM(errors) AS errors,
                       SUM(input_tokens) AS input_tokens,
                       SUM(output_tokens) AS output_tokens,
                       SUM(characters) AS characters,
                       SUM(rate_limited) AS rate_limited
                FROM api_usage
                WHERE dia BETWEEN :inicio AND :hoje
                GROUP BY dia, provider, operation, model
                ORDER BY dia DESC, provider, operation, model
            """),
            {"inicio": inicio, "hoje": hoje},
        )
        rows = resultado.fetchall()

    por_dia: Dict[date, Dict[str, int]] = {}
    modelos: List[Dict[str, Any]] = []
    for row in rows:
        dia = row.dia
        if dia not in por_dia:
            por_dia[dia] = {"requests": 0, "errors": 0}
        por_dia[dia]["requests"] += int(row.requests or 0)
        por_dia[dia]["errors"] += int(row.errors or 0)

        if dia == hoje:
            modelos.append(
                {
                    "provider": row.provider,
                    "operation": row.operation,
                    "model": row.model,
                    "requests": int(row.requests or 0),
                    "errors": int(row.errors or 0),
                    "input_tokens": int(row.input_tokens or 0),
                    "output_tokens": int(row.output_tokens or 0),
                    "characters": int(row.characters or 0),
                    "rate_limited": int(row.rate_limited or 0),
                }
            )

    historico = [
        {"dia": (inicio + timedelta(days=i)).isoformat(), **por_dia.get(inicio + timedelta(days=i), {"requests": 0, "errors": 0})}
        for i in range(dias)
    ]

    return {
        "dia": hoje.isoformat(),
        "modelos": modelos,
        "historico": historico,
        "totais": {
            "requests": sum(m["requests"] for m in modelos),
            "errors": sum(m["errors"] for m in modelos),
            "input_tokens": sum(m["input_tokens"] for m in modelos),
            "output_tokens": sum(m["output_tokens"] for m in modelos),
        },
    }
