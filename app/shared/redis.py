"""
Módulo Redis: fila (ARQ), cache e locks distribuídos.
"""
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


class ConversaLock:
    """
    Lock distribuído por conversa (tenant:corretor).
    Impede que duas mensagens da mesma conversa sejam processadas em paralelo.
    """

    def __init__(self, tenant_id: str, corretor_id: str, ttl: int = 120):
        self._redis = get_redis_pool()
        self._key = f"lock:conv:{tenant_id}:{corretor_id}"
        self._ttl = ttl

    async def acquire(self) -> bool:
        """Tenta adquirir o lock. Retorna True se conseguiu."""
        return await self._redis.set(self._key, "1", nx=True, ex=self._ttl)

    async def release(self) -> None:
        await self._redis.delete(self._key)

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
