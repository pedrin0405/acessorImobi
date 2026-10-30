"""
Integração com o serviço de transcrição local Whisper ASR.
Aceita URL de mídia, data URI ou base64 cru e envia para transcrição.
"""
import base64
import io
from typing import Optional
import httpx
import structlog
from app.domain.usage import registrar_uso
from app.shared.config import get_settings

log = structlog.get_logger()
settings = get_settings()

_WHISPER_MODEL = "whisper-asr"


def _decodificar_midia(audio_url: str) -> Optional[bytes]:
    """Aceita URL http(s), data URI ou base64 cru e devolve os bytes do áudio."""
    audio_url = (audio_url or "").strip()
    if not audio_url:
        return None

    if audio_url.startswith("data:"):
        _, _, payload = audio_url.partition(",")
        try:
            return base64.b64decode(payload)
        except Exception:
            return None

    if audio_url.startswith(("http://", "https://")):
        return None  # baixado pelo chamador

    # Base64 cru (Evolution pode devolver assim)
    try:
        return base64.b64decode(audio_url, validate=True)
    except Exception:
        return None


async def _baixar_audio(url: str) -> Optional[bytes]:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                log.warning("audio_download_failed", url=url, status=resp.status_code)
                return None
            return resp.content
    except Exception as e:
        log.error("audio_download_excecao", error=str(e), url=url)
        return None


async def transcrever_audio(audio_url: str) -> Optional[str]:
    """
    Obtém o áudio (download ou base64) e envia para o serviço Whisper local.
    Retorna o texto transcrito ou None se falhar.
    """
    if not audio_url:
        return None

    if audio_url.startswith(("http://", "https://")):
        audio_bytes = await _baixar_audio(audio_url)
    else:
        audio_bytes = _decodificar_midia(audio_url)

    if not audio_bytes:
        return None

    try:
        # Envio para o webservice do Whisper
        # Endpoint padrão do onerahmet/openai-whisper-asr-webservice: POST /asr?task=transcribe&language=pt&output=json
        whisper_url = f"{settings.whisper_base_url.rstrip('/')}/asr"
        params = {
            "task": "transcribe",
            "language": "pt",
            "output": "json",
        }
        files = {
            "audio_file": ("audio.ogg", io.BytesIO(audio_bytes), "audio/ogg"),
        }

        async with httpx.AsyncClient(timeout=settings.whisper_timeout_seconds) as client:
            asr_resp = await client.post(whisper_url, params=params, files=files)
            if asr_resp.status_code != 200:
                log.warning("whisper_asr_failed", status=asr_resp.status_code, body=asr_resp.text[:200])
                await registrar_uso(
                    provider="whisper",
                    operation="transcription",
                    model=_WHISPER_MODEL,
                    errors=1,
                )
                return None

            data = asr_resp.json()
            # Retorna texto transcrito
            texto = ""
            if isinstance(data, dict):
                texto = data.get("text", "").strip()
            else:
                texto = str(data).strip()

            await registrar_uso(
                provider="whisper",
                operation="transcription",
                model=_WHISPER_MODEL,
                characters=len(texto or ""),
            )
            return texto or None

    except Exception as e:
        log.error("transcricao_audio_excecao", error=str(e), url=audio_url[:64])
        await registrar_uso(
            provider="whisper",
            operation="transcription",
            model=_WHISPER_MODEL,
            errors=1,
        )
        return None
