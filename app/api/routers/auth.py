"""
Rotas de Autenticação para emissão de JWT.
Suporta os 3 papéis: developer, admin e corretor.
"""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.sql import text

from app.shared.config import get_settings
from app.shared.database import get_admin_session
from app.shared.phone import normalize_phone
from app.shared.otp import CodigoIndisponivel, enviar_codigo, validar_codigo
from app.shared.security import create_access_token, verify_password

router = APIRouter()
settings = get_settings()


class DevLoginRequest(BaseModel):
    senha: str


class AdminLoginRequest(BaseModel):
    email: str
    senha: str
    slug_tenant: str


class CorretorCodigoRequest(BaseModel):
    telefone: str
    slug_tenant: str


class CorretorLoginRequest(BaseModel):
    telefone: str
    slug_tenant: str
    codigo: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    sub: str


@router.post("/dev/login", response_model=TokenResponse, summary="Login do desenvolvedor global")
async def login_dev(body: DevLoginRequest):
    if body.senha != settings.dev_panel_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Senha de desenvolvedor incorreta",
        )

    token = create_access_token(
        subject="developer_root",
        role="developer",
    )
    return TokenResponse(access_token=token, role="developer", sub="developer_root")


@router.post("/admin/login", response_model=TokenResponse, summary="Login do administrador do tenant")
async def login_admin(body: AdminLoginRequest):
    async with get_admin_session() as session:
        # Busca tenant pelo slug
        t_row = await session.execute(
            text("SELECT id, status FROM tenants WHERE slug = :slug"),
            {"slug": body.slug_tenant.strip().lower()},
        )
        tenant = t_row.first()
        if not tenant or tenant.status != "active":
            raise HTTPException(status_code=401, detail="Tenant não encontrado ou inativo")

        # Busca admin do tenant
        a_row = await session.execute(
            text("SELECT id, senha_hash, ativo FROM tenant_admins WHERE tenant_id = :tid AND email = :email"),
            {"tid": str(tenant.id), "email": body.email.strip().lower()},
        )
        admin = a_row.first()
        if not admin or not admin.ativo or not verify_password(body.senha, admin.senha_hash):
            raise HTTPException(status_code=401, detail="Credenciais inválidas")

        token = create_access_token(
            subject=body.email,
            tenant_id=tenant.id,
            role="admin",
            admin_id=admin.id,
        )
        return TokenResponse(access_token=token, role="admin", sub=body.email)


async def _corretor_ativo(slug: str, telefone: str):
    """(tenant_id, corretor_id) do corretor ativo, ou None."""
    try:
        tel = normalize_phone(telefone)
    except ValueError:
        raise HTTPException(status_code=400, detail="Telefone inválido")
    async with get_admin_session() as session:
        row = await session.execute(
            text("""
                SELECT t.id AS tenant_id, c.id AS corretor_id
                FROM tenants t
                JOIN corretores c ON c.tenant_id = t.id
                WHERE t.slug = :slug AND t.status = 'active'
                  AND c.telefone = :tel AND c.status = 'active'
            """),
            {"slug": slug.strip().lower(), "tel": tel},
        )
        return tel, row.first()


@router.post(
    "/corretor/codigo",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Envia um código de acesso ao WhatsApp do corretor",
)
async def enviar_codigo_corretor(body: CorretorCodigoRequest):
    """
    O portal do corretor mostra conversas com clientes: o acesso exige um
    código de uso único enviado pelo WhatsApp do agente para o número do
    corretor. A resposta é a mesma para número cadastrado ou não, para não
    revelar quem é corretor.
    """
    tel, corretor = await _corretor_ativo(body.slug_tenant, body.telefone)
    resposta = {"detail": "Se o número estiver cadastrado, enviamos um código pelo WhatsApp."}
    if not corretor:
        return resposta
    try:
        await enviar_codigo(corretor.tenant_id, tel)
    except CodigoIndisponivel as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    return resposta


@router.post("/corretor/login", response_model=TokenResponse, summary="Login do corretor")
async def login_corretor(body: CorretorLoginRequest):
    tel, corretor = await _corretor_ativo(body.slug_tenant, body.telefone)
    if not corretor or not await validar_codigo(corretor.tenant_id, tel, body.codigo):
        raise HTTPException(status_code=401, detail="Código inválido ou expirado. Peça um novo.")

    token = create_access_token(
        subject=tel,
        tenant_id=corretor.tenant_id,
        role="corretor",
        corretor_id=corretor.corretor_id,
    )
    return TokenResponse(access_token=token, role="corretor", sub=tel)
