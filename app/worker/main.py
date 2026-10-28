"""
Worker — processamento de conversas.

Regras estruturais:
- É o ÚNICO componente que fala com o modelo de IA
- A API NUNCA chama IA diretamente
- Adquire lock da conversa antes de processar
- Lock não obtido → reagenda; nunca processa em paralelo
- Limite de concorrência por tenant
"""
import asyncio
import json
from typing import Dict

import structlog

from app.shared.config import get_settings
from app.shared.redis import get_redis_pool, ConversaLock, LockNotAcquiredError
from app.worker.pipeline import processar_conversa

settings = get_settings()
log = structlog.get_logger()

# Semáforo global de concorrência
_global_semaphore: asyncio.Semaphore = None
# Semáforos por tenant
_tenant_semaphores: Dict[str, asyncio.Semaphore] = {}


def _get_tenant_semaphore(tenant_id: str) -> asyncio.Semaphore:
    if tenant_id not in _tenant_semaphores:
        _tenant_semaphores[tenant_id] = asyncio.Semaphore(
            settings.worker_max_per_tenant
        )
    return _tenant_semaphores[tenant_id]


async def _process_job(job: dict) -> None:
    """Processa uma mensagem com lock distribuído e limite por tenant."""
    tenant_id = job["tenant_id"]
    corretor_id = job["corretor_id"]

    tenant_sem = _get_tenant_semaphore(tenant_id)
    lock = ConversaLock(tenant_id, corretor_id)

    try:
        async with tenant_sem:
            try:
                async with lock:
                    await processar_conversa(job)
            except LockNotAcquiredError:
                # Conversa já está sendo processada → recoloca na fila
                log.debug("lock_nao_obtido_reagendando", corretor_id=corretor_id[:8])
                redis = get_redis_pool()
                queue_key = f"queue:conversa:{tenant_id}:{corretor_id}"
                await redis.lpush(queue_key, json.dumps(job))  # volta pro início
                await asyncio.sleep(1)
    except Exception as e:
        log.error("job_falhou", error=str(e), job=job, exc_info=True)


async def worker_loop() -> None:
    """Loop principal: consome mensagens de todas as filas de conversa ativas."""
    redis = get_redis_pool()
    log.info("worker_iniciando", concorrencia=settings.worker_concurrency)

    pending_tasks = set()

    while True:
        # Limpa tarefas concluídas
        pending_tasks = {t for t in pending_tasks if not t.done()}

        if len(pending_tasks) >= settings.worker_concurrency:
            await asyncio.sleep(0.1)
            continue

        # Busca próxima conversa com mensagem pendente
        active_queues = await redis.smembers("queue:active_conversations")
        if not active_queues:
            await asyncio.sleep(0.5)
            continue

        for queue_key in active_queues:
            if len(pending_tasks) >= settings.worker_concurrency:
                break

            raw_job = await redis.lpop(queue_key)
            if not raw_job:
                # Fila vazia — remove do conjunto de ativas
                await redis.srem("queue:active_conversations", queue_key)
                continue

            job = json.loads(raw_job)
            task = asyncio.create_task(_process_job(job))
            pending_tasks.add(task)

        await asyncio.sleep(0.05)  # CPU yield


def main():
    import structlog
    structlog.configure(
        processors=[
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ]
    )
    asyncio.run(worker_loop())


if __name__ == "__main__":
    main()
