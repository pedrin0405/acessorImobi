"""
Adaptador de mensageria para Evolution API v2 (WhatsApp gateway).
Isola o restante da plataforma do provedor específico de WhatsApp.
"""
import base64
from typing import Any, Dict, Optional
import httpx
import structlog
from app.shared.config import get_settings

log = structlog.get_logger()
settings = get_settings()


class EvolutionClient:
    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout: float = 15.0,
    ):
        self.base_url = (base_url or settings.evolution_base_url).rstrip("/")
        self.api_key = api_key or settings.evolution_api_key
        self.timeout = timeout

    def _headers(self) -> Dict[str, str]:
        return {
            "apikey": self.api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    async def send_text(self, instance_id: str, to: str, text: str) -> Dict[str, Any]:
        """
        POST /message/sendText/{instance}
        Envia mensagem de texto simples para um número de telefone.
        """
        # Remove símbolos e sufixos do número
        clean_number = "".join(filter(str.isdigit, to))

        url = f"{self.base_url}/message/sendText/{instance_id}"
        payload = {
            "number": clean_number,
            "text": text,
            "options": {
                "delay": 1200,  # Delay humano para simular digitação
                "presence": "composing",
                "linkPreview": True,
            },
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(url, headers=self._headers(), json=payload)
            if resp.status_code not in (200, 201):
                log.error(
                    "evolution_send_text_failed",
                    instance_id=instance_id,
                    status=resp.status_code,
                    body=resp.text[:200],
                )
                raise RuntimeError(f"Evolution send text failed: {resp.status_code} - {resp.text}")
            return resp.json()

    async def send_media(
        self,
        instance_id: str,
        to: str,
        media_url: str,
        caption: str = "",
        mediatype: str = "image",
        mimetype: str = "image/jpeg",
        file_name: str = "imovel.jpg",
    ) -> Dict[str, Any]:
        """
        POST /message/sendMedia/{instance}
        Envia uma imagem com legenda (os dados do imóvel).
        """
        clean_number = "".join(filter(str.isdigit, to))

        url = f"{self.base_url}/message/sendMedia/{instance_id}"
        payload = {
            "number": clean_number,
            "mediatype": mediatype,
            "mimetype": mimetype,
            "media": media_url,
            "fileName": file_name,
            "options": {"delay": 1200},
        }
        if caption:
            payload["caption"] = caption

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(url, headers=self._headers(), json=payload)
            if resp.status_code not in (200, 201):
                log.error(
                    "evolution_send_media_failed",
                    instance_id=instance_id,
                    status=resp.status_code,
                    body=resp.text[:200],
                )
                raise RuntimeError(f"Evolution send media failed: {resp.status_code} - {resp.text}")
            return resp.json()

    async def send_audio(
        self,
        instance_id: str,
        to: str,
        audio: bytes,
        mimetype: str = "audio/ogg",
        file_name: str = "resposta.ogg",
    ) -> Dict[str, Any]:
        """
        Envia uma mensagem de voz (PTT).
        Tenta /message/sendWhatsAppAudio e cai para /message/sendMedia se falhar.
        """
        clean_number = "".join(filter(str.isdigit, to))
        headers = {"apikey": self.api_key, "Accept": "application/json"}

        url = f"{self.base_url}/message/sendWhatsAppAudio/{instance_id}"
        files = {"file": (file_name, audio, mimetype)}
        # `delay` em multipart é enviado como string e a Evolution rejeita
        # com "Enter a value in milliseconds"; o campo é opcional.
        data = {"number": clean_number}

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(url, headers=headers, files=files, data=data)
            if resp.status_code in (200, 201):
                return resp.json()
            log.warning(
                "evolution_send_audio_falhou",
                instance_id=instance_id,
                status=resp.status_code,
                body=resp.text[:200],
            )
        except httpx.HTTPError as e:
            log.warning("evolution_send_audio_erro_rede", error=str(e))

        # Fallback: envia como mídia de áudio em base64.
        return await self.send_media(
            instance_id=instance_id,
            to=to,
            media_url=base64.b64encode(audio).decode(),
            mediatype="audio",
            mimetype=mimetype,
            file_name=file_name,
        )

    async def send_presence(
        self,
        instance_id: str,
        to: str,
        presence: str = "composing",
        delay_ms: int = 25000,
    ) -> None:
        """
        POST /chat/sendPresence/{instance}
        Mostra "digitando..." / "gravando áudio..." para o contato. Best-effort:
        presença é cosmética e nunca pode atrapalhar o envio da resposta.
        """
        clean_number = "".join(filter(str.isdigit, to))
        url = f"{self.base_url}/chat/sendPresence/{instance_id}"
        payload = {"number": clean_number, "presence": presence, "delay": delay_ms}
        try:
            async with httpx.AsyncClient(timeout=delay_ms / 1000 + 10) as client:
                resp = await client.post(url, headers=self._headers(), json=payload)
            if resp.status_code not in (200, 201):
                log.debug("evolution_presence_falhou", status=resp.status_code)
        except Exception as e:  # noqa: BLE001
            log.debug("evolution_presence_erro", error=str(e)[:200])

    async def get_media_base64(
        self,
        instance_id: str,
        message_key: Dict[str, Any],
        message: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        """
        POST /chat/getBase64FromMediaMessage/{instance}
        Baixa a mídia de uma mensagem recebida (áudio, imagem, documento).
        O webhook nem sempre traz a URL/base64 no payload; este método cobre
        esses casos usando a key da mensagem. Quando o objeto `message` do
        webhook está disponível, envia junto para a Evolution decodificar a
        mídia sem depender do histórico dela.
        """
        url = f"{self.base_url}/chat/getBase64FromMediaMessage/{instance_id}"
        corpo_mensagem: Dict[str, Any] = {"key": message_key}
        if message:
            corpo_mensagem = {**message, "key": message_key}
        payload = {
            "message": corpo_mensagem,
            "convertToMpeg4": False,
        }
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(url, headers=self._headers(), json=payload)
        except httpx.HTTPError as e:
            log.warning("evolution_get_media_erro_rede", error=str(e))
            return None

        # A Evolution v2 responde 201 Created neste endpoint (POST), com o
        # base64 no corpo; tratar só 200 descartava todo áudio recebido.
        if resp.status_code not in (200, 201):
            log.warning(
                "evolution_get_media_falhou",
                instance_id=instance_id,
                status=resp.status_code,
                body=resp.text[:200],
            )
            return None

        data = resp.json() or {}
        dados = data.get("data")
        base64_media = (
            data.get("base64")
            or (dados.get("base64") if isinstance(dados, dict) else None)
            or (data.get("message") or {}).get("base64")
            or (dados if isinstance(dados, str) else None)
        )
        if isinstance(base64_media, str) and base64_media.startswith("data:"):
            base64_media = base64_media.partition(",")[2] or None
        if not base64_media:
            log.warning("evolution_get_media_sem_base64", instance_id=instance_id)
        return base64_media

    async def create_instance(
        self, instance_name: str, webhook_url: str, number: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        POST /instance/create
        Provisiona uma nova instância de WhatsApp com webhook configurado.
        Com `number`, a Evolution também devolve o código de pareamento.
        """
        url = f"{self.base_url}/instance/create"
        payload = {
            "instanceName": instance_name,
            "token": "",
            "qrcode": True,
            "integration": "WHATSAPP-BAILEYS",
            "webhook": {
                "enabled": True,
                "url": webhook_url,
                "byEvents": False,
                "events": ["MESSAGES_UPSERT"],
            },
        }
        if number:
            payload["number"] = "".join(filter(str.isdigit, number))

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(url, headers=self._headers(), json=payload)
            if resp.status_code not in (200, 201):
                log.error("evolution_create_instance_failed", status=resp.status_code, body=resp.text)
                raise RuntimeError(f"Falha ao criar instância: {resp.status_code}")
            return resp.json()

    async def get_instance_status(self, instance_id: str) -> Dict[str, Any]:
        """
        GET /instance/connectionState/{instance}
        Verifica se a instância está conectada ao WhatsApp.
        """
        url = f"{self.base_url}/instance/connectionState/{instance_id}"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(url, headers=self._headers())
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 404:
                return {"instance": {"instanceName": instance_id, "state": "not_found"}}
            raise RuntimeError(
                f"Falha ao consultar status da instância: {resp.status_code} - {resp.text[:200]}"
            )

    async def get_instance_info(self, instance_id: str) -> Optional[Dict[str, Any]]:
        """
        GET /instance/fetchInstances?instanceName={instance}
        Retorna metadados da instância, incluindo ownerJid quando conectada.
        """
        url = f"{self.base_url}/instance/fetchInstances"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(
                url,
                headers=self._headers(),
                params={"instanceName": instance_id},
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
            if isinstance(data, list) and data:
                return data[0]
            return None

    async def connect_instance(self, instance_id: str, number: Optional[str] = None) -> Dict[str, Any]:
        """
        GET /instance/connect/{instance}
        Inicia o pareamento e retorna o QR code (base64) e, com `number`,
        o código de pareamento ("Conectar com número de telefone").
        """
        url = f"{self.base_url}/instance/connect/{instance_id}"
        params = {"number": "".join(filter(str.isdigit, number))} if number else None
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(url, headers=self._headers(), params=params)
            if resp.status_code == 200:
                return resp.json()
            raise RuntimeError(
                f"Falha ao gerar QR code: {resp.status_code} - {resp.text[:200]}"
            )

    async def logout_instance(self, instance_id: str) -> None:
        """
        DELETE /instance/logout/{instance}
        Desconecta o WhatsApp mantendo a instância criada.
        """
        url = f"{self.base_url}/instance/logout/{instance_id}"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.delete(url, headers=self._headers())
            if resp.status_code not in (200, 201, 204, 404):
                raise RuntimeError(
                    f"Falha ao desconectar instância: {resp.status_code} - {resp.text[:200]}"
                )

    async def delete_instance(self, instance_id: str) -> None:
        """
        DELETE /instance/delete/{instance}
        Remove a instância (usado para recriar quando o QR expira).
        """
        url = f"{self.base_url}/instance/delete/{instance_id}"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.delete(url, headers=self._headers())
            if resp.status_code not in (200, 201, 204, 404):
                raise RuntimeError(
                    f"Falha ao remover instância: {resp.status_code} - {resp.text[:200]}"
                )

    async def set_webhook(self, instance_id: str, webhook_url: str) -> None:
        """
        POST /webhook/set/{instance}
        (Re)configura o webhook da instância com a URL correta do ambiente.
        """
        url = f"{self.base_url}/webhook/set/{instance_id}"
        payload = {
            "webhook": {
                "enabled": True,
                "url": webhook_url,
                "byEvents": False,
                "events": ["MESSAGES_UPSERT"],
            }
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(url, headers=self._headers(), json=payload)
            if resp.status_code not in (200, 201):
                raise RuntimeError(
                    f"Falha ao configurar webhook: {resp.status_code} - {resp.text[:200]}"
                )

    async def get_qr_code(self, instance_id: str) -> Optional[str]:
        """
        Atalho que retorna apenas o base64 do QR code, se disponível.
        """
        data = await self.connect_instance(instance_id)
        return data.get("base64") or data.get("qrcode", {}).get("base64")
