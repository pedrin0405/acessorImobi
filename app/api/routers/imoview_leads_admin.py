"""Importação dos leads do Imoview para a carteira do portal (status, sincronização e modo automático)."""
from fastapi import APIRouter, Depends, HTTPException, status
from typing import Dict, Optional
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import text

from app.api.middleware.auth import require_admin
from app.domain.auditoria.service import AuditoriaService
from app.domain.crm import atendimentos_imoview as funil
from app.domain.crm import importacao_imoview as importacao
from app.domain.imovel.sync import carregar_credenciais
from app.shared.database import get_session

router = APIRouter()


class SincronizarEntrada(BaseModel):
    completo: bool = False  # True relê tudo (ou retoma de onde parou); False lê só o fim da lista


class AutomaticaEntrada(BaseModel):
    ligada: bool


@router.get("", summary="Estado da importação de leads do Imoview")
async def estado(admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        return await importacao.obter_status(s, admin.tenant_id)


@router.post("/sincronizar", summary="Pede a importação de leads (roda em segundo plano)")
async def sincronizar(body: SincronizarEntrada, admin=Depends(require_admin)):
    creds = await carregar_credenciais(admin.tenant_id)
    if not creds or not creds.get("chave"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Configure a integração com o Imoview antes de importar os leads.")
    resultado = await importacao.solicitar(admin.tenant_id, body.completo)
    async with get_session(admin.tenant_id) as s:
        await AuditoriaService(s).registrar(
            tenant_id=admin.tenant_id, corretor_id=None, acao="imoview_leads_sincronizar", entidade="tenant",
            origem="portal", payload_depois={"completo": body.completo},
        )
    return {"estado": resultado}


@router.put("/automatica", summary="Liga ou desliga a leitura automática de novos leads")
async def automatica(body: AutomaticaEntrada, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        await importacao.definir_automatica(s, admin.tenant_id, body.ligada)
        await AuditoriaService(s).registrar(
            tenant_id=admin.tenant_id, corretor_id=None, acao="imoview_leads_automatica", entidade="tenant",
            origem="portal", payload_depois={"ligada": body.ligada},
        )
    return {"automatica": body.ligada}


# --- Fases do CRM do Imoview espelhadas nas negociações -------------------------------------

class FunilEntrada(BaseModel):
    espelhar: bool
    fases: Dict[str, Optional[str]] = {}  # "1".."8" -> id da etapa do portal (ou vazio para não espelhar)
    automatica: Optional[bool] = None


@router.get("/funil", summary="Fases do Imoview, mapa para as etapas, andamento e alterações pendentes")
async def funil_estado(admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        return await funil.obter_status(s, admin.tenant_id)


@router.post("/funil/sincronizar", summary="Pede a leitura dos atendimentos do Imoview (segundo plano)")
async def funil_sincronizar(body: SincronizarEntrada, admin=Depends(require_admin)):
    creds = await carregar_credenciais(admin.tenant_id)
    if not creds or not creds.get("chave"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Configure a integração com o Imoview antes de ler os atendimentos.")
    resultado = await funil.solicitar(admin.tenant_id, body.completo)
    async with get_session(admin.tenant_id) as s:
        await AuditoriaService(s).registrar(
            tenant_id=admin.tenant_id, corretor_id=None, acao="imoview_funil_sincronizar", entidade="tenant",
            origem="portal", payload_depois={"completo": body.completo},
        )
    return {"estado": resultado}


@router.put("/funil", summary="Salva o mapa fase→etapa e liga/desliga o espelho")
async def funil_salvar(body: FunilEntrada, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        try:
            antes = funil.ler_config((await s.execute(text("SELECT dados FROM tenants WHERE id = :tid"), {"tid": str(admin.tenant_id)})).scalar())
            novo = await funil.salvar_config(s, admin.tenant_id, body.espelhar, body.fases, body.automatica)
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
        await AuditoriaService(s).registrar(
            tenant_id=admin.tenant_id, corretor_id=None, acao="imoview_funil_config", entidade="tenant",
            origem="portal", payload_depois={"espelhar": novo["espelhar"], "fases": novo["fases"]},
        )
    mudou = novo["espelhar"] and (not antes["espelhar"] or novo["fases"] != antes["fases"])
    resultado = await funil.aplicar(admin.tenant_id, forcar=True) if mudou else None  # ao ligar/alterar o mapa, alinha tudo já
    return {"config": novo, "aplicado": resultado}


@router.delete("/funil/pendencias/{pendencia_id}", summary="Descarta uma alteração que aguardava envio ao Imoview")
async def funil_descartar(pendencia_id: UUID, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        if not await funil.descartar_pendencia(s, admin.tenant_id, pendencia_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alteração não encontrada.")
    return {"ok": True}
