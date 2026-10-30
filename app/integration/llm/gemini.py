"""
Cliente Google Gemini — chat com tool calling e síntese de voz (TTS).

Usado como provedor principal de IA (LLM_PROVIDER=gemini) e para gerar as
respostas em áudio no WhatsApp (voz definida em GEMINI_TTS_VOICE).
"""
import asyncio
import base64
import re
import wave
from io import BytesIO
from typing import Any, Dict, List, Optional

import httpx
import structlog

from app.shared.config import get_settings

log = structlog.get_logger()
settings = get_settings()


class GeminiError(Exception):
    """Falha na chamada ao Gemini (chat ou TTS)."""


class GeminiRateLimitError(GeminiError):
    """Cota do Gemini estourada (HTTP 429) ou em pausa após um 429."""


def _converter_tools(tools: Optional[List[Dict[str, Any]]]) -> Optional[List[Dict[str, Any]]]:
    """Converte ferramentas no formato OpenAI/Ollama para functionDeclarations do Gemini."""
    if not tools:
        return None

    declaracoes = []
    for tool in tools:
        fn = tool.get("function", tool)
        if not fn.get("name"):
            continue
        declaracao: Dict[str, Any] = {
            "name": fn["name"],
            "description": fn.get("description", ""),
        }
        parametros = fn.get("parameters") or {}
        if parametros.get("properties"):
            # O Gemini aceita o subconjunto de JSON Schema usado aqui.
            declaracao["parameters"] = parametros
        declaracoes.append(declaracao)

    return [{"functionDeclarations": declaracoes}] if declaracoes else None


def _montar_contents(messages: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    """Converte mensagens estilo OpenAI em contents do Gemini, agrupando papéis iguais."""
    contents: List[Dict[str, Any]] = []
    for msg in messages:
        if msg.get("role") == "system":
            continue
        texto = (msg.get("content") or "").strip()
        if not texto:
            continue
        papel = "model" if msg.get("role") == "assistant" else "user"
        if contents and contents[-1]["role"] == papel:
            contents[-1]["parts"].append({"text": texto})
        else:
            contents.append({"role": papel, "parts": [{"text": texto}]})

    # O Gemini exige que a conversa comece com o usuário.
    if not contents or contents[0]["role"] != "user":
        contents.insert(0, {"role": "user", "parts": [{"text": "Olá"}]})
    return contents


def preparar_texto_fala(texto: str, max_chars: Optional[int] = None) -> str:
    """Remove markdown/emojis e limita o texto para uma fala natural."""
    limite = max_chars or settings.gemini_tts_max_chars
    limpo = (texto or "").replace("opção(ões)", "opções")
    limpo = re.sub(r"[*_`#>~|]+", " ", limpo)
    limpo = re.sub(r"[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF]", "", limpo)
    limpo = re.sub(r"\s*-{2,}\s*", ". ", limpo)
    limpo = re.sub(r"\s+", " ", limpo).strip()
    if len(limpo) > limite:
        limpo = limpo[:limite].rsplit(" ", 1)[0].rstrip(",.;:") + "."
    return limpo


def _pcm_para_wav(pcm: bytes, sample_rate: int = 24000) -> bytes:
    """Envolve PCM 16-bit mono em um container WAV."""
    buffer = BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm)
    return buffer.getvalue()


def _operacao_payload(payload: Dict[str, Any]) -> str:
    """Distingue chamada de chat de chamada de TTS pelo payload."""
    modalidades = (payload.get("generationConfig") or {}).get("responseModalities") or []
    if any(str(m).upper() == "AUDIO" for m in modalidades):
        return "tts"
    return "chat"


def _caracteres_payload(payload: Dict[str, Any]) -> int:
    total = 0
    for content in payload.get("contents") or []:
        for part in content.get("parts") or []:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                total += len(part["text"])
    return total


async def _wav_para_ogg(wav_bytes: bytes) -> bytes:
    """Converte WAV/PCM em OGG/Opus (formato de áudio do WhatsApp)."""
    try:
        processo = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            "pipe:0",
            "-c:a",
            "libopus",
            "-b:a",
            "32k",
            "-ar",
            "48000",
            "-ac",
            "1",
            "-f",
            "ogg",
            "pipe:1",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as e:
        raise GeminiError("ffmpeg não encontrado na imagem") from e

    try:
        saida, erro = await asyncio.wait_for(processo.communicate(wav_bytes), timeout=60)
    except asyncio.TimeoutError:
        processo.kill()
        raise GeminiError("timeout convertendo áudio com ffmpeg")

    if processo.returncode != 0 or not saida:
        raise GeminiError(f"ffmpeg falhou: {erro.decode(errors='ignore')[:300]}")
    return saida


