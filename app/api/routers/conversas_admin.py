"""Ações do portal sobre a conversa de um corretor: ficha, envio pela equipe, notas e resumo."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.middleware.auth import require_admin
from app.domain.auditoria.service import AuditoriaService
from app.domain.conversa.portal import ConversaPortalService, PortalErro
from app.domain.corretor.service import CorretorService
from app.shared.database import get_session

router = APIRouter()


class TextoEntrada(BaseModel):
    texto: str = Field(default="", max_length=8000)


def _http(e: PortalErro) -> HTTPException:
    return HTTPException(status_code=e.status, detail=str(e))


async def _corretor(session, admin, corretor_id: UUID):
    corretor = await CorretorService(session).get_by_id(corretor_id, admin.tenant_id)
    if not corretor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Corretor não encontrado.")
    return corretor


@router.get("/conversas/{corretor_id}/detalhes", summary="Ficha do corretor: atendimento, carteira, agenda e ações do bot")
async def detalhes(corretor_id: UUID, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as session:
        corretor = await _corretor(session, admin, corretor_id)
        return await ConversaPortalService(session, admin.tenant_id).detalhes(corretor)


@router.post("/conversas/{corretor_id}/enviar", summary="Envia uma mensagem ao corretor pelo número do agente (intervenção da equipe)")
async def enviar(corretor_id: UUID, body: TextoEntrada, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as session:
        corretor = await _corretor(session, admin, corretor_id)
        try:
            mensagem = await ConversaPortalService(session, admin.tenant_id).enviar_humano(corretor, body.texto, admin.sub)
        except PortalErro as e:
            raise _http(e)
        await AuditoriaService(session).registrar(
            tenant_id=admin.tenant_id, corretor_id=corretor.id, acao="enviar_mensagem_portal",
            entidade="mensagem", entidade_id=mensagem["id"], origem="portal",
        )
        return mensagem


@router.post("/conversas/{corretor_id}/notas", status_code=status.HTTP_201_CREATED, summary="Nota interna da equipe (não é enviada ao corretor)")
async def nota(corretor_id: UUID, body: TextoEntrada, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as session:
        corretor = await _corretor(session, admin, corretor_id)
        try:
            return await ConversaPortalService(session, admin.tenant_id).criar_nota(corretor.id, body.texto, admin.sub)
        except PortalErro as e:
            raise _http(e)


@router.post("/conversas/{corretor_id}/resumo", summary="Resumo da conversa feito pela IA")
async def resumo(corretor_id: UUID, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as session:
        corretor = await _corretor(session, admin, corretor_id)
        try:
            return {"resumo": await ConversaPortalService(session, admin.tenant_id).resumir(corretor.id)}
        except PortalErro as e:
            raise _http(e)
