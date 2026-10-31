"""Ações do portal sobre a conversa de um corretor: ficha, envio pela equipe, notas e resumo."""
from typing import List, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.sql import text

from app.api.middleware.auth import exigir_proprio, require_admin, require_portal
from app.domain.auditoria.service import AuditoriaService
from app.domain.conversa.portal import ConversaPortalService, PortalErro
from app.domain.corretor.service import CorretorService
from app.shared.database import get_session

router = APIRouter()


class TextoEntrada(BaseModel):
    texto: str = Field(default="", max_length=8000)


class AcaoRapida(BaseModel):
    tipo: Literal["imoveis", "lead", "book"]
    codigos: List[int] = Field(default_factory=list, max_length=12)
    modelo_id: Optional[UUID] = None
    titulo: str = Field(default="", max_length=80)
    lead_id: Optional[UUID] = None
    mensagem: str = Field(default="", max_length=1000)


def _http(e: PortalErro) -> HTTPException:
    return HTTPException(status_code=e.status, detail=str(e))


async def _lead_proprio(session, admin, lead_id):
    """Corretor só manda a ficha de cliente da própria carteira."""
    if not admin.escopo or not lead_id:
        return
    dono = (await session.execute(
        text("SELECT corretor_id FROM crm_leads WHERE id = :id AND tenant_id = :tid"),
        {"id": str(lead_id), "tid": str(admin.tenant_id)},
    )).first()
    if not dono or str(dono.corretor_id) != str(admin.escopo):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente não encontrado.")


async def _corretor(session, admin, corretor_id: UUID):
    corretor = await CorretorService(session).get_by_id(corretor_id, admin.tenant_id)
    if not corretor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Corretor não encontrado.")
    return corretor


@router.get("/conversas/{corretor_id}/detalhes", summary="Ficha do corretor: atendimento, carteira, agenda e ações do bot")
async def detalhes(corretor_id: UUID, admin=Depends(require_portal)):
    exigir_proprio(admin, corretor_id)
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


@router.post("/conversas/{corretor_id}/acoes-rapidas/previa", summary="Mostra o que a ação rápida enviará, sem enviar")
async def previa_acao(corretor_id: UUID, body: AcaoRapida, admin=Depends(require_portal)):
    exigir_proprio(admin, corretor_id)
    async with get_session(admin.tenant_id) as session:
        await _corretor(session, admin, corretor_id)
        await _lead_proprio(session, admin, body.lead_id)
        try:
            return {"mensagens": await ConversaPortalService(session, admin.tenant_id).montar_acao(body.tipo, body.codigos, body.lead_id, body.mensagem, body.modelo_id, body.titulo)}
        except PortalErro as e:
            raise _http(e)


@router.post("/conversas/{corretor_id}/acoes-rapidas/book-pdf", summary="PDF do book para conferir antes de enviar")
async def book_pdf(corretor_id: UUID, body: AcaoRapida, admin=Depends(require_portal)):
    exigir_proprio(admin, corretor_id)
    async with get_session(admin.tenant_id) as session:
        corretor = await _corretor(session, admin, corretor_id)
        try:
            book = await ConversaPortalService(session, admin.tenant_id).pdf_do_book(corretor, body.codigos, body.modelo_id, body.titulo)
        except PortalErro as e:
            raise _http(e)
    return Response(book["pdf"], media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{book["arquivo"]}"'})


@router.post("/conversas/{corretor_id}/acoes-rapidas/enviar", summary="Envia ao corretor imóveis da carteira ou a ficha de um lead")
async def enviar_acao(corretor_id: UUID, body: AcaoRapida, admin=Depends(require_portal)):
    exigir_proprio(admin, corretor_id)
    async with get_session(admin.tenant_id) as session:
        corretor = await _corretor(session, admin, corretor_id)
        await _lead_proprio(session, admin, body.lead_id)
        try:
            resultado = await ConversaPortalService(session, admin.tenant_id).enviar_acao(
                corretor, body.tipo, body.codigos, body.lead_id, body.mensagem, admin.sub, body.modelo_id, body.titulo,
            )
        except PortalErro as e:
            raise _http(e)
        await AuditoriaService(session).registrar(
            tenant_id=admin.tenant_id, corretor_id=corretor.id, acao=f"enviar_{body.tipo}_portal",
            entidade="mensagem", entidade_id=resultado["mensagens"][0]["id"], origem="portal",
        )
        return resultado


@router.post("/conversas/{corretor_id}/notas", status_code=status.HTTP_201_CREATED, summary="Nota interna da equipe (não é enviada ao corretor)")
async def nota(corretor_id: UUID, body: TextoEntrada, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as session:
        corretor = await _corretor(session, admin, corretor_id)
        try:
            return await ConversaPortalService(session, admin.tenant_id).criar_nota(corretor.id, body.texto, admin.sub)
        except PortalErro as e:
            raise _http(e)


@router.post("/conversas/{corretor_id}/resumo", summary="Resumo da conversa feito pela IA")
async def resumo(corretor_id: UUID, admin=Depends(require_portal)):
    exigir_proprio(admin, corretor_id)
    async with get_session(admin.tenant_id) as session:
        corretor = await _corretor(session, admin, corretor_id)
        try:
            return {"resumo": await ConversaPortalService(session, admin.tenant_id).resumir(corretor.id)}
        except PortalErro as e:
            raise _http(e)
