"""
Serviço de Domínio para Conversas e Confirmações Pendentes.
Gerencia o histórico de mensagens e o ciclo de vida das confirmações de escrita.
"""
from datetime import datetime, timezone
import hashlib
import json
from typing import Any, Dict, List, Optional
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import text

log = structlog.get_logger()


class MensagemHistorico:
    def __init__(self, row):
        self.id = row.id
        self.direcao = row.direcao
        self.tipo = row.tipo
        self.conteudo = row.conteudo
        self.transcricao = row.transcricao
        self.status = row.status
        self.midia_url = row.midia_url
        self.created_at = row.created_at


class ConfirmacaoPendente:
    def __init__(self, row):
        self.id = row.id
        self.tenant_id = row.tenant_id
        self.corretor_id = row.corretor_id
        self.tipo = row.tipo
        self.payload_hash = row.payload_hash
        self.payload = row.payload
        self.expirado_em = row.expirado_em
        self.respondido = row.respondido
        self.created_at = row.created_at


class ConversaService:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def historico(
        self,
        corretor_id: UUID,
        tenant_id: Optional[UUID] = None,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """
        Retorna as últimas N mensagens trocadas pelo corretor.
        Retorna na ordem cronológica (mais antiga -> mais nova) para montar o contexto da IA.
        """
        if tenant_id:
            where_tenant = "AND tenant_id = :tid"
            params: Dict[str, Any] = {
                "cid": str(corretor_id),
                "tid": str(tenant_id),
                "limit": limit,
            }
        else:
            where_tenant = ""
            params = {"cid": str(corretor_id), "limit": limit}

        rows = await self._session.execute(
            text(f"""
                SELECT id, direcao, tipo, conteudo, transcricao, status, midia_url, created_at
                FROM mensagens
                WHERE corretor_id = :cid
                  {where_tenant}
                ORDER BY created_at DESC
                LIMIT :limit
            """),
            params,
        )
        mensagens = [MensagemHistorico(r) for r in rows.fetchall()]
        # Inverte para ordem cronológica
        mensagens.reverse()

        return [
            {
                "id": str(m.id),
                "direcao": m.direcao,
                "tipo": m.tipo,
                "conteudo": m.transcricao if m.transcricao else m.conteudo,
                "status": m.status,
                "midia_url": m.midia_url,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in mensagens
        ]

    async def listar_conversas(self, tenant_id: UUID) -> List[Dict[str, Any]]:
        """
        Lista as conversas do tenant com a última mensagem de cada corretor.

        Só entram corretores que já trocaram ao menos uma mensagem. A contagem
        de não respondidas considera mensagens inbound ainda na fila (queued),
        que é o estado usado pelo worker até o envio da resposta.
        """
        rows = await self._session.execute(
            text("""
                SELECT
                    c.id AS corretor_id,
                    c.nome,
                    c.telefone,
                    c.status AS corretor_status,
                    m.direcao AS ultima_direcao,
                    m.tipo AS ultimo_tipo,
                    COALESCE(m.transcricao, m.conteudo) AS ultima_mensagem,
                    m.created_at AS ultima_em,
                    (
                        SELECT COUNT(*)
                        FROM mensagens mi
                        WHERE mi.tenant_id = c.tenant_id
                          AND mi.corretor_id = c.id
                          AND mi.direcao = 'inbound'
                          AND mi.status = 'queued'
                    ) AS nao_respondidas
                FROM corretores c
                JOIN LATERAL (
                    SELECT direcao, tipo, conteudo, transcricao, created_at
                    FROM mensagens
                    WHERE tenant_id = c.tenant_id
                      AND corretor_id = c.id
                    ORDER BY created_at DESC
                    LIMIT 1
                ) m ON TRUE
                WHERE c.tenant_id = :tid
                ORDER BY m.created_at DESC
            """),
            {"tid": str(tenant_id)},
        )

        return [
            {
                "corretor_id": str(r.corretor_id),
                "corretor_nome": r.nome,
                "telefone": r.telefone,
                "corretor_status": r.corretor_status,
                "ultima_mensagem": r.ultima_mensagem,
                "ultima_direcao": r.ultima_direcao,
                "ultimo_tipo": r.ultimo_tipo,
                "ultima_em": r.ultima_em.isoformat() if r.ultima_em else None,
                "nao_respondidas": int(r.nao_respondidas or 0),
            }
            for r in rows.fetchall()
        ]

    async def mensagens(
        self,
        corretor_id: UUID,
        tenant_id: UUID,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """Histórico completo da conversa para a visualização estilo WhatsApp."""
        return await self.historico(
            corretor_id=corretor_id,
            tenant_id=tenant_id,
            limit=min(limit, 200),
        )

    async def get_confirmacao_pendente(
        self,
        corretor_id: UUID,
        tenant_id: UUID,
    ) -> Optional[ConfirmacaoPendente]:
        """
        Busca a confirmação pendente mais recente não respondida e dentro do prazo de validade (10 min).
        """
        res = await self._session.execute(
            text("""
                SELECT * FROM confirmacoes_pendentes
                WHERE tenant_id = :tid
                  AND corretor_id = :cid
                  AND respondido = FALSE
                  AND expirado_em > NOW()
                ORDER BY created_at DESC
                LIMIT 1
            """),
            {"tid": str(tenant_id), "cid": str(corretor_id)},
        )
        row = res.first()
        return ConfirmacaoPendente(row) if row else None

    async def criar_confirmacao_pendente(
        self,
        tenant_id: UUID,
        corretor_id: UUID,
        tipo: str,
        payload: Dict[str, Any],
    ) -> UUID:
        """
        Registra uma proposta de escrita que aguarda a confirmação do corretor.
        Calcula hash SHA-256 do payload para checagem anti-conflito.
        Validade de 10 minutos.
        """
        payload_json = json.dumps(payload, sort_keys=True)
        payload_hash = hashlib.sha256(payload_json.encode()).hexdigest()

        res = await self._session.execute(
            text("""
                INSERT INTO confirmacoes_pendentes (
                    tenant_id, corretor_id, tipo, payload_hash, payload, expirado_em
                ) VALUES (
                    :tid, :cid, :tipo, :phash, CAST(:payload AS jsonb), NOW() + INTERVAL '10 minutes'
                )
                RETURNING id
            """),
            {
                "tid": str(tenant_id),
                "cid": str(corretor_id),
                "tipo": tipo,
                "phash": payload_hash,
                "payload": payload_json,
            },
        )
        row = res.first()
        log.info(
            "confirmacao_pendente_criada",
            tenant_id=str(tenant_id)[:8],
            corretor_id=str(corretor_id)[:8],
            tipo=tipo,
        )
        return row[0]
