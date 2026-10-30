"""
Módulo Redis: fila (ARQ), cache e locks distribuídos.
"""
import uuid
from functools import lru_cache
from typing import Optional
import redis.asyncio as aioredis
from app.shared.config import get_settings

settings = get_settings()


@lru_cache
def get_redis_pool() -> aioredis.Redis:
    return aioredis.from_url(
        settings.redis_url,
        encoding="utf-8",
        decode_responses=True,
        max_connections=50,
    )


_RELEASE_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
end
return 0
"""


class ConversaLock:
    """
    Lock distribuído por conversa (tenant:corretor).
    Impede que duas mensagens da mesma conversa sejam processadas em paralelo.
    """

    # Áudio = download + Whisper (modelo frio leva ~1 min) + IA + TTS local;
    # 120s expirava no meio do processamento e liberava a conversa em paralelo.
    # `escopo` separa trabalhos longos de segundo plano (análise de atendimento,
    # com Whisper em CPU) do chat com o agente, para que não segurem a resposta.
    def __init__(self, tenant_id: str, corretor_id: str, ttl: int = 600, escopo: str = ""):
        self._redis = get_redis_pool()
        sufixo = f":{escopo}" if escopo else ""
        self._key = f"lock:conv:{tenant_id}:{corretor_id}{sufixo}"
        self._ttl = ttl
        self._token = uuid.uuid4().hex

    async def acquire(self) -> bool:
        """Tenta adquirir o lock. Retorna True se conseguiu."""
        return await self._redis.set(self._key, self._token, nx=True, ex=self._ttl)

    async def release(self) -> None:
        # Só remove se o lock ainda for nosso (pode ter expirado e sido
        # adquirido por outro job da mesma conversa).
        await self._redis.eval(_RELEASE_SCRIPT, 1, self._key, self._token)

    async def __aenter__(self):
        acquired = await self.acquire()
        if not acquired:
            raise LockNotAcquiredError(self._key)
        return self

    async def __aexit__(self, *_):
        await self.release()


class LockNotAcquiredError(Exception):
    pass


class Cache:
    """Wrapper de cache com TTL, prefixado por tenant."""

    def __init__(self, tenant_id: str):
        self._redis = get_redis_pool()
        self._prefix = f"cache:{tenant_id}"

    async def get(self, key: str) -> Optional[str]:
        return await self._redis.get(f"{self._prefix}:{key}")

    async def set(self, key: str, value: str, ttl: int) -> None:
        await self._redis.set(f"{self._prefix}:{key}", value, ex=ttl)

    async def delete(self, key: str) -> None:
        await self._redis.delete(f"{self._prefix}:{key}")
