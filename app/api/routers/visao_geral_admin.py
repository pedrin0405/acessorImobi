"""Visão Geral do portal da imobiliária."""
from fastapi import APIRouter, Depends, Query

from app.api.middleware.auth import require_admin
from app.domain.visao_geral.service import VisaoGeralService
from app.shared.database import get_session

router = APIRouter()


@router.get("", summary="Indicadores de gestão no período (7, 30, 90 ou 365 dias)")
async def visao_geral(dias: int = Query(30, ge=1, le=366), admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as session:
        return await VisaoGeralService(session, admin.tenant_id).gerar(dias)
