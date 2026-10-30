"""
Cliente do servidor local Qwen3-TTS.

O modelo roda no host (Apple Silicon/MPS) em um processo separado para não
disputar memória com o Docker. Este cliente apenas envia o texto por HTTP e
converte o WAV devolvido para OGG/Opus, formato aceito pelo WhatsApp.

Servidor: scripts/qwen3_tts_server.py
"""
import base64
from typing import Optional

import httpx
import structlog

from app.domain.usage import registrar_uso
from app.integration.llm.gemini import _wav_para_ogg, preparar_texto_fala
from app.integration.tts.vozes import INSTRUCT_PADRAO, falante_catalogo
from app.shared.config import get_settings

log = structlog.get_logger()
settings = get_settings()


class Qwen3TTSError(Exception):
    """Falha ao gerar áudio no servidor local Qwen3-TTS."""


class Qwen3TTSClient:
    def __init__(
        self,
        base_url: Optional[str] = None,
        timeout: Optional[float] = None,
    ):
        self.base_url = (base_url or settings.qwen3_tts_url).rstrip("/")
        self.timeout = timeout or settings.qwen3_tts_timeout_seconds

    async def disponivel(self) -> bool:
        """True quando o servidor local terminou de carregar o modelo."""
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resposta = await client.get(f"{self.base_url}/health")
            if resposta.status_code != 200:
                return False
            return (resposta.json() or {}).get("status") == "ready"
        except (httpx.HTTPError, ValueError):
            return False

    async def _sintetizar(self, payload: dict) -> bytes:
        """Chama o servidor local e devolve o WAV; qualquer falha vira Qwen3TTSError."""
        try:
            headers = {}
            if settings.qwen3_tts_token:
                headers["Authorization"] = f"Bearer {settings.qwen3_tts_token}"
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resposta = await client.post(
                    f"{self.base_url}/tts", json=payload, headers=headers
                )
        except httpx.HTTPError as e:
            await registrar_uso(
                provider="qwen3", operation="tts", model="qwen3-tts-local", errors=1
            )
            raise Qwen3TTSError(f"falha de rede: {e}") from e

        if resposta.status_code != 200:
            await registrar_uso(
                provider="qwen3", operation="tts", model="qwen3-tts-local", errors=1
            )
            raise Qwen3TTSError(
                f"HTTP {resposta.status_code}: {resposta.text[:300]}"
            )
        if not resposta.content:
            await registrar_uso(
                provider="qwen3", operation="tts", model="qwen3-tts-local", errors=1
            )
            raise Qwen3TTSError("servidor retornou áudio vazio")
        return resposta.content

    async def texto_para_audio(
        self, texto: str, voz: Optional[str] = None, clone: Optional[dict] = None
    ) -> Optional[bytes]:
        """
        Sintetiza o texto localmente e devolve OGG/Opus pronto para o WhatsApp.

        `clone` ({"ref_audio": bytes WAV, "ref_texto": str}) usa a voz clonada;
        se a clonagem falhar (ex.: modelo Base não instalado), cai no falante
        do catálogo para o corretor nunca ficar sem áudio.
        """
        fala = preparar_texto_fala(texto, settings.qwen3_tts_max_chars)
        if not fala:
            return None

        # Sem voz escolhida no portal, vale o falante do .env.
        speaker = falante_catalogo(voz) if voz else settings.qwen3_tts_speaker
        payload = {
            "text": fala,
            "speaker": speaker,
            "language": settings.qwen3_tts_language,
        }
        instruct = (
            INSTRUCT_PADRAO if settings.qwen3_tts_instruct is None else settings.qwen3_tts_instruct
        )
        if instruct:
            payload["instruct"] = instruct

        wav = None
        usou_clone = False
        if clone:
            try:
                wav = await self._sintetizar({
                    "text": fala,
                    "language": settings.qwen3_tts_language,
                    "ref_audio": base64.b64encode(clone["ref_audio"]).decode(),
                    "ref_text": clone["ref_texto"],
                })
                usou_clone = True
            except Qwen3TTSError as e:
                log.warning("qwen3_clone_falhou_usando_voz_padrao", error=str(e)[:200])
        if wav is None:
            wav = await self._sintetizar(payload)

        try:
            ogg = await _wav_para_ogg(wav)
        except Exception as e:
            raise Qwen3TTSError(f"falha convertendo WAV em OGG: {e}") from e

        await registrar_uso(
            provider="qwen3",
            operation="tts",
            model="qwen3-tts-local",
            characters=len(fala),
        )
        log.info(
            "qwen3_tts_audio_gerado",
            speaker="clone" if usou_clone else speaker,
            idioma=settings.qwen3_tts_language,
            caracteres=len(fala),
            bytes=len(ogg),
        )
        return ogg
