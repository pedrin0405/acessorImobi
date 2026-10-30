"""
Serviço de Domínio para sessões de WhatsApp do agente.
Gerencia o ciclo de conexão da instância Evolution: status, QR code e desconexão.
"""
from typing import Any, Dict, Optional
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import text

from app.integration.whatsapp.evolution import EvolutionClient
from app.shared.config import get_settings
from app.shared.phone import normalize_phone

log = structlog.get_logger()
settings = get_settings()


class WhatsAppIntegrationError(Exception):
    """Falha ao operar a instância de WhatsApp."""


def build_webhook_url(instance_id: str) -> str:
    """
    URL de webhook alcançável pelo container do Evolution.
    Em produção usa o domínio público da API; localmente usa a rede interna do Docker.
    """
    if settings.environment == "production":
        return f"https://api.{settings.base_domain}/webhook/{instance_id}"
    return f"http://api:8000/webhook/{instance_id}"


# Mapeamento de estados da Evolution para os estados persistidos
STATE_MAP = {
    "open": "connected",
    "connecting": "qr_pending",
    "close": "disconnected",
    "closed": "disconnected",
    "refused": "disconnected",
    "not_found": "disconnected",
}


# Sem imagem de QR (modo "conectar com número"), o código de pareamento fica em
# sessoes.qr_code com este prefixo, para o status() reconhecer um pareamento em curso.
PREFIXO_PAREAMENTO = "pairing:"


def normalizar_numero_pareamento(numero: str) -> str:
    """Só dígitos, com DDI 55 quando vier DDD + número (10 ou 11 dígitos)."""
    digitos = "".join(ch for ch in (numero or "") if ch.isdigit())
    if len(digitos) in (10, 11):
        digitos = "55" + digitos
    if not 12 <= len(digitos) <= 15:
        raise WhatsAppIntegrationError(
            "Número inválido. Informe o WhatsApp do agente com DDD, por exemplo 63 99999-9999."
        )
    return digitos


class SessaoWhatsApp:
    def __init__(self, row):
        self.id = row.id
        self.instance_id = row.instance_id
        self.numero = row.numero
        self.status = row.status
        self.qr_code = row.qr_code
        self.last_seen = row.last_seen


