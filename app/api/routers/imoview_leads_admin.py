"""Importação dos leads do Imoview para a carteira do portal (status, sincronização e modo automático)."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.api.middleware.auth import require_admin
from app.domain.auditoria.service import AuditoriaService
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
