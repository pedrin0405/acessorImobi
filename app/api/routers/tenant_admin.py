"""
Portal da Imobiliária — administradores do tenant.

Permissões:
- Aprova e desativa corretores
- Configura persona e vocabulário do agente
- Consulta uso, auditoria e pendências de integração
- NÃO acessa conteúdo de conversa por padrão (se acessar, fica registrado)
"""
from typing import List, Optional
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.api.middleware.auth import require_admin
from app.domain.corretor.service import CorretorService
from app.domain.auditoria.service import AuditoriaService
from app.shared.database import get_session

router = APIRouter()
log = structlog.get_logger()


class AprovarCorretorRequest(BaseModel):
    aprovado: bool
    motivo: Optional[str] = None  # obrigatório em caso de recusa


class CorretorResponse(BaseModel):
    id: UUID
    nome: Optional[str]
    email: Optional[str]
    telefone_mascarado: str
    status: str
    created_at: str


class ConfigurarAgenteRequest(BaseModel):
    persona: str
    vocabulario_bairros: Optional[List[str]] = None
    vocabulario_tipos: Optional[List[str]] = None
    horario_inicio: Optional[str] = None
    horario_fim: Optional[str] = None


# --- Endpoints ---

@router.get(
    "/corretores",
    response_model=List[CorretorResponse],
    summary="Lista corretores do tenant",
)
async def listar_corretores(
    status_filter: Optional[str] = None,
    admin=Depends(require_admin),
):
    async with get_session(admin.tenant_id) as session:
        service = CorretorService(session)
        corretores = await service.listar(status=status_filter)

    return [
        CorretorResponse(
            id=c.id,
            nome=c.nome,
            email=c.email,
            telefone_mascarado=c.telefone[:3] + "***" + c.telefone[-2:],
            status=c.status,
            created_at=c.created_at.isoformat(),
        )
        for c in corretores
    ]


@router.patch(
    "/corretores/{corretor_id}/decisao",
    summary="Aprova ou recusa um corretor",
)
async def decidir_corretor(
    corretor_id: UUID,
    body: AprovarCorretorRequest,
    admin=Depends(require_admin),
):
    if not body.aprovado and not body.motivo:
        raise HTTPException(
            status_code=422,
            detail="Motivo é obrigatório ao recusar um corretor.",
        )

    async with get_session(admin.tenant_id) as session:
        service = CorretorService(session)
        corretor = await service.decidir(
            corretor_id=corretor_id,
            aprovado=body.aprovado,
            motivo=body.motivo,
            admin_id=admin.admin_id,
        )

    log.info(
        "corretor_decisao",
        corretor_id=str(corretor_id),
        aprovado=body.aprovado,
        admin=admin.sub,
    )
    return {"status": corretor.status}


@router.put(
    "/agente/configuracao",
    summary="Configura persona e vocabulário do agente",
)
async def configurar_agente(
    body: ConfigurarAgenteRequest,
    admin=Depends(require_admin),
):
    from app.domain.tenant.service import TenantService
    async with get_session(admin.tenant_id) as session:
        service = TenantService(session)
        await service.atualizar_agent_config(
            tenant_id=admin.tenant_id,
            config={
                "persona": body.persona,
                "vocabulario_bairros": body.vocabulario_bairros or [],
                "vocabulario_tipos": body.vocabulario_tipos or [],
            },
        )
    return {"status": "updated"}


@router.get(
    "/auditoria",
    summary="Consulta log de auditoria do tenant",
)
async def consultar_auditoria(
    page: int = 1,
    per_page: int = 50,
    corretor_id: Optional[UUID] = None,
    admin=Depends(require_admin),
):
    async with get_session(admin.tenant_id) as session:
        service = AuditoriaService(session)
        return await service.listar(
            page=page,
            per_page=per_page,
            corretor_id=corretor_id,
        )


@router.get(
    "/pendencias",
    summary="Lista pendências de integração com o Imoview",
)
async def listar_pendencias(admin=Depends(require_admin)):
    from app.domain.cliente.service import ClienteService
    async with get_session(admin.tenant_id) as session:
        service = ClienteService(session)
        return await service.listar_pendencias()
