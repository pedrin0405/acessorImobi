"""
Portal da Imobiliária — CRM da equipe (carteira, funil e agenda).

Os corretores alimentam o CRM falando com o agente pelo WhatsApp; aqui a
imobiliária acompanha o funil, a previsão e a agenda, e ajusta as etapas.
"""
from datetime import date, datetime, timedelta
from typing import List, Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.sql import text

from app.api.middleware.auth import require_admin
from app.domain.auditoria.service import AuditoriaService
from app.domain.crm.acoes import lead_por_nome
from app.domain.crm.service import ROTULO_TIPO, CrmError, CrmService
from app.shared.database import get_session

router = APIRouter()


class EtapaUpdate(BaseModel):
    id: UUID
    probabilidade: int = Field(ge=0, le=100)
    alerta_dias: Optional[int] = Field(default=None, ge=1)


class NegocioUpdate(BaseModel):
    etapa: Optional[str] = None
    status: Optional[str] = Field(default=None, pattern="^(aberto|ganho|perdido)$")
    motivo_perda: Optional[str] = None
    valor: Optional[float] = Field(default=None, ge=0)


class NegocioCreate(BaseModel):
    corretor_id: UUID
    cliente: str = Field(min_length=2, max_length=255)
    telefone: Optional[str] = None
    etapa: Optional[str] = None
    valor: float = Field(default=0, ge=0)
    fechamento_previsto: Optional[date] = None


class AtividadeCreate(BaseModel):
    corretor_id: UUID
    tipo: str = Field(pattern=r"^[a-z0-9_]{3,40}$")
    titulo: Optional[str] = Field(default=None, max_length=255)
    data: Optional[date] = None
    hora: Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    cliente: Optional[str] = None
    local: Optional[str] = Field(default=None, max_length=255)


class LeadCreate(BaseModel):
    nome: str = Field(min_length=2, max_length=255)
    corretor_id: Optional[UUID] = None  # vazio: a Roleta de leads escolhe (se estiver ligada)
    telefone: Optional[str] = Field(default=None, max_length=20)
    email: Optional[str] = Field(default=None, max_length=255)
    origem: Optional[str] = Field(default=None, max_length=40)
    observacoes: Optional[str] = Field(default=None, max_length=2000)
    temperatura: Optional[str] = Field(default=None, pattern="^(quente|morno|frio)$")


class FiltroClientes(BaseModel):
    termo: Optional[str] = Field(default=None, max_length=100)
    responsavel: Optional[str] = Field(default=None, max_length=36)  # 'sem' ou o id de um corretor
    origem: Optional[str] = Field(default=None, max_length=40)
    temperatura: Optional[str] = Field(default=None, pattern="^(quente|morno|frio)$")


class AtribuirClientes(BaseModel):
    corretor_id: Optional[UUID] = None
    roleta: bool = False  # distribui em rodízio entre os corretores da roleta
    ids: Optional[List[UUID]] = Field(default=None, max_length=1000)
    filtro: Optional[FiltroClientes] = None  # alternativa a `ids`: todos os que casam com o filtro (até 5.000)


class AtividadeUpdate(BaseModel):
    status: Optional[str] = Field(default=None, pattern="^(aberta|concluida|cancelada)$")


def _erro(e: CrmError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))


async def _corretor_ativo(session, tenant_id: UUID, corretor_id: UUID) -> None:
    row = await session.execute(
        text("SELECT 1 FROM corretores WHERE id = :cid AND tenant_id = :tid AND status = 'active'"),
        {"cid": str(corretor_id), "tid": str(tenant_id)},
    )
    if not row.first():
        raise HTTPException(status_code=422, detail="Escolha um corretor ativo da imobiliária.")


async def _fuso_tenant(session, tenant_id: UUID) -> ZoneInfo:
    row = await session.execute(text("SELECT fuso FROM tenants WHERE id = :tid"), {"tid": str(tenant_id)})
    return ZoneInfo(row.scalar() or "America/Sao_Paulo")


