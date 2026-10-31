"""Modelos de book de imóveis (Configurações) e prévia em PDF."""
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from app.api.middleware.auth import require_admin
from app.domain.book import config as cfg
from app.domain.book.modelos import ModelosBook
from app.domain.book.servico import BookErro, codigos_de_exemplo, gerar_book
from app.shared.database import get_session

router = APIRouter()


class ModeloEntrada(BaseModel):
    nome: str = Field(min_length=1, max_length=80)
    config: Dict[str, Any] = Field(default_factory=dict)
    copiar_de: Optional[UUID] = None


class PreviaEntrada(BaseModel):
    config: Dict[str, Any] = Field(default_factory=dict)
    modelo_id: Optional[UUID] = None
    codigos: List[int] = Field(default_factory=list, max_length=12)


def _erro(e: Exception) -> HTTPException:
    return HTTPException(status_code=400, detail=str(e))


@router.get("/modelos", summary="Modelos de book da imobiliária")
async def listar(admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        return {"modelos": await ModelosBook(s).listar(admin.tenant_id), "layouts": cfg.LAYOUTS, "padrao_config": cfg.PADRAO}


@router.post("/modelos", status_code=201, summary="Cria um modelo de book")
async def criar(body: ModeloEntrada, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        try:
            return await ModelosBook(s).criar(admin.tenant_id, body.nome, body.config, body.copiar_de)
        except cfg.ConfigErro as e:
            raise _erro(e)


@router.put("/modelos/{modelo_id}", summary="Edita um modelo de book")
async def atualizar(modelo_id: UUID, body: ModeloEntrada, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        try:
            return await ModelosBook(s).atualizar(admin.tenant_id, modelo_id, body.nome, body.config)
        except cfg.ConfigErro as e:
            raise _erro(e)


@router.post("/modelos/{modelo_id}/padrao", summary="Define o modelo padrão (agente e ações rápidas)")
async def padrao(modelo_id: UUID, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        try:
            await ModelosBook(s).definir_padrao(admin.tenant_id, modelo_id)
        except cfg.ConfigErro as e:
            raise _erro(e)
        return {"ok": True}


@router.delete("/modelos/{modelo_id}", summary="Exclui um modelo (não vale para o padrão nem os de fábrica)")
async def excluir(modelo_id: UUID, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        try:
            await ModelosBook(s).excluir(admin.tenant_id, modelo_id)
        except cfg.ConfigErro as e:
            raise _erro(e)
        return {"ok": True}


@router.post("/previa", summary="Prévia em PDF com imóveis reais da carteira")
async def previa(body: PreviaEntrada, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        try:
            codigos = body.codigos or await codigos_de_exemplo(s, admin.tenant_id)
            r = await gerar_book(s, admin.tenant_id, codigos, body.modelo_id, None, None, body.config)
        except (cfg.ConfigErro, BookErro) as e:
            raise _erro(e)
    return Response(r["pdf"], media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{r["arquivo"]}"'})
