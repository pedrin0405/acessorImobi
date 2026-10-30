"""Testes do TTS local (Qwen3) e do fallback para Gemini."""
import json

import pytest

from app.integration.tts import factory, qwen3
from app.integration.tts.factory import TTSError, get_tts_client
from app.integration.tts.qwen3 import Qwen3TTSError, Qwen3TTSClient


def _cliente_qwen3():
    return Qwen3TTSClient(base_url="http://host.docker.internal:8010", timeout=30)


@pytest.mark.asyncio
async def test_qwen3_envia_payload_limpo_e_converte_para_ogg(httpx_mock, monkeypatch):
    async def fake_wav_para_ogg(wav: bytes) -> bytes:
        assert wav.startswith(b"RIFF")
        return b"OggS\x00audio"

    monkeypatch.setattr(qwen3, "_wav_para_ogg", fake_wav_para_ogg)
    httpx_mock.add_response(
        url="http://host.docker.internal:8010/tts",
        method="POST",
        content=b"RIFF....WAVEfmt ",
        headers={"Content-Type": "audio/wav"},
    )

    texto = "🏠 *Casa* no Alphaville\n\n" + ("palavra " * 200)
    audio = await _cliente_qwen3().texto_para_audio(texto)

    assert audio == b"OggS\x00audio"
    requisicao = httpx_mock.get_requests()[0]
    payload = json.loads(requisicao.content)
    assert payload["speaker"] == "Serena"
    assert payload["language"] == "Portuguese"
    assert "*" not in payload["text"]
    assert "🏠" not in payload["text"]
    assert len(payload["text"]) <= 520


@pytest.mark.asyncio
async def test_qwen3_erro_http_vira_qwen3ttserror(httpx_mock):
    httpx_mock.add_response(
        url="http://host.docker.internal:8010/tts",
        method="POST",
        status_code=503,
        text="modelo carregando",
    )

    with pytest.raises(Qwen3TTSError) as erro:
        await _cliente_qwen3().texto_para_audio("Olá")

    assert "HTTP 503" in str(erro.value)


@pytest.mark.asyncio
async def test_auto_usa_qwen3_quando_disponivel(monkeypatch):
    chamadas = []

    class QwenOk:
        async def texto_para_audio(self, texto, voz=None, clone=None):
            chamadas.append("qwen3")
            return b"OggS\x00qwen"

    class GeminiNaoDeveSerChamado:
        async def texto_para_audio(self, texto, voz=None, clone=None):
            chamadas.append("gemini")
            return b"OggS\x00gemini"

    monkeypatch.setattr(factory, "Qwen3TTSClient", QwenOk)
    monkeypatch.setattr(
        "app.integration.llm.gemini.GeminiClient", GeminiNaoDeveSerChamado
    )

    audio = await get_tts_client("auto").texto_para_audio("Olá, Pedro!")

    assert audio == b"OggS\x00qwen"
    assert chamadas == ["qwen3"]


@pytest.mark.asyncio
async def test_auto_faz_fallback_para_gemini(monkeypatch):
    chamadas = []

    class QwenOffline:
        async def texto_para_audio(self, texto, voz=None, clone=None):
            chamadas.append("qwen3")
            raise Qwen3TTSError("Connection refused")

    class GeminiOk:
        async def texto_para_audio(self, texto, voz=None, clone=None):
            chamadas.append("gemini")
            return b"OggS\x00gemini"

    monkeypatch.setattr(factory, "Qwen3TTSClient", QwenOffline)
    monkeypatch.setattr("app.integration.llm.gemini.GeminiClient", GeminiOk)

    audio = await get_tts_client("auto").texto_para_audio("Olá, Pedro!")

    assert audio == b"OggS\x00gemini"
    assert chamadas == ["qwen3", "gemini"]


@pytest.mark.asyncio
async def test_provedor_explicito_nao_faz_fallback(monkeypatch):
    class QwenOffline:
        async def texto_para_audio(self, texto, voz=None, clone=None):
            raise Qwen3TTSError("Connection refused")

    class GeminiNaoDeveSerChamado:
        async def texto_para_audio(self, texto, voz=None, clone=None):
            raise AssertionError("Gemini não deveria ser chamado")

    monkeypatch.setattr(factory, "Qwen3TTSClient", QwenOffline)
    monkeypatch.setattr(
        "app.integration.llm.gemini.GeminiClient", GeminiNaoDeveSerChamado
    )

    cliente = get_tts_client("qwen3")
    assert cliente.providers == ["qwen3"]

    with pytest.raises(TTSError) as erro:
        await cliente.texto_para_audio("Olá")

    assert "qwen3" in str(erro.value)


@pytest.mark.asyncio
async def test_texto_vazio_nao_chama_provedor(monkeypatch):
    class NaoDeveSerChamado:
        async def texto_para_audio(self, texto, voz=None, clone=None):
            raise AssertionError("nenhum provedor deveria ser chamado")

    monkeypatch.setattr(factory, "Qwen3TTSClient", NaoDeveSerChamado)
    monkeypatch.setattr(
        "app.integration.llm.gemini.GeminiClient", NaoDeveSerChamado
    )

    assert await get_tts_client("auto").texto_para_audio("   ") is None
