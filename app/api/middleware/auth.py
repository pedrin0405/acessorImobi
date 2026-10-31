"""
Middleware de autenticação e autorização.

REGRA: Toda verificação ocorre no servidor, em cada requisição.
Esconder botão não é permissão.
Recurso fora do escopo retorna 404, não 403, para não revelar existência.
"""
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.shared.security import decode_access_token, InvalidTokenError

security = HTTPBearer(auto_error=False)


@dataclass
class DeveloperPrincipal:
    sub: str
    role: str = "developer"


@dataclass
class AdminPrincipal:
    sub: str
    tenant_id: UUID
    admin_id: UUID
    role: str = "admin"
    # Só nas rotas do portal compartilhado (`require_portal`): o corretor logado. Com ele, tudo é limitado à carteira dele.
    corretor_id: Optional[UUID] = None

    @property
    def escopo(self) -> Optional[UUID]:
        """O corretor a que os dados ficam restritos; None para a equipe da imobiliária (vê tudo)."""
        return self.corretor_id


@dataclass
class CorretorPrincipal:
    sub: str
    tenant_id: UUID
    corretor_id: UUID
    role: str = "corretor"


def _decode_token(credentials: Optional[HTTPAuthorizationCredentials]) -> dict:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token não fornecido",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        return decode_access_token(credentials.credentials)
    except InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido ou expirado",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def require_developer(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> DeveloperPrincipal:
    payload = _decode_token(credentials)
    if payload.get("role") != "developer":
        # Retorna 404 para não revelar que o recurso existe
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return DeveloperPrincipal(sub=payload["sub"])


async def require_admin(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> AdminPrincipal:
    payload = _decode_token(credentials)
    role = payload.get("role")
    if role not in ("admin", "developer"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    # Rotas do portal da imobiliária exigem escopo de tenant.
    # O papel developer opera apenas no painel /dev.
    tenant_id = payload.get("tid")
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    admin_id = UUID(payload.get("aid", "00000000-0000-0000-0000-000000000000"))
    if role == "admin" and payload.get("aid"):
        await _checar_sessao_admin(UUID(tenant_id), admin_id, payload)

    return AdminPrincipal(
        sub=payload["sub"],
        tenant_id=UUID(tenant_id),
        admin_id=admin_id,
    )


def exigir_proprio(principal: "AdminPrincipal", corretor_id: UUID) -> None:
    """Corretor só acessa o que é dele; o de outro corretor vale 404 (não revela que existe)."""
    if principal.corretor_id and principal.corretor_id != corretor_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)


async def require_portal(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> AdminPrincipal:
    """
    Rotas que o portal da imobiliária e o do corretor compartilham. A equipe da imobiliária entra como sempre; o
    corretor entra com `corretor_id` preenchido e cada rota limita o que ele enxerga à carteira dele. Rotas que só a
    equipe pode usar continuam em `require_admin`, onde o token de corretor vale 404.
    """
    payload = _decode_token(credentials)
    if payload.get("role") == "corretor":
        tenant_id, corretor_id = payload.get("tid"), payload.get("cid")
        if not tenant_id or not corretor_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
        await _checar_corretor_ativo(UUID(tenant_id), UUID(corretor_id))
        return AdminPrincipal(
            sub=payload["sub"], tenant_id=UUID(tenant_id), admin_id=UUID("00000000-0000-0000-0000-000000000000"),
            role="corretor", corretor_id=UUID(corretor_id),
        )
    return await require_admin(credentials)


async def _checar_corretor_ativo(tenant_id: UUID, corretor_id: UUID) -> None:
    """Corretor bloqueado ou removido perde o acesso na hora, mesmo com o token ainda dentro da validade."""
    from sqlalchemy import text

    from app.shared.database import get_session

    async with get_session(tenant_id) as session:
        ativo = (await session.execute(
            text("SELECT status FROM corretores WHERE id = :id AND tenant_id = :tid"),
            {"id": str(corretor_id), "tid": str(tenant_id)},
        )).scalar()
    if ativo != "active":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão encerrada. Entre novamente.",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def _checar_sessao_admin(tenant_id: UUID, admin_id: UUID, payload: dict) -> None:
    """Recusa o token de um admin desativado ou emitido antes da última troca de senha."""
    from sqlalchemy import text

    from app.shared.database import get_session

    async with get_session(tenant_id) as session:
        row = (await session.execute(
            text("SELECT ativo, tokens_validos_apos FROM tenant_admins WHERE id = :id AND tenant_id = :tid"),
            {"id": str(admin_id), "tid": str(tenant_id)},
        )).first()
    invalido = row is None or not row.ativo
    if row is not None and row.tokens_validos_apos is not None:
        emitido = payload.get("iat")
        # Token sem hora de emissão é anterior a esta regra: não vale depois de uma troca de senha.
        invalido = invalido or emitido is None or float(emitido) < row.tokens_validos_apos.timestamp() - 1
    if invalido:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sessão encerrada. Entre novamente.",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def require_corretor(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> CorretorPrincipal:
    payload = _decode_token(credentials)
    if payload.get("role") != "corretor":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    tenant_id = payload.get("tid")
    corretor_id = payload.get("cid")
    if not tenant_id or not corretor_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    return CorretorPrincipal(
        sub=payload["sub"],
        tenant_id=UUID(tenant_id),
        corretor_id=UUID(corretor_id),
    )
