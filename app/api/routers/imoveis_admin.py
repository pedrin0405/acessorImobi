"""Página "Imóveis" do portal: consulta rápida ao cache local dos imóveis do Imoview."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.middleware.auth import require_admin, require_portal
from app.domain.imovel import consulta
from app.domain.imovel.sync import carregar_credenciais, obter_status
from app.shared.database import get_session

router = APIRouter()


@router.get("", summary="Lista os imóveis do cache com busca, filtros, ordenação e facetas")
async def listar(
    busca: Optional[str] = Query(None, max_length=80),
    finalidade: Optional[str] = Query(None, pattern="^(aluguel|venda)$"),
    tipo: Optional[str] = Query(None, max_length=400),
    bairro: Optional[str] = Query(None, max_length=800),
    cidade: Optional[str] = Query(None, max_length=400),
    quartos_min: Optional[int] = Query(None, ge=0, le=50),
    vagas_min: Optional[int] = Query(None, ge=0, le=50),
    banheiros_min: Optional[int] = Query(None, ge=0, le=50),
    valor_min: Optional[float] = Query(None, ge=0),
    valor_max: Optional[float] = Query(None, ge=0),
    area_min: Optional[float] = Query(None, ge=0),
    area_max: Optional[float] = Query(None, ge=0),
    destaque: bool = False,
    incluir_inativos: bool = False,
    ordem: str = Query("recentes", pattern="^(recentes|valor_asc|valor_desc|area_desc|codigo_desc)$"),
    pagina: int = Query(1, ge=1, le=10000),
    por_pagina: int = Query(consulta.POR_PAGINA_PADRAO, ge=1, le=consulta.POR_PAGINA_MAX),
    facetas: bool = True,
    admin=Depends(require_portal),
):
    filtros = {
        "busca": busca, "finalidade": finalidade, "tipo": tipo, "bairro": bairro, "cidade": cidade,
        "quartos_min": quartos_min, "vagas_min": vagas_min, "banheiros_min": banheiros_min,
        "valor_min": valor_min, "valor_max": valor_max, "area_min": area_min, "area_max": area_max,
        "destaque": destaque, "incluir_inativos": incluir_inativos,
    }
    async with get_session(admin.tenant_id) as session:
        resposta = await consulta.listar(session, admin.tenant_id, filtros, ordem, pagina, por_pagina, facetas)
        creds = await carregar_credenciais(admin.tenant_id)
        resposta["integracao"] = {
            "configurada": bool(creds and creds.get("chave")),
            "sincronizacao": await obter_status(session, admin.tenant_id),
        }
    return resposta


@router.get("/{codigo}", summary="Detalhe de um imóvel (completa do Imoview se faltar descrição ou fotos)")
async def detalhe(codigo: int, admin=Depends(require_portal)):
    async with get_session(admin.tenant_id) as session:
        imovel = await consulta.obter_detalhe(session, admin.tenant_id, codigo)
    if not imovel:
        raise HTTPException(status_code=404, detail="Imóvel não encontrado.")
    return imovel
