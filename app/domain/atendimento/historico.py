"""
Importação incremental das conversas do WhatsApp pessoal do corretor.

Ao conectar, o WhatsApp sincroniza o histórico com a Evolution, mas não manda
webhook dessas mensagens; e as que chegam entre o pareamento e a verificação
do número são descartadas. Este job busca na Evolution o que ainda não foi
importado (limitado aos últimos dias), reaproveitando a mesma ingestão.
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List
from uuid import UUID

import httpx
import structlog
from sqlalchemy.sql import text

from app.domain.atendimento.ingestao import agendar_analise, ingerir_mensagem_atendimento
from app.shared.config import get_settings
from app.shared.database import get_admin_session, get_session

log = structlog.get_logger()
settings = get_settings()

DIAS_HISTORICO = 3
MAX_PAGINAS = 30  # grupos ocupam a maior parte das páginas
POR_PAGINA = 100
MAX_ANALISES_POR_IMPORTACAO = 30


async def _paginas_evolution(instance_id: str, desde: datetime) -> List[Dict[str, Any]]:
    """Mensagens mais novas que `desde`, da mais recente para a mais antiga."""
    url = f"{settings.evolution_base_url.rstrip('/')}/chat/findMessages/{instance_id}"
    corte = int(desde.timestamp())
    registros: List[Dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=30) as client:
        for pagina in range(1, MAX_PAGINAS + 1):
            resp = await client.post(
                url,
                headers={"apikey": settings.evolution_api_key},
                json={"where": {}, "page": pagina, "offset": POR_PAGINA},
            )
            if resp.status_code not in (200, 201):
                log.warning("historico_evolution_falhou", status=resp.status_code)
                break
            corpo = resp.json() or {}
            dados = corpo.get("messages") if isinstance(corpo, dict) else None
            lote = (dados or {}).get("records") or []
            novos = [r for r in lote if int(r.get("messageTimestamp") or 0) >= corte]
            registros.extend(novos)
            # Páginas vêm da mais nova para a mais antiga: passou do corte, para.
            if len(novos) < len(lote) or pagina >= int((dados or {}).get("pages") or 1):
                break
    return registros


async def importar_historico(tenant_id: UUID, corretor_id: UUID, instance_id: str, desde: datetime) -> int:
    """Importa o que falta e agenda a análise das conversas tocadas. Devolve quantas mensagens entraram."""
    registros = await _paginas_evolution(instance_id, desde)
    importadas = 0
    atendimentos: Dict[str, int] = {}
    # Do mais antigo para o mais recente, como teriam chegado.
    for registro in sorted(registros, key=lambda r: int(r.get("messageTimestamp") or 0)):
        atendimento_id = await ingerir_mensagem_atendimento(tenant_id, corretor_id, registro, agendar=False)
        if atendimento_id:
            importadas += 1
            atendimentos[atendimento_id] = int(registro.get("messageTimestamp") or 0)

    # Analisa primeiro as conversas mais recentes, com teto para não esgotar a cota da IA.
    recentes = sorted(atendimentos.items(), key=lambda kv: kv[1], reverse=True)[:MAX_ANALISES_POR_IMPORTACAO]
    for i, (atendimento_id, _) in enumerate(recentes):
        await agendar_analise(tenant_id, corretor_id, atendimento_id, 30 + i * 10)
    if importadas:
        log.info("historico_importado", tenant_id=str(tenant_id)[:8], mensagens=importadas, atendimentos=len(atendimentos))
    return importadas


async def importar_pendentes() -> None:
    """Para cada número pessoal conectado, importa desde a última importação (ou os últimos dias)."""
    async with get_admin_session() as session:
        rows = await session.execute(
            text("""
                SELECT ws.id, ws.tenant_id, ws.corretor_id, ws.instance_id, ws.historico_importado_ate
                FROM whatsapp_sessions ws
                JOIN corretores c ON c.id = ws.corretor_id AND c.status = 'active'
                WHERE ws.tipo = 'corretor' AND ws.status = 'connected'
            """)
        )
        sessoes = rows.fetchall()

    limite = datetime.now(timezone.utc) - timedelta(days=DIAS_HISTORICO)
    for s in sessoes:
        inicio = datetime.now(timezone.utc)
        # Margem de 2 min: mensagens com horário próximo do último corte.
        desde = max(limite, (s.historico_importado_ate or limite) - timedelta(minutes=2))
        try:
            await importar_historico(s.tenant_id, s.corretor_id, s.instance_id, desde)
        except Exception as e:  # noqa: BLE001 - tenta de novo no próximo ciclo
            log.warning("historico_importacao_falhou", error=str(e)[:200])
            continue
        async with get_session(s.tenant_id) as session:
            await session.execute(
                text("UPDATE whatsapp_sessions SET historico_importado_ate = :ate WHERE id = :id"),
                {"ate": inicio, "id": str(s.id)},
            )
