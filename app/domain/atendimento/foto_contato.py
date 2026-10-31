"""Foto e nome do contato (cliente) de um atendimento, vindos do WhatsApp do próprio corretor.

Mesma regra da foto do corretor: a URL da Evolution expira, então a imagem é baixada e guardada no MinIO;
sem foto/privacidade/erro nada muda e o portal mostra as iniciais. Nunca derruba a tela.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

import structlog
from sqlalchemy import text

from app.domain.corretor.foto import TIPOS, _baixar
from app.integration.whatsapp.evolution import EvolutionClient
from app.shared import storage
from app.shared.database import get_session

log = structlog.get_logger()

REVISAR_APOS = timedelta(days=3)


def url_da_foto(atendimento_id, foto_ref, foto_atualizada_em) -> Optional[str]:
    if not foto_ref or not foto_atualizada_em:
        return None
    return f"/corretor/atendimentos/{atendimento_id}/foto?v={int(foto_atualizada_em.timestamp())}"


async def sincronizar(tenant_id: UUID, corretor_id: UUID, atendimento_id: UUID, forcar: bool = False, evolution: Optional[EvolutionClient] = None) -> str:
    """Busca foto e nome. Devolve: atualizada | sem_foto | recente | sem_sessao | erro."""
    async with get_session(tenant_id) as s:
        at = (await s.execute(
            text("SELECT telefone_cliente, nome_contato, foto_tentada_em FROM atendimentos WHERE id = :id AND tenant_id = :tid AND corretor_id = :cid"),
            {"id": str(atendimento_id), "tid": str(tenant_id), "cid": str(corretor_id)})).first()
        ws = (await s.execute(
            text("SELECT instance_id FROM whatsapp_sessions WHERE corretor_id = :cid AND tipo = 'corretor' AND status = 'connected'"),
            {"cid": str(corretor_id)})).first()
    if not at:
        return "erro"
    if not ws:
        return "sem_sessao"
    if not forcar and at.foto_tentada_em and datetime.now(timezone.utc) - at.foto_tentada_em < REVISAR_APOS:
        return "recente"
    cliente = evolution or EvolutionClient()
    ref, nome, resultado = None, None, "sem_foto"
    try:
        link = await cliente.fetch_profile_picture_url(ws.instance_id, at.telefone_cliente)
        baixada = await _baixar(link) if link else None
        if baixada:
            dados, tipo = baixada
            ref = await storage.guardar_objeto(f"fotos/{tenant_id}/contatos/{atendimento_id}.{TIPOS[tipo]}", dados, tipo)
            resultado = "atualizada" if ref else "erro"
        if not at.nome_contato:
            contato = await cliente.find_contact(ws.instance_id, at.telefone_cliente)
            nome = (contato.get("pushName") or contato.get("name") or "").strip()[:255] or None
    except Exception as e:  # noqa: BLE001 - foto é enfeite
        log.warning("foto_contato_erro", erro=str(e)[:200])
        return "erro"
    async with get_session(tenant_id) as s:
        await s.execute(
            text("""UPDATE atendimentos SET foto_tentada_em = NOW(),
                        foto_ref = COALESCE(:ref, foto_ref), foto_atualizada_em = CASE WHEN :ref IS NULL THEN foto_atualizada_em ELSE NOW() END,
                        nome_contato = COALESCE(nome_contato, :nome)
                    WHERE id = :id"""),
            {"ref": ref, "nome": nome, "id": str(atendimento_id)})
    return resultado