@router.get("/etapas", summary="Etapas do funil com probabilidade e alerta")
async def listar_etapas(admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as session:
        return await CrmService(session).etapas(admin.tenant_id)


@router.put("/etapas", summary="Atualiza probabilidade e alerta de dias das etapas")
async def atualizar_etapas(body: List[EtapaUpdate], admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as session:
        try:
            etapas = await CrmService(session).atualizar_etapas(
                admin.tenant_id, [e.model_dump() for e in body]
            )
        except CrmError as e:
            raise _erro(e)
        await AuditoriaService(session).registrar(
            tenant_id=admin.tenant_id, corretor_id=None, acao="crm_atualizar_etapas",
            entidade="crm_etapas", payload_depois={"etapas": [e.model_dump(mode="json") for e in body]},
            origem="portal",
        )
    return etapas


@router.get("/negocios", summary="Negócios do funil (padrão: abertos)")
async def listar_negocios(
    status_negocio: Optional[str] = Query("aberto", alias="status", pattern="^(aberto|ganho|perdido|todos)$"),
    corretor_id: Optional[UUID] = None,
    termo: Optional[str] = None,
    admin=Depends(require_admin),
):
    async with get_session(admin.tenant_id) as session:
        return await CrmService(session).listar_negocios(
            admin.tenant_id,
            corretor_id=corretor_id,
            status=None if status_negocio == "todos" else status_negocio,
            termo=termo,
        )


@router.post("/negocios", status_code=status.HTTP_201_CREATED, summary="Abre um negócio para um corretor")
async def criar_negocio(body: NegocioCreate, admin=Depends(require_admin)):
    """Usa o cliente da carteira do corretor com esse nome, ou cria um novo."""
    async with get_session(admin.tenant_id) as session:
        await _corretor_ativo(session, admin.tenant_id, body.corretor_id)
        crm = CrmService(session)
        try:
            lead = await crm.encontrar_lead(admin.tenant_id, body.corretor_id, body.cliente)
            if not lead:
                lead = await crm.criar_lead(
                    admin.tenant_id, body.corretor_id, nome=body.cliente,
                    telefone=body.telefone, origem="portal",
                )
            negocio = await crm.criar_negocio(
                admin.tenant_id, body.corretor_id, UUID(lead["id"]),
                etapa=body.etapa, valor=body.valor,
                fechamento_previsto=body.fechamento_previsto, autor="portal",
            )
        except CrmError as e:
            raise _erro(e)
        await AuditoriaService(session).registrar(
            tenant_id=admin.tenant_id, corretor_id=body.corretor_id, acao="crm_criar_negocio",
            entidade="negocio", entidade_id=str(negocio["id"]),
            payload_depois=body.model_dump(mode="json"), origem="portal",
        )
        return negocio


@router.get("/negocios/{negocio_id}", summary="Detalhe do negócio com histórico")
async def detalhe_negocio(negocio_id: UUID, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as session:
        crm = CrmService(session)
        negocio = await crm.get_negocio(admin.tenant_id, negocio_id)
        if not negocio:
            raise HTTPException(status_code=404, detail="Negócio não encontrado.")
        negocio["eventos"] = await crm.eventos(admin.tenant_id, negocio_id)
        return negocio


@router.patch("/negocios/{negocio_id}", summary="Move de etapa, ganha ou perde um negócio")
async def atualizar_negocio(negocio_id: UUID, body: NegocioUpdate, admin=Depends(require_admin)):
    if not body.etapa and not body.status and body.valor is None:
        raise HTTPException(status_code=422, detail="Informe a etapa, o status ou o valor.")
    async with get_session(admin.tenant_id) as session:
        crm = CrmService(session)
        atual = await crm.get_negocio(admin.tenant_id, negocio_id)
        if not atual:
            raise HTTPException(status_code=404, detail="Negócio não encontrado.")
        try:
            negocio = await crm.mover_negocio(
                admin.tenant_id, negocio_id,
                etapa=body.etapa or atual["etapa_nome"],
                status=body.status,
                motivo_perda=body.motivo_perda,
                valor=body.valor,
                autor="portal",
            )
        except CrmError as e:
            raise _erro(e)
        await AuditoriaService(session).registrar(
            tenant_id=admin.tenant_id, corretor_id=UUID(atual["corretor_id"]),
            acao="crm_mover_negocio", entidade="negocio", entidade_id=str(negocio_id),
            payload_antes={"etapa": atual["etapa_nome"], "status": atual["status"]},
            payload_depois=body.model_dump(exclude_none=True), origem="portal",
        )
        return negocio


@router.get("/forecast", summary="Previsão ponderada por etapa (valor × probabilidade)")
async def forecast(corretor_id: Optional[UUID] = None, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as session:
        return await CrmService(session).forecast(admin.tenant_id, corretor_id)


@router.get("/leads", summary="Carteira de clientes dos corretores")
async def listar_leads(
    termo: Optional[str] = None,
    corretor_id: Optional[UUID] = None,
    admin=Depends(require_admin),
):
    async with get_session(admin.tenant_id) as session:
        return await CrmService(session).listar_leads(
            admin.tenant_id, corretor_id=corretor_id, termo=termo, limit=500
        )


@router.post("/leads", status_code=status.HTTP_201_CREATED, summary="Cria um cliente; sem corretor, a Roleta de leads distribui")
async def criar_lead(body: LeadCreate, admin=Depends(require_admin)):
    from app.domain.configuracoes.service import ConfiguracoesService

    async with get_session(admin.tenant_id) as session:
        via_roleta = False
        corretor_id = body.corretor_id
        if corretor_id:
            await _corretor_ativo(session, admin.tenant_id, corretor_id)
        else:
            proximo = await ConfiguracoesService(session, admin.tenant_id).proximo_da_roleta()
            if not proximo:
                raise HTTPException(status_code=422, detail="Escolha o corretor responsável ou ligue a Roleta de leads em Configurações.")
            corretor_id, via_roleta = UUID(proximo), True
        try:
            lead = await CrmService(session).criar_lead(
                admin.tenant_id, corretor_id, nome=body.nome, telefone=body.telefone, email=body.email,
                observacoes=body.observacoes, origem=body.origem or "manual", temperatura=body.temperatura or "morno",
            )
        except CrmError as e:
            raise _erro(e)
        await AuditoriaService(session).registrar(
            tenant_id=admin.tenant_id, corretor_id=corretor_id, acao="crm_registrar_lead", entidade="lead",
            entidade_id=str(lead["id"]), origem="portal", payload_depois={"nome": body.nome, "roleta": via_roleta},
        )
        return {**lead, "via_roleta": via_roleta}


@router.get("/clientes", summary="Carteira inteira, paginada, com leads do Imoview e sem responsável")
async def listar_clientes(
    termo: Optional[str] = Query(None, max_length=100),
    responsavel: Optional[str] = Query(None, max_length=36),
    origem: Optional[str] = Query(None, max_length=40),
    temperatura: Optional[str] = Query(None, pattern="^(quente|morno|frio)$"),
    ordem: str = Query("recentes", pattern="^(recentes|atualizados|nome)$"),
    pagina: int = Query(1, ge=1),
    por_pagina: int = Query(25, ge=5, le=100),
    admin=Depends(require_admin),
):
    if responsavel and responsavel != "sem":
        try:
            UUID(responsavel)
        except ValueError:
            raise HTTPException(status_code=422, detail="Responsável inválido.")
    async with get_session(admin.tenant_id) as session:
        return await CrmService(session).listar_clientes(
            admin.tenant_id, termo, responsavel, origem, temperatura, ordem, pagina, por_pagina
        )


@router.post("/clientes/atribuir", summary="Atribui clientes a um corretor ou distribui pela roleta")
async def atribuir_clientes(body: AtribuirClientes, admin=Depends(require_admin)):
    from app.domain.configuracoes.service import ConfiguracoesService

    if bool(body.ids) == bool(body.filtro):
        raise HTTPException(status_code=422, detail="Escolha os clientes por lista ou por filtro (não os dois).")
    async with get_session(admin.tenant_id) as session:
        crm = CrmService(session)
        if body.roleta:
            config = ConfiguracoesService(session, admin.tenant_id)
            fila = await config.fila_da_roleta()
            if not fila:
                raise HTTPException(status_code=422, detail="Não há corretores ativos para distribuir.")
            corretores = [UUID(c) for c in fila]
        elif body.corretor_id:
            await _corretor_ativo(session, admin.tenant_id, body.corretor_id)
            corretores = [body.corretor_id]
        else:
            raise HTTPException(status_code=422, detail="Escolha o corretor ou use a roleta.")
        try:
            alteradas = await crm.atribuir_clientes(
                admin.tenant_id, corretores, ids=body.ids, filtro=body.filtro.model_dump() if body.filtro else None
            )
        except CrmError as e:
            raise _erro(e)
        if body.roleta and alteradas:
            await ConfiguracoesService(session, admin.tenant_id).gravar_ultimo_da_roleta(str(corretores[(alteradas - 1) % len(corretores)]))
        await AuditoriaService(session).registrar(
            tenant_id=admin.tenant_id, corretor_id=None, acao="crm_clientes_atribuidos", entidade="lead", origem="portal",
            payload_depois={"quantidade": alteradas, "roleta": body.roleta, "corretores": len(corretores)},
        )
        return {"atribuidos": alteradas}


@router.get("/leads/{lead_id}/match", summary="Imóveis que combinam com o perfil do lead")
async def match_lead(lead_id: UUID, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as session:
        crm = CrmService(session)
        lead = await crm.get_lead(admin.tenant_id, lead_id)
        if not lead:
            raise HTTPException(status_code=404, detail="Cliente não encontrado.")
        return await crm.match(admin.tenant_id, lead)


@router.get("/agenda", summary="Agenda da equipe: próximos dias, atrasadas e sem data")
async def agenda(
    dias: int = Query(30, ge=1, le=90),
    corretor_id: Optional[UUID] = None,
    admin=Depends(require_admin),
):
    async with get_session(admin.tenant_id) as session:
        fuso = await _fuso_tenant(session, admin.tenant_id)
        hoje = datetime.now(fuso).replace(hour=0, minute=0, second=0, microsecond=0)
        return await CrmService(session).agenda(
            admin.tenant_id, corretor_id, de=hoje, ate=hoje + timedelta(days=dias)
        )


@router.post("/atividades", status_code=status.HTTP_201_CREATED, summary="Agenda uma atividade para um corretor")
async def criar_atividade(body: AtividadeCreate, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as session:
        await _corretor_ativo(session, admin.tenant_id, body.corretor_id)
        crm = CrmService(session)
        fuso = await _fuso_tenant(session, admin.tenant_id)
        inicio = None
        if body.data:
            h, m = (int(x) for x in (body.hora or "09:00").split(":"))
            try:
                inicio = datetime(body.data.year, body.data.month, body.data.day, h, m, tzinfo=fuso)
            except ValueError:
                raise HTTPException(status_code=422, detail="Horário inválido.")
        lead = None
        if body.cliente and body.cliente.strip():
            lead = await lead_por_nome(crm, admin.tenant_id, body.corretor_id, body.cliente, criar=True)
        try:
            atividade = await crm.agendar(
                admin.tenant_id, body.corretor_id,
                titulo=body.titulo or (f"{ROTULO_TIPO[body.tipo]} com {lead['nome']}" if lead else ""),
                tipo=body.tipo,
                inicio=inicio,
                lead_id=UUID(lead["id"]) if lead else None,
                local=body.local,
            )
        except CrmError as e:
            raise _erro(e)
        await AuditoriaService(session).registrar(
            tenant_id=admin.tenant_id, corretor_id=body.corretor_id, acao="crm_agendar",
            entidade="atividade", entidade_id=str(atividade["id"]),
            payload_depois=body.model_dump(mode="json"), origem="portal",
        )
        return atividade


@router.patch("/atividades/{atividade_id}", summary="Conclui ou cancela uma atividade")
async def atualizar_atividade(atividade_id: UUID, body: AtividadeUpdate, admin=Depends(require_admin)):
    if not body.status:
        raise HTTPException(status_code=422, detail="Informe o status.")
    async with get_session(admin.tenant_id) as session:
        try:
            atividade = await CrmService(session).atualizar_atividade(
                admin.tenant_id, atividade_id, status=body.status
            )
        except CrmError as e:
            raise _erro(e)
        await AuditoriaService(session).registrar(
            tenant_id=admin.tenant_id, corretor_id=UUID(atividade["corretor_id"]),
            acao="crm_atualizar_atividade", entidade="atividade", entidade_id=str(atividade_id),
            payload_depois=body.model_dump(exclude_none=True), origem="portal",
        )
        return atividade
