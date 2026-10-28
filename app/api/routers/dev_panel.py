"""
Painel do Desenvolvedor — operação global da plataforma.
Acesso: apenas o papel 'developer' (verificado em CADA requisição no servidor).

Permissões do desenvolvedor:
- Cria, suspende e remove tenants
- Provisiona número e sessão WhatsApp
- Configura credenciais do Imoview
- Acessa métricas e logs de todos os tenants (SEM conteúdo de conversa)
"""
from typing import List, Optional
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator

from app.api.middleware.auth import require_developer
from app.domain.tenant.service import TenantService
from app.shared.database import get_admin_session

router = APIRouter()
log = structlog.get_logger()


# --- Schemas de entrada/saída ---

class CriarTenantRequest(BaseModel):
    nome: str
    slug: str                     # subdomínio
    numero_whatsapp: str          # número do agente em formato livre
    imoview_base_url: str
    imoview_chave: str            # cifrada antes de persistir
    ollama_model: Optional[str] = "llama3.1:8b-instruct-q4_K_M"

    @field_validator("slug")
    @classmethod
    def slug_format(cls, v: str) -> str:
        import re
        if not re.match(r"^[a-z0-9-]{3,63}$", v):
            raise ValueError("slug deve ter 3-63 chars: letras minúsculas, números e hífen")
        return v


class TenantResponse(BaseModel):
    id: UUID
    nome: str
    slug: str
    status: str
    numero_whatsapp: Optional[str] = None
    ollama_model: str


class SuspenderTenantRequest(BaseModel):
    motivo: str


# --- Endpoints ---

@router.post(
    "/tenants",
    response_model=TenantResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Cria um novo tenant (imobiliária)",
)
async def criar_tenant(
    body: CriarTenantRequest,
    dev=Depends(require_developer),
):
    """
    Cria tenant, provisiona instância WhatsApp no Evolution API e
    armazena credenciais Imoview cifradas com AES-256-GCM.
    """
    async with get_admin_session() as session:
        service = TenantService(session)
        try:
            tenant = await service.criar_tenant(
                nome=body.nome,
                slug=body.slug,
                numero_whatsapp=body.numero_whatsapp,
                imoview_base_url=body.imoview_base_url,
                imoview_chave=body.imoview_chave,
                ollama_model=body.ollama_model,
                criado_por=dev.sub,
            )
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))

    log.info("tenant_criado", slug=body.slug, criado_por=dev.sub)
    return TenantResponse(
        id=tenant.id,
        nome=tenant.nome,
        slug=tenant.slug,
        status=tenant.status,
        ollama_model=tenant.ollama_model,
    )


@router.get(
    "/tenants",
    response_model=List[TenantResponse],
    summary="Lista todos os tenants",
)
async def listar_tenants(dev=Depends(require_developer)):
    async with get_admin_session() as session:
        service = TenantService(session)
        tenants = await service.listar_todos()
    return [
        TenantResponse(
            id=t.id, nome=t.nome, slug=t.slug,
            status=t.status, ollama_model=t.ollama_model,
        )
        for t in tenants
    ]


@router.patch(
    "/tenants/{tenant_id}/suspender",
    summary="Suspende um tenant",
)
async def suspender_tenant(
    tenant_id: UUID,
    body: SuspenderTenantRequest,
    dev=Depends(require_developer),
):
    async with get_admin_session() as session:
        service = TenantService(session)
        await service.suspender(tenant_id, motivo=body.motivo)
    log.info("tenant_suspenso", tenant_id=str(tenant_id), por=dev.sub)
    return {"status": "suspended"}


@router.delete(
    "/tenants/{tenant_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove um tenant permanentemente",
)
async def remover_tenant(
    tenant_id: UUID,
    dev=Depends(require_developer),
):
    async with get_admin_session() as session:
        service = TenantService(session)
        await service.remover(tenant_id)
    log.warning("tenant_removido", tenant_id=str(tenant_id), por=dev.sub)


@router.get(
    "/tenants/{tenant_id}/metrics",
    summary="Métricas do tenant (sem conteúdo de conversa)",
)
async def metricas_tenant(
    tenant_id: UUID,
    dev=Depends(require_developer),
):
    """
    Retorna métricas operacionais sem conteúdo de conversa.
    Acesso ao conteúdo exige justificativa separada (LGPD).
    """
    async with get_admin_session() as session:
        service = TenantService(session)
        return await service.metricas(tenant_id)
