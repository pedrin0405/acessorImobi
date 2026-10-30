"""
Fábrica de TTS com fallback.

`TTS_PROVIDER=auto` tenta o Qwen3 local primeiro e, se o servidor estiver
offline ou falhar, usa o Gemini. Os modos explícitos (`qwen3`/`gemini`) não
fazem fallback, o que facilita testar cada provedor isoladamente.
"""
from typing import List, Optional

import structlog

from app.integration.llm.gemini import preparar_texto_fala
from app.integration.tts.qwen3 import Qwen3TTSClient
from app.shared.config import get_settings

log = structlog.get_logger()
settings = get_settings()


class TTSError(Exception):
    """Nenhum provedor de TTS conseguiu gerar o áudio."""


class FallbackTTSClient:
    def __init__(self, providers: List[str]):
        self.providers = providers

    async def texto_para_audio(
        self, texto: str, voz: Optional[str] = None, clone: Optional[dict] = None
    ) -> Optional[bytes]:
        fala = preparar_texto_fala(texto)
        if not fala:
            return None

        erros: List[str] = []
        for provedor in self.providers:
            try:
                if provedor == "qwen3":
                    audio = await Qwen3TTSClient().texto_para_audio(fala, voz, clone)
                elif provedor == "gemini":
                    # Import tardio: evita exigir GEMINI_API_KEY quando o
                    # Qwen3 local já resolveu o áudio.
                    from app.integration.llm.gemini import GeminiClient

                    audio = await GeminiClient().texto_para_audio(fala)
                else:
                    raise TTSError(f"provedor TTS desconhecido: {provedor}")

                if audio:
                    return audio
                erros.append(f"{provedor}: sem áudio")
                log.warning("tts_sem_audio", provedor=provedor)
            except Exception as e:
                erros.append(f"{provedor}: {e}")
                log.warning(
                    "tts_provedor_falhou",
                    provedor=provedor,
                    error=str(e)[:300],
                )

        raise TTSError("; ".join(erros) or "nenhum provedor TTS configurado")


def get_tts_client(provider: Optional[str] = None) -> FallbackTTSClient:
    escolhido = (provider or settings.tts_provider or "auto").strip().lower()

    if escolhido == "auto":
        ordem = ["qwen3", "gemini"]
    elif escolhido in {"qwen3", "gemini"}:
        ordem = [escolhido]
    else:
        log.warning("tts_provider_invalido", provider=escolhido)
        ordem = ["gemini"]

    return FallbackTTSClient(ordem)
