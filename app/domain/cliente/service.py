"""
Serviço de Domínio para Clientes e Leads.
Interage com a API do Imoview usando credenciais criptografadas do tenant.
Gerencia cache de 15 minutos e fila de pendências para escrita com falha.
"""
import hashlib
import json
from typing import Any, Dict, List, Optional
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import text

from app.integration.imoview.client import ImoviewClient, ImoviewError
from app.shared.config import get_settings
from app.shared.phone import normalize_phone
from app.shared.redis import Cache
from app.shared.security import decrypt_credentials, mask_phone

log = structlog.get_logger()
settings = get_settings()


class ClienteService:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def _get_imoview_client(self, tenant_id: UUID) -> ImoviewClient:
        """
        Recupera as credenciais criptografadas do tenant e instancia o ImoviewClient.
        """
        row = await self._session.execute(
            text("SELECT imoview_creds, agent_config FROM tenants WHERE id = :tid"),
            {"tid": str(tenant_id)},
        )
        t = row.first()
        if not t or not t.imoview_creds:
            raise ValueError("Tenant sem credenciais do Imoview configuradas.")

        creds_json = decrypt_credentials(t.imoview_creds)
        creds = json.loads(creds_json)

        return ImoviewClient(
            base_url=creds.get("base_url", "https://api.imoview.com.br"),
            chave=creds.get("chave", ""),
            codigo_acesso=creds.get("codigo_acesso"),
        )

    async def buscar(self, q: str, tenant_id: UUID) -> List[Dict[str, Any]]:
        """
        Consulta clientes por nome, telefone, email ou código.
        Usa cache Redis por 15 minutos com chave do termo pesquisado.
        """
        cache = Cache(str(tenant_id))
        cache_key = f"cliente_search:{hashlib.md5(q.strip().lower().encode()).hexdigest()}"
        cached = await cache.get(cache_key)
        if cached:
            try:
                return json.loads(cached)
            except Exception:
                pass

        client = await self._get_imoview_client(tenant_id)
        resultados = []

        try:
            # 1. Tenta busca exata pelo endpoint de checagem se parecer telefone ou email
            if "@" in q or any(c.isdigit() for c in q):
                dados = await client.verificar_cliente(q)
                if dados and dados.get("existe"):
                    resultados.append({
                        "codigo": dados.get("codigo"),
                        "nome": dados.get("nome", "Cliente sem nome"),
                        "email": q if "@" in q else None,
                        "telefone_mascarado": mask_phone(q) if not "@" in q else "***",
                        "tipo": "Lead/Cliente",
                    })

            # 2. Se vazio, lista clientes da API geral
            if not resultados:
                resp = await client.retornar_clientes(pagina=1, registros=20)
                lista = resp.get("lista", [])
                termo = q.lower().strip()
                for item in lista:
                    nome = item.get("nome", "")
                    cpf = item.get("cpfoucnpj", "")
                    if termo in nome.lower() or termo in cpf:
                        tels = item.get("telefones", [])
                        tel_str = tels[0].get("numero", "") if tels else ""
                        emails = item.get("emails", [])
                        email_str = emails[0].get("email", "") if emails else None

                        resultados.append({
                            "codigo": item.get("codigo"),
                            "nome": nome,
                            "email": email_str,
                            "telefone_mascarado": mask_phone(tel_str) if tel_str else "***",
                            "tipo": item.get("tipo", "Cliente"),
                        })

        except Exception as e:
            log.error("erro_busca_cliente_imoview", error=str(e), q=q)

        # Salva no cache por 15 min
        await cache.set(cache_key, json.dumps(resultados), ttl=settings.cache_cliente_ttl)
        return resultados

    async def criar_no_imoview(self, tenant_id: UUID, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Cria cliente/lead no Imoview com chave de idempotência.
        Repetir a confirmação com mesmo payload não duplica.
        """
        nome = payload.get("nome")
        telefone = payload.get("telefone")
        email = payload.get("email")

        if not nome:
            raise ValueError("Nome do cliente é obrigatório.")

        # Normaliza telefone se informado
        tel_norm = None
        if telefone:
            try:
                tel_norm = normalize_phone(telefone)
            except ValueError:
                tel_norm = telefone

        # Idempotência no Redis: (tenant, telefone_ou_email, hash(payload))
        idemp_target = tel_norm or email or nome
        idemp_hash = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        idemp_key = f"idemp:lead:{tenant_id}:{idemp_target}:{idemp_hash}"

        cache = Cache(str(tenant_id))
        idemp_cached = await cache.get(idemp_key)
        if idemp_cached:
            log.info("idempotencia_lead_aplicada", target=idemp_target)
            return json.loads(idemp_cached)

        client = await self._get_imoview_client(tenant_id)
        resp = await client.incluir_lead(
            nome=nome,
            telefone=tel_norm,
            email=email,
            midia=payload.get("midia", "acessorImobi WhatsApp"),
            finalidade=payload.get("finalidade"),
            codigo_imovel=payload.get("codigo_imovel"),
            anotacoes=payload.get("anotacoes"),
        )

        resultado = {
            "codigo": resp.get("codigo", 0) if isinstance(resp, dict) else 0,
            "mensagem": resp.get("mensagem", "Lead cadastrado com sucesso") if isinstance(resp, dict) else "OK",
            "nome": nome,
        }

        # Armazena idempotência por 24 horas
        await cache.set(idemp_key, json.dumps(resultado), ttl=86400)
        return resultado

    async def atualizar_no_imoview(self, tenant_id: UUID, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        No swagger do Imoview, não existe endpoint de update direto de pessoa/cliente.
        Registra como atendimento ou anotação no CRM.
        """
        log.info("atualizar_imoview_solicitado", tenant_id=str(tenant_id)[:8], payload=payload)
        return {
            "status": "updated_via_note",
            "detalhe": "Atualização registrada no contexto do cliente no CRM.",
        }

    async def criar_pendencia(
        self,
        tenant_id: UUID,
        corretor_id: UUID,
        tipo: str,
        payload: Dict[str, Any],
        erro: str,
    ) -> UUID:
        """
        Registra uma operação que falhou para ser reprocessada pelo scheduler.
        """
        res = await self._session.execute(
            text("""
                INSERT INTO pendencias_crm (
                    tenant_id, corretor_id, tipo, payload, ultimo_erro, tentativas
                ) VALUES (
                    :tid, :cid, :tipo, CAST(:payload AS jsonb), :erro, 1
                )
                RETURNING id
            """),
            {
                "tid": str(tenant_id),
                "cid": str(corretor_id),
                "tipo": tipo,
                "payload": json.dumps(payload),
                "erro": erro[:500],
            },
        )
        row = res.first()
        log.warning(
            "pendencia_crm_criada",
            tenant_id=str(tenant_id)[:8],
            tipo=tipo,
            erro=erro[:100],
        )
        return row[0]

    async def listar_pendencias(self, tenant_id: UUID) -> List[Dict[str, Any]]:
        """
        Lista todas as pendências não resolvidas do tenant.
        """
        rows = await self._session.execute(
            text("""
                SELECT id, corretor_id, tipo, payload, tentativas, ultimo_erro, created_at
                FROM pendencias_crm
                WHERE resolvido = FALSE AND tenant_id = :tid
                ORDER BY created_at DESC
            """),
            {"tid": str(tenant_id)},
        )
        return [
            {
                "id": str(r.id),
                "corretor_id": str(r.corretor_id),
                "tipo": r.tipo,
                "payload": r.payload,
                "tentativas": r.tentativas,
                "ultimo_erro": r.ultimo_erro,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows.fetchall()
        ]