class GeminiClient:
    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: Optional[float] = None,
        record_usage: bool = True,
    ):
        self.api_key = (api_key or settings.gemini_api_key or "").strip()
        self.model = model or settings.gemini_model
        self.base_url = (base_url or settings.gemini_base_url).rstrip("/")
        self.timeout = timeout or settings.gemini_timeout_seconds
        self.record_usage = record_usage
        if not self.api_key:
            raise GeminiError("GEMINI_API_KEY não configurada")

    async def _registrar_uso(
        self,
        model: str,
        payload: Dict[str, Any],
        data: Optional[Dict[str, Any]] = None,
        erro: bool = False,
        rate_limited: bool = False,
    ) -> None:
        if not self.record_usage:
            return
        try:
            from app.domain.usage.service import registrar_uso

            uso = (data or {}).get("usageMetadata") or {}
            await registrar_uso(
                provider="gemini",
                operation=_operacao_payload(payload),
                model=model,
                requests=1,
                errors=1 if erro else 0,
                input_tokens=int(uso.get("promptTokenCount") or 0),
                output_tokens=int(uso.get("candidatesTokenCount") or 0),
                characters=_caracteres_payload(payload),
                rate_limited=1 if rate_limited else 0,
            )
        except Exception as e:  # noqa: BLE001 - métrica não pode quebrar a resposta
            log.warning("gemini_registrar_uso_falhou", error=str(e)[:200])

    async def _post(self, model: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        from app.domain.usage.service import (
            cooldown_restante,
            iniciar_cooldown,
            segundos_retry,
        )

        operacao = _operacao_payload(payload)
        # A cota é por modelo. Depois de um 429, novas chamadas só gastariam
        # tempo: o chamador cai direto no fallback até a pausa acabar.
        chave_cooldown = f"{operacao}:{model}"
        restante = await cooldown_restante("gemini", chave_cooldown)
        if restante:
            raise GeminiRateLimitError(
                f"cota do Gemini ({operacao}) em pausa por mais {restante}s"
            )

        url = f"{self.base_url}/models/{model}:generateContent"
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resposta = await client.post(
                    url,
                    params={"key": self.api_key},
                    json=payload,
                )
        except httpx.HTTPError as e:
            await self._registrar_uso(model, payload, erro=True)
            raise GeminiError(f"falha de rede: {e}") from e

        if resposta.status_code == 429:
            await self._registrar_uso(model, payload, erro=True, rate_limited=True)
            pausa = segundos_retry(resposta.text)
            await iniciar_cooldown("gemini", chave_cooldown, pausa)
            log.error(
                "gemini_cota_estourada",
                model=model,
                operacao=operacao,
                pausa_segundos=pausa,
                body=resposta.text[:300],
            )
            raise GeminiRateLimitError(f"HTTP 429 (cota): {resposta.text[:300]}")

        if resposta.status_code != 200:
            await self._registrar_uso(model, payload, erro=True)
            log.error(
                "gemini_http_error",
                status=resposta.status_code,
                body=resposta.text[:300],
                model=model,
            )
            raise GeminiError(f"HTTP {resposta.status_code}: {resposta.text[:300]}")
        data = resposta.json()
        await self._registrar_uso(model, payload, data)
        return data

    async def gerar(
        self,
        system_prompt: str,
        messages: List[Dict[str, str]],
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Chama o Gemini e devolve {"text": str|None, "function_call": dict|None}.
        """
        payload: Dict[str, Any] = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": _montar_contents(messages),
            "generationConfig": {
                # 0.6 deixava as respostas repetitivas; os argumentos das
                # ferramentas continuam estáveis nessa faixa.
                "temperature": 0.85,
                "maxOutputTokens": 800,
            },
        }
        tools_gemini = _converter_tools(tools)
        if tools_gemini:
            payload["tools"] = tools_gemini
            payload["toolConfig"] = {"functionCallingConfig": {"mode": "AUTO"}}

        try:
            data = await self._post(self.model, payload)
        except GeminiError:
            raise

        candidatos = data.get("candidates") or []
        if not candidatos:
            raise GeminiError(f"resposta sem candidatos: {str(data)[:300]}")

        parts = (candidatos[0].get("content") or {}).get("parts") or []
        texto_partes = []
        for part in parts:
            if part.get("functionCall"):
                chamada = part["functionCall"]
                return {
                    "text": None,
                    "function_call": {
                        "name": chamada.get("name"),
                        "args": chamada.get("args") or {},
                    },
                    # O Gemini 3 exige o thought_signature ao reenviar a chamada
                    # na segunda passada (functionResponse). Preservamos a part crua.
                    "function_call_part": part,
                }
            if part.get("text") and not part.get("thought"):
                texto_partes.append(part["text"])

        return {"text": "".join(texto_partes).strip(), "function_call": None}

    async def gerar_json(self, system_prompt: str, conteudo: str, max_tokens: int = 1200) -> Dict[str, Any]:
        """Uma chamada com saída JSON (responseMimeType); levanta GeminiError se não vier JSON válido."""
        import json

        payload: Dict[str, Any] = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": [{"text": conteudo}]}],
            "generationConfig": {
                "temperature": 0.4,
                "maxOutputTokens": max_tokens,
                "responseMimeType": "application/json",
            },
        }
        data = await self._post(self.model, payload)
        candidatos = data.get("candidates") or []
        parts = (candidatos[0].get("content") or {}).get("parts") if candidatos else []
        texto = "".join(p.get("text", "") for p in parts or [] if not p.get("thought")).strip()
        try:
            resultado = json.loads(texto)
        except ValueError as e:
            raise GeminiError(f"JSON inválido na resposta: {texto[:200]}") from e
        if not isinstance(resultado, dict):
            raise GeminiError("a resposta JSON não é um objeto")
        return resultado

    async def gerar_apos_ferramenta(
        self,
        system_prompt: str,
        messages: List[Dict[str, str]],
        nome_funcao: str,
        argumentos: Dict[str, Any],
        resultado: str,
        instrucao: Optional[str] = None,
        function_call_part: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        """
        Segunda passada do Gemini: recebe o resultado bruto da ferramenta e
        devolve uma resposta natural ao corretor, preservando os fatos.

        `function_call_part` é a part crua devolvida por `gerar` (com o
        thoughtSignature exigido pelo Gemini 3). Sem ela, a API rejeita a
        chamada com HTTP 400.

        Retorna None se o modelo não produzir texto utilizável; o chamador
        mantém o texto bruto da ferramenta como fallback.
        """
        contents = _montar_contents(messages)
        parte_chamada = function_call_part or {
            "functionCall": {
                "name": nome_funcao,
                "args": argumentos or {},
            }
        }
        contents.append({"role": "model", "parts": [parte_chamada]})
        contents.append(
            {
                "role": "user",
                "parts": [
                    {
                        "functionResponse": {
                            "name": nome_funcao,
                            "response": {"result": resultado},
                        }
                    }
                ],
            }
        )

        texto_sistema = system_prompt
        if instrucao:
            texto_sistema = f"{system_prompt}\n\n{instrucao}"

        payload: Dict[str, Any] = {
            "systemInstruction": {"parts": [{"text": texto_sistema}]},
            "contents": contents,
            "generationConfig": {
                "temperature": 0.75,
                "maxOutputTokens": 500,
            },
        }
        data = await self._post(self.model, payload)
        candidatos = data.get("candidates") or []
        parts = (candidatos[0].get("content") or {}).get("parts") if candidatos else []
        if any(part.get("functionCall") for part in parts or []):
            return None
        texto = "".join(
            part["text"]
            for part in parts or []
            if part.get("text") and not part.get("thought")
        ).strip()
        return texto or None

    async def texto_para_audio(self, texto: str) -> Optional[bytes]:
        """
        Sintetiza o texto com a voz configurada e devolve OGG/Opus pronto
        para envio como mensagem de voz no WhatsApp.
        """
        fala = preparar_texto_fala(texto)
        if not fala:
            return None

        payload = {
            "contents": [
                {
                    "parts": [
                        {
                            # O modelo lê o texto literalmente; não prefixar instruções
                            # de estilo, senão elas também são faladas.
                            "text": fala
                        }
                    ]
                }
            ],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {
                        "prebuiltVoiceConfig": {"voiceName": settings.gemini_tts_voice}
                    }
                },
            },
        }

        modelos = [settings.gemini_tts_model]
        fallback = (settings.gemini_tts_fallback_model or "").strip()
        if fallback and fallback not in modelos:
            modelos.append(fallback)

        ultimo_erro: Optional[GeminiError] = None
        for modelo in modelos:
            try:
                data = await self._post(modelo, payload)
            except GeminiError as e:
                ultimo_erro = e
                log.warning("tts_modelo_falhou", modelo=modelo, error=str(e)[:200])
                continue

            candidatos = data.get("candidates") or []
            parts = (candidatos[0].get("content") or {}).get("parts") if candidatos else []
            for part in parts or []:
                inline = part.get("inlineData") or part.get("inline_data")
                if not inline or not inline.get("data"):
                    continue
                audio = base64.b64decode(inline["data"])
                mime = (inline.get("mimeType") or inline.get("mime_type") or "").lower()

                if "wav" in mime:
                    wav_bytes = audio
                elif "l16" in mime or "pcm" in mime:
                    taxa = re.search(r"rate=(\d+)", mime)
                    wav_bytes = _pcm_para_wav(audio, int(taxa.group(1)) if taxa else 24000)
                else:
                    wav_bytes = _pcm_para_wav(audio)

                ogg = await _wav_para_ogg(wav_bytes)
                log.info(
                    "tts_audio_gerado",
                    modelo=modelo,
                    voz=settings.gemini_tts_voice,
                    bytes=len(ogg),
                )
                return ogg

            ultimo_erro = GeminiError(f"TTS não retornou áudio: {str(data)[:300]}")
            log.warning("tts_sem_audio", modelo=modelo)

        raise ultimo_erro or GeminiError("TTS não retornou áudio")
