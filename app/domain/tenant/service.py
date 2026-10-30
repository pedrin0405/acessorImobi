"""
Serviço de Domínio para Tenants (Imobiliárias).
Usado pelo Painel do Desenvolvedor e pelo Portal da Imobiliária.
"""
import json
from typing import Any, Dict, List, Optional
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import text

from app.shared.phone import normalize_phone
from app.shared.security import encrypt_credentials, hash_password

log = structlog.get_logger()


class Tenant:
    def __init__(self, row):
        self.id = row.id
        self.slug = row.slug
        self.nome = row.nome
        self.status = row.status
        self.fuso = row.fuso
        self.horario_inicio = row.horario_inicio
        self.horario_fim = row.horario_fim
        self.retencao_dias = row.retencao_dias
        self.retencao_audit = row.retencao_audit
        self.agent_config = row.agent_config or {}
        self.ollama_model = row.ollama_model
        self.created_at = row.created_at
        self.updated_at = row.updated_at


class TenantService:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def criar_tenant(
        self,
        nome: str,
        slug: str,
        numero_whatsapp: str,
        imoview_base_url: str,
        imoview_chave: str,
        ollama_model: Optional[str] = "qwen3:8b",
        criado_por: Optional[str] = None,
        admin_email: Optional[str] = None,
        admin_senha: Optional[str] = None,
        admin_nome: Optional[str] = None,
    ) -> Tenant:
        """
        Cria novo tenant e provisiona sua sessão do WhatsApp e credenciais Imoview.
        Credenciais do Imoview são cifradas com AES-256-GCM.
        """
        # 1. Verifica unicidade de slug
        slug_check = await self._session.execute(
            text("SELECT id FROM tenants WHERE slug = :slug"),
            {"slug": slug},
        )
        if slug_check.first():
            raise ValueError(f"O slug '{slug}' já está em uso por outro tenant.")

        # 2. Normaliza número de telefone do agente
        tel_normalizado = normalize_phone(numero_whatsapp)

        # 3. Cifra credenciais do Imoview
        creds_dict = {
            "base_url": imoview_base_url.rstrip("/"),
            "chave": imoview_chave,
        }
        creds_cifradas = encrypt_credentials(json.dumps(creds_dict))

        # 4. Insere Tenant
        query_tenant = text("""
            INSERT INTO tenants (
                nome, slug, imoview_creds, ollama_model, agent_config
            ) VALUES (
                :nome, :slug, :creds, :model, CAST(:agent_config AS jsonb)
            )
            RETURNING *
        """)
        initial_config = {
            "persona": f"Você é o assistente virtual da imobiliária {nome}.",
            "vocabulario_bairros": [],
            "vocabulario_tipos": ["apartamento", "casa", "lote", "cobertura", "sala"],
        }

        res_t = await self._session.execute(
            query_tenant,
            {
                "nome": nome,
                "slug": slug,
                "creds": creds_cifradas,
                "model": ollama_model or "qwen3:8b",
                "agent_config": json.dumps(initial_config),
            },
        )
        tenant_row = res_t.first()
        tenant = Tenant(tenant_row)

        # 5. Provisiona sessão do WhatsApp na tabela
        instance_id = f"inst_{slug}"
        await self._session.execute(
            text("""
                INSERT INTO whatsapp_sessions (
                    tenant_id, instance_id, numero, status
                ) VALUES (
                    :tid, :iid, :numero, 'disconnected'
                )
                ON CONFLICT (numero) DO UPDATE SET tenant_id = :tid, instance_id = :iid
            """),
            {
                "tid": str(tenant.id),
                "iid": instance_id,
                "numero": tel_normalizado,
            },
        )

        log.info("tenant_provisionado", slug=slug, tenant_id=str(tenant.id)[:8])

        # 6. Cria administrador inicial da imobiliária (se informado)
        if admin_email and admin_senha:
            await self._session.execute(
                text("""
                    INSERT INTO tenant_admins (tenant_id, nome, email, senha_hash, ativo)
                    VALUES (:tid, :nome, :email, :senha, TRUE)
                    ON CONFLICT (tenant_id, email) DO UPDATE
                        SET senha_hash = EXCLUDED.senha_hash, ativo = TRUE
                """),
                {
                    "tid": str(tenant.id),
                    "nome": admin_nome or admin_email.split("@")[0],
                    "email": admin_email.strip().lower(),
                    "senha": hash_password(admin_senha),
                },
            )
            log.info("admin_tenant_criado", tenant_id=str(tenant.id)[:8])

        # 7. Provisiona instância no Evolution API (best-effort — não bloqueia o cadastro)
        try:
            from app.domain.whatsapp.service import build_webhook_url
            from app.integration.whatsapp.evolution import EvolutionClient

            await EvolutionClient().create_instance(
                instance_name=instance_id,
                webhook_url=build_webhook_url(instance_id),
            )
        except Exception as e:
            log.warning("evolution_provisionamento_falhou", slug=slug, error=str(e)[:200])

        return tenant

    async def listar_todos(self) -> List[Tenant]:
        """Lista todos os tenants cadastrados."""
        rows = await self._session.execute(
            text("SELECT * FROM tenants WHERE status != 'deleted' ORDER BY created_at DESC")
        )
        return [Tenant(r) for r in rows.fetchall()]

    async def get_by_id(self, tenant_id: UUID) -> Optional[Tenant]:
        row = await self._session.execute(
            text("SELECT * FROM tenants WHERE id = :id"),
            {"id": str(tenant_id)},
        )
        r = row.first()
        return Tenant(r) if r else None

    async def suspender(self, tenant_id: UUID, motivo: str) -> None:
        """Suspende operação de um tenant."""
        await self._session.execute(
            text("UPDATE tenants SET status = 'suspended', updated_at = NOW() WHERE id = :id"),
            {"id": str(tenant_id)},
        )
        log.warning("tenant_suspenso", tenant_id=str(tenant_id)[:8], motivo=motivo)

    async def remover(self, tenant_id: UUID) -> None:
        """Marca tenant como excluído (soft delete)."""
        await self._session.execute(
            text("UPDATE tenants SET status = 'deleted', updated_at = NOW() WHERE id = :id"),
            {"id": str(tenant_id)},
        )
        log.warning("tenant_removido", tenant_id=str(tenant_id)[:8])

    async def atualizar_agent_config(self, tenant_id: UUID, config: Dict[str, Any]) -> None:
        """Atualiza a configuração de persona e vocabulário do agente."""
        await self._session.execute(
            text("""
                UPDATE tenants
                SET agent_config = agent_config || CAST(:cfg AS jsonb), updated_at = NOW()
                WHERE id = :id
            """),
            {"id": str(tenant_id), "cfg": json.dumps(config)},
        )
        log.info("agent_config_atualizada", tenant_id=str(tenant_id)[:8])

    async def metricas(self, tenant_id: UUID) -> Dict[str, Any]:
        """
        Calcula métricas operacionais sem carregar conteúdo de conversas (LGPD).
        """
        tid = str(tenant_id)

        # Corretores por status
        c_rows = await self._session.execute(
            text("SELECT status, COUNT(*) FROM corretores WHERE tenant_id = :tid GROUP BY status"),
            {"tid": tid},
        )
        corretores_status = {r[0]: r[1] for r in c_rows.fetchall()}

        # Mensagens últimas 24h e total
        m_24h = await self._session.execute(
            text("""
                SELECT COUNT(*) FROM mensagens
                WHERE tenant_id = :tid AND created_at > NOW() - INTERVAL '24 hours'
            """),
            {"tid": tid},
        )
        total_24h = m_24h.scalar() or 0

        # Pendências abertas
        p_res = await self._session.execute(
            text("SELECT COUNT(*) FROM pendencias_crm WHERE tenant_id = :tid AND resolvido = FALSE"),
            {"tid": tid},
        )
        pendencias_abertas = p_res.scalar() or 0

        # Status da sessão WhatsApp
        ws_res = await self._session.execute(
            text("SELECT status, instance_id, numero FROM whatsapp_sessions WHERE tenant_id = :tid AND tipo = 'agente' LIMIT 1"),
            {"tid": tid},
        )
        ws_row = ws_res.first()

        return {
            "tenant_id": tid,
            "corretores": {
                "total": sum(corretores_status.values()),
                "detalhe": corretores_status,
            },
            "mensagens_24h": total_24h,
            "pendencias_crm": pendencias_abertas,
            "whatsapp": {
                "status": ws_row.status if ws_row else "none",
                "instance_id": ws_row.instance_id if ws_row else None,
            },
        }
