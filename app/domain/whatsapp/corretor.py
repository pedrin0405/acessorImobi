"""
WhatsApp pessoal do corretor.

O corretor conecta o próprio número para o assistente LER os atendimentos com
clientes (resumir, analisar, sugerir). Nada é enviado por esta instância: as
respostas do assistente chegam ao corretor pelo número do agente da
imobiliária. Só aceita o mesmo número cadastrado para o corretor.
"""
from typing import Any, Dict, Optional
from uuid import UUID

import structlog
from sqlalchemy.sql import text

from app.domain.whatsapp.service import STATE_MAP, SessaoWhatsApp, WhatsAppIntegrationError, WhatsAppService
from app.shared.phone import normalize_phone

log = structlog.get_logger()

# Preferências padrão do assistente (corretores.assistente_config).
ASSISTENTE_PADRAO = {
    "ativo": True,           # lê e analisa os atendimentos
    "avisos": True,          # avisa no WhatsApp do agente quando um cliente espera resposta
    "carteira_auto": True,   # anota na carteira clientes de atendimentos imobiliários
}


def config_assistente(bruto: Optional[Dict[str, Any]]) -> Dict[str, bool]:
    return {chave: bool((bruto or {}).get(chave, padrao)) for chave, padrao in ASSISTENTE_PADRAO.items()}


def numero_confere(owner_digitos: str, telefone_cadastrado: str) -> bool:
    """Compara o número pareado (ownerJid) com o cadastrado, já normalizados."""
    try:
        return normalize_phone(owner_digitos) == telefone_cadastrado
    except ValueError:
        return False


def instance_id_corretor(corretor_id: UUID) -> str:
    return f"corretor_{corretor_id.hex[:20]}"


class CorretorWhatsAppService(WhatsAppService):
    def __init__(self, session, tenant_id: UUID, corretor_id: UUID, telefone: str):
        super().__init__(session, tenant_id)
        self._corretor_id = corretor_id
        self._telefone = telefone
        self._numero_pareamento = telefone

    async def _get_sessao(self) -> Optional[SessaoWhatsApp]:
        res = await self._session.execute(
            text("""
                SELECT id, instance_id, numero, status, qr_code, last_seen
                FROM whatsapp_sessions
                WHERE tenant_id = :tid AND corretor_id = :cid
            """),
            {"tid": str(self._tenant_id), "cid": str(self._corretor_id)},
        )
        row = res.first()
        return SessaoWhatsApp(row) if row else None

    async def _provisionar(self) -> SessaoWhatsApp:
        sessao = await self._get_sessao()
        if sessao:
            return sessao
        try:
            await self._session.execute(
                text("""
                    INSERT INTO whatsapp_sessions (tenant_id, corretor_id, tipo, instance_id, numero, status)
                    VALUES (:tid, :cid, 'corretor', :iid, :numero, 'disconnected')
                """),
                {
                    "tid": str(self._tenant_id), "cid": str(self._corretor_id),
                    "iid": instance_id_corretor(self._corretor_id), "numero": self._telefone,
                },
            )
        except Exception as e:
            raise WhatsAppIntegrationError(
                "Este número já está conectado em outra sessão. Fale com o administrador."
            ) from e
        return await self._get_sessao()

    async def status(self) -> Dict[str, Any]:
        sessao = await self._get_sessao()
        if not sessao:
            return {"status": "not_provisioned", "numero": self._telefone, "qr_code": None}

        try:
            data = await self._client.get_instance_status(sessao.instance_id)
            novo_status = STATE_MAP.get(data.get("instance", {}).get("state", "not_found"), "disconnected")
        except Exception as e:
            log.warning("whatsapp_corretor_status_indisponivel", error=str(e)[:120])
            return {"status": sessao.status, "numero": sessao.numero, "qr_code": None, "degradado": True}

        if novo_status == "qr_pending" and not sessao.qr_code:
            novo_status = "disconnected"

        # Confere o número só ao virar "connected" (é isso que libera a leitura).
        if novo_status == "connected" and sessao.status != "connected":
            confere = await self._numero_confere(sessao)
            if confere is False:
                # Outro número pareou: desconecta antes de ler qualquer conversa.
                await self._desconectar_instancia(sessao)
                await self._persistir(sessao, status="disconnected", limpar_qr=True)
                return {
                    "status": "numero_divergente",
                    "numero": self._telefone,
                    "qr_code": None,
                    "mensagem": "Conecte o mesmo número cadastrado na imobiliária. A conexão foi desfeita.",
                }
            if confere is None:
                # Não deu para verificar agora (Evolution indisponível): não
                # desconecta o aparelho, só adia a liberação para a próxima consulta.
                return {"status": "qr_pending" if sessao.qr_code else sessao.status, "numero": sessao.numero,
                        "qr_code": sessao.qr_code, "degradado": True}

        await self._persistir(sessao, status=novo_status, limpar_qr=novo_status in ("connected", "disconnected"))
        return {
            "status": novo_status,
            "numero": sessao.numero,
            "qr_code": sessao.qr_code if novo_status == "qr_pending" else None,
        }

    async def _numero_confere(self, sessao: SessaoWhatsApp) -> Optional[bool]:
        """True/False quando dá para comparar; None se não foi possível verificar agora."""
        try:
            info = await self._client.get_instance_info(sessao.instance_id)
        except Exception:
            return None
        owner = str((info or {}).get("ownerJid") or "").split("@")[0]
        if not owner:
            return None
        return numero_confere(owner, self._telefone)

    async def _desconectar_instancia(self, sessao: SessaoWhatsApp) -> None:
        try:
            await self._client.logout_instance(sessao.instance_id)
        except Exception as e:
            log.warning("whatsapp_corretor_logout_falhou", error=str(e)[:120])

    async def conectar(self) -> Dict[str, Any]:
        await self._provisionar()
        resultado = await super().conectar()
        resultado.pop("instance_id", None)
        return resultado

    async def desconectar(self) -> Dict[str, Any]:
        resultado = await super().desconectar()
        resultado.pop("instance_id", None)
        return resultado
