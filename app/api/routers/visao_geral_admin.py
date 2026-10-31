"""Visão Geral do portal da imobiliária."""
from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.middleware.auth import require_admin, require_portal
from app.domain.visao_geral.meu import MeuPainel
from app.domain.visao_geral.service import VisaoGeralService
from app.shared.database import get_session

router = APIRouter()


@router.get("", summary="Indicadores de gestão no período (7, 30, 90 ou 365 dias)")
async def visao_geral(dias: int = Query(30, ge=1, le=366), admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as session:
        return await VisaoGeralService(session, admin.tenant_id).gerar(dias)


@router.get("/meu", summary="Painel pessoal do corretor: carteira, funil, agenda e o que pede atenção")
async def meu_painel(dias: int = Query(30, ge=1, le=366), admin=Depends(require_portal)):
    if not admin.escopo:
        raise HTTPException(status_code=404)  # a gestão usa a Visão Geral completa
    async with get_session(admin.tenant_id) as session:
        return await MeuPainel(session, admin.tenant_id, admin.escopo).gerar(dias)