class WhatsAppService:
    def __init__(self, session: AsyncSession, tenant_id: UUID):
        self._session = session
        self._tenant_id = tenant_id
        self._client = EvolutionClient()
        # Número para o código de pareamento (só nos números pessoais).
        self._numero_pareamento: Optional[str] = None

    async def _get_sessao(self) -> Optional[SessaoWhatsApp]:
        res = await self._session.execute(
            text("""
                SELECT id, instance_id, numero, status, qr_code, last_seen
                FROM whatsapp_sessions
                WHERE tenant_id = :tid AND tipo = 'agente'
                ORDER BY created_at ASC
                LIMIT 1
            """),
            {"tid": str(self._tenant_id)},
        )
        row = res.first()
        return SessaoWhatsApp(row) if row else None

    async def _persistir(
        self,
        sessao: SessaoWhatsApp,
        status: Optional[str] = None,
        qr_code: Optional[str] = None,
        limpar_qr: bool = False,
        numero: Optional[str] = None,
    ) -> None:
        sets = ["last_seen = NOW()"]
        params: Dict[str, Any] = {"id": str(sessao.id)}

        if status:
            sets.append("status = :status")
            params["status"] = status

        if limpar_qr:
            sets.append("qr_code = NULL")
        elif qr_code is not None:
            sets.append("qr_code = :qr")
            params["qr"] = qr_code

        if numero:
            sets.append("numero = :numero")
            params["numero"] = numero

        await self._session.execute(
            text(f"UPDATE whatsapp_sessions SET {', '.join(sets)} WHERE id = :id"),
            params,
        )

    async def status(self) -> Dict[str, Any]:
        """
        Consulta o estado real na Evolution, sincroniza com o banco e retorna
        os dados necessários ao portal (sem expor credenciais).
        """
        sessao = await self._get_sessao()
        if not sessao:
            return {
                "status": "not_provisioned",
                "instance_id": None,
                "numero": None,
                "qr_code": None,
                "degradado": False,
                "mensagem": "Nenhuma sessão de WhatsApp provisionada para esta imobiliária.",
            }

        degradado = False
        evolution_state = None

        try:
            data = await self._client.get_instance_status(sessao.instance_id)
            evolution_state = data.get("instance", {}).get("state", "not_found")
            novo_status = STATE_MAP.get(evolution_state, "disconnected")

            # Estado "connecting" sem QR armazenado significa que o código expirou:
            # o portal deve oferecer a geração de um novo QR.
            if novo_status == "qr_pending" and not sessao.qr_code:
                novo_status = "disconnected"
        except Exception as e:
            log.warning(
                "whatsapp_status_indisponivel",
                tenant_id=str(self._tenant_id)[:8],
                error=str(e)[:120],
            )
            degradado = True
            novo_status = sessao.status

        numero = sessao.numero

        # Ao conectar, sincroniza o número real da conta pareada
        if novo_status == "connected":
            try:
                info = await self._client.get_instance_info(sessao.instance_id)
                owner = (info or {}).get("ownerJid")
                if owner:
                    digits = str(owner).split("@")[0]
                    try:
                        numero = normalize_phone(digits)
                    except ValueError:
                        pass
            except Exception:
                pass

        limpar_qr = novo_status in ("connected", "disconnected")
        await self._persistir(
            sessao,
            status=novo_status,
            limpar_qr=limpar_qr,
            numero=numero if numero != sessao.numero else None,
        )

        pendente = novo_status == "qr_pending" and not limpar_qr
        guardado = sessao.qr_code if pendente else None
        so_codigo = bool(guardado) and guardado.startswith(PREFIXO_PAREAMENTO)
        return {
            "status": novo_status,
            "instance_id": sessao.instance_id,
            "numero": numero,
            "qr_code": None if so_codigo else guardado,
            "pairing_code": guardado[len(PREFIXO_PAREAMENTO):] if so_codigo else None,
            "degradado": degradado,
            "evolution_state": evolution_state,
        }

    async def conectar(self, numero: Optional[str] = None) -> Dict[str, Any]:
        """
        Garante que a instância existe na Evolution, inicia o pareamento e
        retorna o QR code para exibição no portal.

        Com `numero`, também pede o código de pareamento de 8 caracteres
        ("Conectar com número de telefone" no WhatsApp), para quando o QR code
        não puder ser lido ou o WhatsApp recusar a leitura.
        """
        if numero:
            self._numero_pareamento = normalizar_numero_pareamento(numero)
        sessao = await self._get_sessao()
        if not sessao:
            raise WhatsAppIntegrationError(
                "Nenhuma sessão de WhatsApp provisionada para esta imobiliária."
            )

        # Garante que o webhook aponta para a URL deste ambiente (dev vs. produção).
        try:
            await self._client.set_webhook(
                sessao.instance_id, build_webhook_url(sessao.instance_id)
            )
        except Exception as e:
            log.warning(
                "whatsapp_webhook_set_falhou",
                tenant_id=str(self._tenant_id)[:8],
                error=str(e)[:120],
            )

        try:
            estado = await self._client.get_instance_status(sessao.instance_id)
            state = estado.get("instance", {}).get("state", "not_found")

            if state == "open":
                await self._persistir(sessao, status="connected", limpar_qr=True)
                return {
                    "status": "connected",
                    "instance_id": sessao.instance_id,
                    "numero": sessao.numero,
                    "qr_code": None,
                    "pairing_code": None,
                }

            # Instância ainda não existe na Evolution → cria agora
            if state == "not_found":
                criado = await self._client.create_instance(
                    instance_name=sessao.instance_id,
                    webhook_url=build_webhook_url(sessao.instance_id),
                    number=self._numero_pareamento,
                )
                qr = (criado or {}).get("qrcode", {}).get("base64") if isinstance(criado, dict) else None
                pairing = (criado or {}).get("qrcode", {}).get("pairingCode") if isinstance(criado, dict) else None
                if qr or pairing:
                    await self._persistir(sessao, status="qr_pending", qr_code=qr or f"{PREFIXO_PAREAMENTO}{pairing}")
                    return {
                        "status": "qr_pending",
                        "instance_id": sessao.instance_id,
                        "numero": sessao.numero,
                        "qr_code": qr,
                        "pairing_code": pairing,
                    }

            data = await self._client.connect_instance(sessao.instance_id, number=self._numero_pareamento)
            qr = data.get("base64") or (data.get("qrcode") or {}).get("base64")
            pairing = data.get("pairingCode") or (data.get("qrcode") or {}).get("pairingCode")

            # Se não veio QR nem código, pode já ter conectado nesse meio tempo
            if not qr and not pairing:
                estado = await self._client.get_instance_status(sessao.instance_id)
                if estado.get("instance", {}).get("state") == "open":
                    await self._persistir(sessao, status="connected", limpar_qr=True)
                    return {
                        "status": "connected",
                        "instance_id": sessao.instance_id,
                        "numero": sessao.numero,
                        "qr_code": None,
                        "pairing_code": None,
                    }

                # QR expirado: recria a instância para forçar um código novo.
                log.info(
                    "whatsapp_qr_expirado_recriando",
                    tenant_id=str(self._tenant_id)[:8],
                )
                await self._client.delete_instance(sessao.instance_id)
                criado = await self._client.create_instance(
                    instance_name=sessao.instance_id,
                    webhook_url=build_webhook_url(sessao.instance_id),
                    number=self._numero_pareamento,
                )
                qr = (criado or {}).get("qrcode", {}).get("base64") if isinstance(criado, dict) else None
                pairing = (criado or {}).get("qrcode", {}).get("pairingCode") if isinstance(criado, dict) else None

                if not qr and not pairing:
                    raise WhatsAppIntegrationError(
                        "A Evolution não retornou um QR code. Tente novamente em alguns segundos."
                    )

            await self._persistir(sessao, status="qr_pending", qr_code=qr or f"{PREFIXO_PAREAMENTO}{pairing}")
            log.info("whatsapp_qr_gerado", tenant_id=str(self._tenant_id)[:8])

            return {
                "status": "qr_pending",
                "instance_id": sessao.instance_id,
                "numero": sessao.numero,
                "qr_code": qr,
                "pairing_code": pairing,
            }

        except WhatsAppIntegrationError:
            raise
        except Exception as e:
            log.error(
                "whatsapp_conectar_falhou",
                tenant_id=str(self._tenant_id)[:8],
                error=str(e)[:200],
            )
            raise WhatsAppIntegrationError(
                "Não foi possível conectar ao WhatsApp agora. Verifique o serviço de mensageria e tente novamente."
            ) from e

    async def desconectar(self) -> Dict[str, Any]:
        """
        Desconecta a sessão do WhatsApp, mantendo a instância provisionada
        para uma futura reconexão.
        """
        sessao = await self._get_sessao()
        if not sessao:
            raise WhatsAppIntegrationError(
                "Nenhuma sessão de WhatsApp provisionada para esta imobiliária."
            )

        try:
            await self._client.logout_instance(sessao.instance_id)
        except Exception as e:
            log.warning(
                "whatsapp_logout_falhou",
                tenant_id=str(self._tenant_id)[:8],
                error=str(e)[:120],
            )

        await self._persistir(sessao, status="disconnected", limpar_qr=True)
        log.info("whatsapp_desconectado", tenant_id=str(self._tenant_id)[:8])

        return {
            "status": "disconnected",
            "instance_id": sessao.instance_id,
            "numero": sessao.numero,
            "qr_code": None,
        }
