"""
Serviço de Auditoria — registro append-only de ações no sistema.
Regras no banco (RULES) impedem qualquer UPDATE ou DELETE.
"""
import json
from typing import Any, Dict, List, Optional
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import text

log = structlog.get_logger()


class RegistroAuditoria:
    def __init__(self, row):
        self.id = row.id
        self.tenant_id = row.tenant_id
        self.corretor_id = row.corretor_id
        self.acao = row.acao
        self.entidade = row.entidade
        self.entidade_id = row.entidade_id
        self.payload_antes = row.payload_antes
        self.payload_depois = row.payload_depois
        self.aprovado_por = row.aprovado_por
        self.origem = row.origem
        self.ip_hash = row.ip_hash
        self.created_at = row.created_at


class AuditoriaService:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def registrar(
        self,
        tenant_id: UUID,
        corretor_id: Optional[UUID],
        acao: str,
        entidade: Optional[str] = None,
        entidade_id: Optional[str] = None,
        payload_antes: Optional[Dict[str, Any]] = None,
        payload_depois: Optional[Dict[str, Any]] = None,
        aprovado_por: Optional[UUID] = None,
        origem: str = "agent",
        ip_hash: Optional[str] = None,
    ) -> int:
        """
        Insere registro append-only de auditoria.
        Nunca faz update ou delete.
        """
        query = text("""
            INSERT INTO auditoria (
                tenant_id, corretor_id, acao, entidade, entidade_id,
                payload_antes, payload_depois, aprovado_por, origem, ip_hash
            ) VALUES (
                :tenant_id, :corretor_id, :acao, :entidade, :entidade_id,
                CAST(:payload_antes AS jsonb), CAST(:payload_depois AS jsonb), :aprovado_por, :origem, :ip_hash
            )
            RETURNING id
        """)

        params = {
            "tenant_id": str(tenant_id),
            "corretor_id": str(corretor_id) if corretor_id else None,
            "acao": acao,
            "entidade": entidade,
            "entidade_id": str(entidade_id) if entidade_id else None,
            "payload_antes": json.dumps(payload_antes) if payload_antes else None,
            "payload_depois": json.dumps(payload_depois) if payload_depois else None,
            "aprovado_por": str(aprovado_por) if aprovado_por else None,
            "origem": origem,
            "ip_hash": ip_hash,
        }

        res = await self._session.execute(query, params)
        row = res.first()
        log.info("auditoria_registrada", acao=acao, entidade=entidade, entidade_id=entidade_id)
        return row[0] if row else 0

    async def listar(
        self,
        tenant_id: UUID,
        page: int = 1,
        per_page: int = 50,
        corretor_id: Optional[UUID] = None,
    ) -> Dict[str, Any]:
        """
        Lista registros de auditoria com paginação.
        RLS filtra automaticamente por tenant_id na sessão.
        """
        offset = (page - 1) * per_page
        where_clauses = ["tenant_id = :tid"]
        params: Dict[str, Any] = {
            "tid": str(tenant_id),
            "limit": per_page,
            "offset": offset,
        }

        if corretor_id:
            where_clauses.append("corretor_id = :corretor_id")
            params["corretor_id"] = str(corretor_id)

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

        # Total
        count_res = await self._session.execute(
            text(f"SELECT COUNT(*) FROM auditoria {where_sql}"),
            params,
        )
        total = count_res.scalar() or 0

        # Lista
        rows = await self._session.execute(
            text(f"""
                SELECT * FROM auditoria
                {where_sql}
                ORDER BY created_at DESC
                LIMIT :limit OFFSET :offset
            """),
            params,
        )

        itens = []
        for r in rows.fetchall():
            audit = RegistroAuditoria(r)
            itens.append({
                "id": audit.id,
                "corretor_id": str(audit.corretor_id) if audit.corretor_id else None,
                "acao": audit.acao,
                "entidade": audit.entidade,
                "entidade_id": audit.entidade_id,
                "payload_antes": audit.payload_antes,
                "payload_depois": audit.payload_depois,
                "aprovado_por": str(audit.aprovado_por) if audit.aprovado_por else None,
                "origem": audit.origem,
                "created_at": audit.created_at.isoformat() if audit.created_at else None,
            })

        return {
            "total": total,
            "page": page,
            "per_page": per_page,
            "items": itens,
        }
