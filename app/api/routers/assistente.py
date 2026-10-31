"""
Assistente de IA do Início do portal da imobiliária ("Pergunte ao Acessor").

Cada administrador vê só as próprias conversas.
"""
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from app.api.middleware.auth import require_portal
from app.domain.assistente.service import AssistenteErro, AssistenteService
from app.shared.database import get_session

router = APIRouter()


class AnexoEntrada(BaseModel):
    nome: str = Field(max_length=120)
    mime: str = Field(max_length=100)
    dados: str  # base64; o limite de tamanho é validado no serviço


class MensagemEntrada(BaseModel):
    texto: str = Field(default="", max_length=8000)
    anexos: List[AnexoEntrada] = []


class ConversaCriar(BaseModel):
    titulo: Optional[str] = Field(default=None, max_length=120)


def _http(e: AssistenteErro) -> HTTPException:
    return HTTPException(status_code=e.status, detail=str(e))


@router.get("/conversas", summary="Conversas do administrador com o assistente (mais recentes primeiro)")
async def listar(q: Optional[str] = Query(None, max_length=100), admin=Depends(require_portal)):
    async with get_session(admin.tenant_id) as session:
        return await AssistenteService(session, admin.tenant_id, admin.admin_id, admin.escopo).listar(q)


@router.post("/conversas", status_code=status.HTTP_201_CREATED, summary="Inicia uma conversa")
async def criar(body: ConversaCriar, admin=Depends(require_portal)):
    async with get_session(admin.tenant_id) as session:
        servico = AssistenteService(session, admin.tenant_id, admin.admin_id, admin.escopo)
        return await (servico.criar(body.titulo) if body.titulo else servico.criar())


@router.get("/conversas/{conversa_id}", summary="Mensagens de uma conversa")
async def mensagens(conversa_id: UUID, admin=Depends(require_portal)):
    async with get_session(admin.tenant_id) as session:
        try:
            return await AssistenteService(session, admin.tenant_id, admin.admin_id, admin.escopo).mensagens(conversa_id)
        except AssistenteErro as e:
            raise _http(e)


@router.delete("/conversas/{conversa_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Apaga uma conversa")
async def excluir(conversa_id: UUID, admin=Depends(require_portal)):
    async with get_session(admin.tenant_id) as session:
        try:
            await AssistenteService(session, admin.tenant_id, admin.admin_id, admin.escopo).excluir(conversa_id)
        except AssistenteErro as e:
            raise _http(e)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/conversas/{conversa_id}/mensagens", summary="Envia uma pergunta e recebe a resposta da IA")
async def perguntar(conversa_id: UUID, body: MensagemEntrada, admin=Depends(require_portal)):
    async with get_session(admin.tenant_id) as session:
        try:
            return await AssistenteService(session, admin.tenant_id, admin.admin_id, admin.escopo).responder(
                conversa_id, body.texto, [a.model_dump() for a in body.anexos]
            )
        except AssistenteErro as e:
            raise _http(e)


@router.get("/mensagens/{mensagem_id}/book", summary="PDF do book gerado numa resposta do assistente")
async def book_da_mensagem(mensagem_id: UUID, admin=Depends(require_portal)):
    async with get_session(admin.tenant_id) as session:
        arquivo = await AssistenteService(session, admin.tenant_id, admin.admin_id, admin.escopo).arquivo_do_book(mensagem_id)
    if not arquivo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book não encontrado.")
    dados, tipo, nome = arquivo
    return Response(dados, media_type=tipo, headers={"Content-Disposition": f'inline; filename="{nome}"', "Cache-Control": "private, max-age=3600"})
