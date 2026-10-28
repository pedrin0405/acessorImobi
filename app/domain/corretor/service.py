"""
Serviço de domínio para Corretores.

Fluxo de cadastro e aprovação (seção 5 da spec):
- Primeiro contato → cria corretor com status 'pending'
- Coleta nome e e-mail via agente (uma info por mensagem)
- Notifica imobiliária após coleta completa
- Aprovação/recusa registrada com autor e horário
"""
from typing import List, Optional
from uuid import UUID

import structlog
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import text

from app.shared.phone import normalize_phone

log = structlog.get_logger()


class Corretor:
    """Modelo leve de domínio — não usa SQLAlchemy ORM para evitar overhead."""
    def __init__(self, row):
        self.id = row.id
        self.tenant_id = row.tenant_id
        self.telefone = row.telefone
        self.nome = row.nome
        self.email = row.email
        self.status = row.status
        self.created_at = row.created_at


class CorretorService:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def get_ou_criar(self, tenant_id: UUID, telefone: str) -> Corretor:
        """
        Retorna o corretor pelo telefone normalizado.
        Se não existir, cria com status 'pending' — sem acesso a qualquer dado.
        """
        row = await self._session.execute(
            text("SELECT * FROM corretores WHERE tenant_id=:tid AND telefone=:tel"),
            {"tid": str(tenant_id), "tel": telefone},
        )
        corretor_row = row.first()
        if corretor_row:
            return Corretor(corretor_row)

        # Primeiro contato — cria corretor pendente
        result = await self._session.execute(
            text("""
                INSERT INTO corretores (tenant_id, telefone, status)
                VALUES (:tid, :tel, 'pending')
                ON CONFLICT (tenant_id, telefone) DO UPDATE SET updated_at=NOW()
                RETURNING *
            """),
            {"tid": str(tenant_id), "tel": telefone},
        )
        row = result.first()
        log.info("corretor_criado_pendente", tenant_id=str(tenant_id)[:8])
        return Corretor(row)

    async def get_by_id(self, corretor_id: UUID) -> Optional[Corretor]:
        result = await self._session.execute(
            text("SELECT * FROM corretores WHERE id=:id"),
            {"id": str(corretor_id)},
        )
        row = result.first()
        return Corretor(row) if row else None

    async def atualizar_onboarding(
        self,
        corretor_id: UUID,
        nome: Optional[str] = None,
        email: Optional[str] = None,
    ) -> None:
        """Atualiza nome e/ou email durante o fluxo de onboarding."""
        updates = {}
        if nome:
            updates["nome"] = nome
        if email:
            updates["email"] = email
        if not updates:
            return

        set_clause = ", ".join(f"{k}=:{k}" for k in updates)
        updates["id"] = str(corretor_id)
        await self._session.execute(
            text(f"UPDATE corretores SET {set_clause} WHERE id=:id"),
            updates,
        )

    async def decidir(
        self,
        corretor_id: UUID,
        aprovado: bool,
        motivo: Optional[str],
        admin_id: UUID,
    ) -> Corretor:
        """Aprova ou recusa o corretor. Registra autor e horário."""
        novo_status = "active" if aprovado else "rejected"
        await self._session.execute(
            text("""
                UPDATE corretores SET
                    status=:status,
                    recusa_motivo=:motivo,
                    aprovado_por=:admin_id,
                    aprovado_em=NOW(),
                    updated_at=NOW()
                WHERE id=:id
            """),
            {
                "status": novo_status,
                "motivo": motivo,
                "admin_id": str(admin_id),
                "id": str(corretor_id),
            },
        )
        return await self.get_by_id(corretor_id)

    async def bloquear(self, corretor_id: UUID) -> None:
        """Bloqueia um corretor após nova tentativa de acesso pós-recusa."""
        await self._session.execute(
            text("UPDATE corretores SET status='blocked', updated_at=NOW() WHERE id=:id"),
            {"id": str(corretor_id)},
        )

    async def listar(self, status: Optional[str] = None) -> List[Corretor]:
        query = "SELECT * FROM corretores"
        params = {}
        if status:
            query += " WHERE status=:status"
            params["status"] = status
        query += " ORDER BY created_at DESC"
        result = await self._session.execute(text(query), params)
        return [Corretor(r) for r in result.fetchall()]
