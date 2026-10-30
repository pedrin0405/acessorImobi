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
    ollama_model: Optional[str] = "qwen3:8b"
    admin_email: Optional[str] = None        # administrador inicial da imobiliária
    admin_senha: Optional[str] = None        # senha do administrador inicial
    admin_nome: Optional[str] = None

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


class CriarAdminTenantRequest(BaseModel):
    nome: str
    email: str
    senha: str


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
                admin_email=body.admin_email,
                admin_senha=body.admin_senha,
                admin_nome=body.admin_nome,
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


@router.get(
    "/usage",
    summary="Consumo de APIs externas e limites diários",
)
async def consumo_apis(
    dias: int = 7,
    dev=Depends(require_developer),
):
    """
    Painel de consumo: totais por modelo do dia, histórico diário e o estado
    de cada limite.

    status:
    - ok: abaixo do limite de alerta
    - alerta: passou de USAGE_ALERT_PERCENT do limite diário ou por minuto
    - atingido: limite diário/por minuto alcançado, ou o provedor respondeu
      429 e as chamadas estão em pausa (o agente usa o fallback)
    - sem_limite: serviço local, sem cota
    """
    from app.domain.usage import consultar_uso, cooldown_restante, uso_tempo_real
    from app.shared.config import get_settings

    cfg = get_settings()
    dados = await consultar_uso(dias=dias)
    alerta = max(1, min(cfg.usage_alert_percent, 100)) / 100

    def _status(info: dict) -> str:
        if info["cooldown_segundos"] > 0:
            return "atingido"
        if info["limite"] <= 0 and info["rpm_limite"] <= 0:
            return "sem_limite"
        pares = [
            (info["usado"], info["limite"]),
            (info["rpm"], info["rpm_limite"]),
        ]
        if any(lim > 0 and uso >= lim for uso, lim in pares):
            return "atingido"
        if any(lim > 0 and uso >= lim * alerta for uso, lim in pares):
            return "alerta"
        return "ok"

    por_operacao: dict = {}
    for m in dados["modelos"]:
        agg = por_operacao.setdefault(
            m["operation"],
            {"requests": 0, "errors": 0, "rate_limited": 0, "tokens": 0, "por_provider": {}},
        )
        agg["requests"] += m["requests"]
        agg["errors"] += m["errors"]
        if m["provider"] == "gemini":
            agg["rate_limited"] += m.get("rate_limited", 0)
            agg["tokens"] += m["input_tokens"] + m["output_tokens"]
        agg["por_provider"][m["provider"]] = (
            agg["por_provider"].get(m["provider"], 0) + m["requests"]
        )

    # Os limites são do Gemini. O Qwen3 e o Whisper rodam localmente e não
    # consomem cota; ficam visíveis na lista de modelos, mas fora do limite.
    definicoes = {
        "chat": ("gemini", "chat", cfg.gemini_chat_daily_limit, cfg.gemini_chat_rpm_limit, cfg.gemini_model),
        "tts": ("gemini", "tts", cfg.gemini_tts_daily_limit, cfg.gemini_tts_rpm_limit, cfg.gemini_tts_model),
        "transcricao": ("whisper", "transcription", 0, 0, None),
    }
    limites = {}
    for chave, (provider, operacao, limite, rpm_limite, modelo) in definicoes.items():
        agg = por_operacao.get(operacao, {})
        tempo_real = await uso_tempo_real(provider, operacao)
        cooldown = await cooldown_restante(provider, f"{operacao}:{modelo}") if modelo else 0
        info = {
            "limite": limite,
            "usado": agg.get("por_provider", {}).get(provider, 0),
            "rpm_limite": rpm_limite,
            "rpm": tempo_real["rpm"],
            "erros": agg.get("errors", 0),
            "rate_limited": agg.get("rate_limited", 0),
            "tokens": agg.get("tokens", 0),
            "ultimo_429": tempo_real["ultimo_429"],
            "cooldown_segundos": cooldown,
        }
        info["status"] = _status(info)
        limites[chave] = info

    return {
        "dia": dados["dia"],
        "alerta_percentual": round(alerta * 100),
        "limites": limites,
        "modelos": dados["modelos"],
        "historico": dados["historico"],
        "totais": dados["totais"],
    }


@router.post(
    "/tenants/{tenant_id}/admins",
    status_code=status.HTTP_201_CREATED,
    summary="Cria ou redefine o administrador de um tenant",
)
async def criar_admin_tenant(
    tenant_id: UUID,
    body: CriarAdminTenantRequest,
    dev=Depends(require_developer),
):
    """
    Provisiona o administrador inicial (ou redefine a senha) de uma imobiliária.
    A senha é armazenada com bcrypt.
    """
    from sqlalchemy.sql import text
    from app.shared.security import hash_password

    async with get_admin_session() as session:
        existe = await session.execute(
            text("SELECT id FROM tenants WHERE id = :tid AND status != 'deleted'"),
            {"tid": str(tenant_id)},
        )
        if not existe.first():
            raise HTTPException(status_code=404, detail="Tenant não encontrado")

        await session.execute(
            text("""
                INSERT INTO tenant_admins (tenant_id, nome, email, senha_hash, ativo)
                VALUES (:tid, :nome, :email, :senha, TRUE)
                ON CONFLICT (tenant_id, email) DO UPDATE
                    SET nome = EXCLUDED.nome,
                        senha_hash = EXCLUDED.senha_hash,
                        ativo = TRUE
            """),
            {
                "tid": str(tenant_id),
                "nome": body.nome,
                "email": body.email.strip().lower(),
                "senha": hash_password(body.senha),
            },
        )

    log.info("admin_tenant_provisionado", tenant_id=str(tenant_id), por=dev.sub)
    return {"status": "created", "email": body.email.strip().lower()}
