"""Provedores de síntese de voz (TTS)."""
from app.integration.tts.factory import FallbackTTSClient, TTSError, get_tts_client
from app.integration.tts.qwen3 import Qwen3TTSClient, Qwen3TTSError

__all__ = [
    "FallbackTTSClient",
    "Qwen3TTSClient",
    "Qwen3TTSError",
    "TTSError",
    "get_tts_client",
]
