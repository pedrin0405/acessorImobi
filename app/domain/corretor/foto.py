"""Foto do corretor = foto de perfil do WhatsApp dele.

A URL que a Evolution devolve expira em horas, então a imagem é baixada e guardada no MinIO.
Foto marcada como 'manual' nunca é sobrescrita. Sem foto/privacidade/erro: nada muda e o portal mostra as iniciais.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

import httpx
import structlog
from sqlalchemy import text

from app.integration.whatsapp.evolution import EvolutionClient
from app.shared import storage
from app.shared.database import get_admin_session, get_session

log = structlog.get_logger()

LIMITE_BYTES = 2 * 1024 * 1024
REVISAR_APOS = timedelta(hours=24)
TIPOS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


async def _baixar(url: str) -> Optional[tuple]:
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as c:
            resp = await c.get(url)
    except httpx.HTTPError:
        return None
    tipo = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
    if resp.status_code != 200 or tipo not in TIPOS or not resp.content or len(resp.content) > LIMITE_BYTES:
        return None
    return resp.content, tipo


async def sincronizar_foto(tenant_id: UUID, corretor_id: UUID, evolution: Optional[EvolutionClient] = None) -> str:
    """Busca e guarda a foto. Devolve: atualizada | sem_foto | manual | sem_sessao | erro."""
    async with get_session(tenant_id) as s:
        c = (await s.execute(
            text("SELECT telefone, foto_origem FROM corretores WHERE id = :id AND tenant_id = :tid"),
            {"id": str(corretor_id), "tid": str(tenant_id)},
        )).first()
        if not c:
            return "erro"
        if c.foto_origem == "manual":
            return "manual"
        sessao = (await s.execute(
            text("SELECT instance_id FROM whatsapp_sessions WHERE tenant_id = :tid AND tipo = 'agente' AND status = 'connected' LIMIT 1"),
            {"tid": str(tenant_id)},
        )).first()
    if not sessao:
        return "sem_sessao"  # sem WhatsApp do agente conectado não dá para consultar; tenta de novo no próximo ciclo

    try:
        link = await (evolution or EvolutionClient()).fetch_profile_picture_url(sessao.instance_id, c.telefone)
        baixada = await _baixar(link) if link else None
        resultado, ref = "sem_foto", None
        if baixada:
            dados, tipo = baixada
            ref = await storage.guardar_objeto(f"fotos/{tenant_id}/{corretor_id}.{TIPOS[tipo]}", dados, tipo)
            resultado = "atualizada" if ref else "erro"
    except Exception as e:  # noqa: BLE001 - foto é enfeite; nunca derruba cadastro nem job
        log.warning("foto_corretor_erro", erro=str(e)[:200])
        return "erro"

    async with get_session(tenant_id) as s:
        if ref:
            await s.execute(
                text("""UPDATE corretores SET foto_ref = :ref, foto_origem = 'whatsapp',
                        foto_atualizada_em = NOW(), foto_tentada_em = NOW()
                        WHERE id = :id AND foto_origem IS DISTINCT FROM 'manual'"""),
                {"ref": ref, "id": str(corretor_id)},
            )
        else:  # mantém a foto anterior (o contato pode ter ocultado a atual), só marca a tentativa
            await s.execute(text("UPDATE corretores SET foto_tentada_em = NOW() WHERE id = :id"), {"id": str(corretor_id)})
    return resultado


async def sincronizar_pendentes(evolution: Optional[EvolutionClient] = None) -> int:
    """Job: corretores ativos sem foto manual cuja foto nunca foi buscada ou tem mais de 24 h."""
    limite = datetime.now(timezone.utc) - REVISAR_APOS
    async with get_admin_session() as s:
        alvos = (await s.execute(
            text("""SELECT id, tenant_id FROM corretores
                    WHERE status = 'active' AND foto_origem IS DISTINCT FROM 'manual'
                      AND (foto_tentada_em IS NULL OR foto_tentada_em < :limite)
                    ORDER BY foto_tentada_em NULLS FIRST LIMIT 200"""),
            {"limite": limite},
        )).fetchall()
    atualizadas = 0
    for a in alvos:
        if await sincronizar_foto(a.tenant_id, a.id, evolution) == "atualizada":
            atualizadas += 1
    return atualizadas


def url_da_foto(corretor_id, foto_ref, foto_atualizada_em) -> Optional[str]:
    """Caminho autenticado da foto, com versão para o navegador renovar o cache."""
    if not foto_ref or not foto_atualizada_em:
        return None
    return f"/admin/corretores/{corretor_id}/foto?v={int(foto_atualizada_em.timestamp())}"
