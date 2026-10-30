#!/usr/bin/env python3
"""
Servidor HTTP local do Qwen3-TTS (Apple Silicon/MPS ou CPU).

Mantém o modelo carregado em memória e expõe:

    GET  /health  -> {"status": "loading"|"ready"|"error", ...}
    POST /tts     -> {"text": "...", "speaker": "Serena", "language": "Portuguese"}
                     resposta: audio/wav (PCM 16-bit, 24 kHz)

O worker da aplicação (Docker) acessa via host.docker.internal:8010 e converte
o WAV para OGG/Opus antes de enviar no WhatsApp.

Uso:
    ~/.venvs/qwen3-tts/bin/python scripts/qwen3_tts_server.py
    ~/.venvs/qwen3-tts/bin/python scripts/qwen3_tts_server.py --port 8010 --device mps

Variáveis de ambiente equivalentes às flags:
    QWEN3_TTS_MODEL, QWEN3_TTS_HOST, QWEN3_TTS_PORT, QWEN3_TTS_DEVICE,
    QWEN3_TTS_SPEAKER, QWEN3_TTS_LANGUAGE, QWEN3_TTS_MAX_CHARS,
    QWEN3_TTS_TOKEN (opcional; exige Authorization: Bearer <token>)
"""
import argparse
import io
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional

MODELO_PADRAO = os.path.expanduser(
    "~/.cache/qwen3-tts/Qwen3-TTS-12Hz-1.7B-CustomVoice"
)

# Modelo Base (clonagem de voz). Carregado só no primeiro pedido de clone, para
# não ocupar RAM quando ninguém usa voz clonada.
CLONE_MODELO_PADRAO = os.path.expanduser(
    os.getenv("QWEN3_TTS_CLONE_MODEL", "~/.cache/qwen3-tts/Qwen3-TTS-12Hz-0.6B-Base")
)
MAX_CORPO_BYTES = 3_000_000  # áudio de referência em base64

estado_clone: Dict[str, Any] = {"modelo": None, "prompts": {}}
lock_clone = threading.Lock()

estado: Dict[str, Any] = {
    "status": "loading",
    "erro": None,
    "modelo": None,
    "device": None,
    "dtype": None,
    "carregado_em": None,
    "speakers": [],
    "languages": [],
    "carregando_desde": time.time(),
}
lock_carga = threading.Lock()
lock_inferencia = threading.Lock()

config: Dict[str, Any] = {
    "modelo": MODELO_PADRAO,
    "clone_modelo": CLONE_MODELO_PADRAO,
    "speaker": "Serena",
    "language": "Portuguese",
    "max_chars": 2000,
    "token": "",
    "device": "auto",
}


def _detectar_device(pedido: str) -> str:
    import torch

    pedido = (pedido or "auto").lower()
    if pedido != "auto":
        return pedido
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def carregar_modelo() -> None:
    """Carrega o modelo uma única vez; roda em thread separada."""
    global estado
    with lock_carga:
        if estado["modelo"] is not None:
            return
        inicio = time.time()
        try:
            import torch
            from qwen_tts import Qwen3TTSModel

            device = _detectar_device(config["device"])
            dtype = torch.bfloat16 if device in ("mps", "cuda") else torch.float32

            print(
                f"[qwen3-tts] carregando {config['modelo']} "
                f"(device={device}, dtype={dtype})...",
                flush=True,
            )
            modelo = Qwen3TTSModel.from_pretrained(
                config["modelo"],
                device_map=device,
                dtype=dtype,
                attn_implementation="sdpa",
            )

            estado.update(
                {
                    "status": "ready",
                    "erro": None,
                    "modelo": modelo,
                    "device": device,
                    "dtype": str(dtype).replace("torch.", ""),
                    "carregado_em": round(time.time() - inicio, 1),
                    "speakers": modelo.get_supported_speakers() or [],
                    "languages": modelo.get_supported_languages() or [],
                }
            )
            print(
                f"[qwen3-tts] modelo pronto em {estado['carregado_em']}s "
                f"| speakers={estado['speakers']}",
                flush=True,
            )
        except Exception as e:  # noqa: BLE001 - servidor precisa reportar qualquer falha
            estado.update({"status": "error", "erro": f"{type(e).__name__}: {e}"})
            print(f"[qwen3-tts] ERRO ao carregar modelo: {estado['erro']}", flush=True)


def _truncar(texto: str, limite: int) -> str:
    texto = " ".join((texto or "").split())
    if len(texto) <= limite:
        return texto
    return texto[:limite].rsplit(" ", 1)[0].rstrip(" ,.;:") + "."


class CloneIndisponivel(Exception):
    """Modelo Base de clonagem ausente ou que não carregou."""


def _carregar_clone():
    """Carrega o modelo Base uma vez (thread-safe)."""
    with lock_clone:
        if estado_clone["modelo"] is not None:
            return estado_clone["modelo"]
        caminho = config["clone_modelo"]
        if not os.path.isdir(caminho):
            raise CloneIndisponivel(
                f"modelo de clonagem não instalado em {caminho} "
                "(baixe Qwen/Qwen3-TTS-12Hz-0.6B-Base ou defina QWEN3_TTS_CLONE_MODEL)"
            )
        import torch
        from qwen_tts import Qwen3TTSModel

        device = estado["device"] or _detectar_device(config["device"])
        dtype = torch.bfloat16 if device in ("mps", "cuda") else torch.float32
        inicio = time.time()
        print(f"[qwen3-tts] carregando modelo de clonagem {caminho}...", flush=True)
        try:
            estado_clone["modelo"] = Qwen3TTSModel.from_pretrained(
                caminho, device_map=device, dtype=dtype, attn_implementation="sdpa"
            )
        except Exception as e:  # noqa: BLE001
            raise CloneIndisponivel(f"falha ao carregar o modelo de clonagem: {e}") from e
        print(f"[qwen3-tts] clonagem pronta em {time.time() - inicio:.1f}s", flush=True)
        return estado_clone["modelo"]


def gerar_wav_clone(texto: str, language: str, ref_audio_b64: str, ref_text: str) -> bytes:
    """Fala `texto` com a voz do áudio de referência (WAV PCM 16-bit em memória)."""
    import hashlib

    import soundfile as sf

    modelo = _carregar_clone()
    languages = {l.lower(): l for l in (modelo.get_supported_languages() or [])}
    language_final = languages.get((language or "").lower()) or "Auto"

    # Extrair o embedding da referência é a parte cara; reaproveita por voz.
    chave = hashlib.sha1((ref_audio_b64 + "\0" + ref_text).encode()).hexdigest()
    prompts = estado_clone["prompts"]
    if chave not in prompts:
        if len(prompts) >= 8:
            prompts.pop(next(iter(prompts)))
        prompts[chave] = modelo.create_voice_clone_prompt(
            ref_audio=ref_audio_b64, ref_text=ref_text, x_vector_only_mode=not ref_text
        )

    wavs, taxa = modelo.generate_voice_clone(
        text=texto,
        language=language_final,
        voice_clone_prompt=prompts[chave],
        non_streaming_mode=True,
    )
    buffer = io.BytesIO()
    sf.write(buffer, wavs[0], taxa, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


def gerar_wav(texto: str, speaker: str, language: str, instruct: str = "") -> bytes:
    """Gera o áudio e devolve um WAV PCM 16-bit em memória."""
    import soundfile as sf

    modelo = estado["modelo"]
    if modelo is None:
        raise RuntimeError("modelo ainda não carregado")

    speakers = {s.lower(): s for s in estado["speakers"]}
    languages = {l.lower(): l for l in estado["languages"]}
    speaker_final = speakers.get((speaker or "").lower())
    language_final = languages.get((language or "").lower())
    if not speaker_final:
        raise ValueError(
            f"speaker inválido: {speaker!r}; use um de {estado['speakers']}"
        )
    if not language_final:
        raise ValueError(
            f"language inválido: {language!r}; use um de {estado['languages']}"
        )

    wavs, taxa = modelo.generate_custom_voice(
        text=texto,
        speaker=speaker_final,
        language=language_final,
        instruct=instruct or None,
        non_streaming_mode=True,
    )
    buffer = io.BytesIO()
    sf.write(buffer, wavs[0], taxa, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


class Handler(BaseHTTPRequestHandler):
    server_version = "Qwen3TTS/1.0"

    def log_message(self, formato: str, *args: Any) -> None:
        print(
            f"[qwen3-tts] {self.address_string()} "
            f"{formato % args}",
            flush=True,
        )

    # ------------------------------------------------------------------ utils
    def _json(self, status: int, dados: Dict[str, Any]) -> None:
        corpo = json.dumps(dados, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def _autorizado(self) -> bool:
        token = config["token"]
        if not token:
            return True
        recebido = self.headers.get("Authorization", "")
        return recebido == f"Bearer {token}"

    # ---------------------------------------------------------------- routing
    def do_GET(self) -> None:  # noqa: N802 - API do http.server
        if self.path.split("?", 1)[0] not in ("/health", "/"):
            self._json(404, {"error": "rota não encontrada"})
            return

        resposta = {
            "status": estado["status"],
            "modelo": config["modelo"],
            "device": estado["device"],
            "dtype": estado["dtype"],
            "carregado_em": estado["carregado_em"],
            "speakers": estado["speakers"],
            "languages": estado["languages"],
            "clonagem": {
                "instalada": os.path.isdir(config["clone_modelo"]),
                "carregada": estado_clone["modelo"] is not None,
                "modelo": config["clone_modelo"],
            },
        }
        if estado["erro"]:
            resposta["erro"] = estado["erro"]
        if estado["status"] != "ready":
            resposta["carregando_desde_segundos"] = round(
                time.time() - estado["carregando_desde"], 1
            )
        self._json(200 if estado["status"] != "error" else 500, resposta)

    def do_POST(self) -> None:  # noqa: N802 - API do http.server
        if self.path.split("?", 1)[0] != "/tts":
            self._json(404, {"error": "rota não encontrada"})
            return
        if not self._autorizado():
            self._json(401, {"error": "token inválido"})
            return

        try:
            tamanho = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            tamanho = 0
        if tamanho <= 0 or tamanho > MAX_CORPO_BYTES:
            self._json(400, {"error": "Content-Length inválido"})
            return

        try:
            dados = json.loads(self.rfile.read(tamanho).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._json(400, {"error": "JSON inválido"})
            return
        if not isinstance(dados, dict):
            self._json(400, {"error": "corpo deve ser um objeto JSON"})
            return

        texto = _truncar(str(dados.get("text") or ""), config["max_chars"])
        if not texto:
            self._json(400, {"error": "texto vazio"})
            return

        if estado["status"] == "loading":
            self.send_response(503)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Retry-After", "10")
            corpo = json.dumps(
                {
                    "error": "modelo carregando",
                    "carregando_desde_segundos": round(
                        time.time() - estado["carregando_desde"], 1
                    ),
                }
            ).encode("utf-8")
            self.send_header("Content-Length", str(len(corpo)))
            self.end_headers()
            self.wfile.write(corpo)
            return
        if estado["status"] != "ready":
            self._json(503, {"error": estado["erro"] or "modelo indisponível"})
            return

        speaker = str(dados.get("speaker") or config["speaker"])
        language = str(dados.get("language") or config["language"])
        instruct = str(dados.get("instruct") or "").strip()[:300]
        ref_audio = str(dados.get("ref_audio") or "")
        ref_text = str(dados.get("ref_text") or "").strip()

        # Uma inferência por vez: o modelo não é thread-safe e satura a GPU.
        if not lock_inferencia.acquire(timeout=30):
            self._json(429, {"error": "servidor ocupado, tente novamente"})
            return

        inicio = time.time()
        try:
            if ref_audio:
                wav = gerar_wav_clone(texto, language, ref_audio, ref_text)
            else:
                wav = gerar_wav(texto, speaker, language, instruct)
        except CloneIndisponivel as e:
            self._json(503, {"error": str(e)})
            return
        except ValueError as e:
            self._json(400, {"error": str(e)})
            return
        except Exception as e:  # noqa: BLE001 - devolver erro ao cliente
            print(f"[qwen3-tts] erro na inferência: {e}", flush=True)
            self._json(500, {"error": f"{type(e).__name__}: {e}"})
            return
        finally:
            lock_inferencia.release()

        duracao = round(time.time() - inicio, 1)
        print(
            f"[qwen3-tts] gerado: {len(texto)} chars, speaker={speaker}, "
            f"{len(wav) / 1024:.0f} KiB em {duracao}s",
            flush=True,
        )
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(wav)))
        self.send_header("X-Generation-Seconds", str(duracao))
        self.end_headers()
        self.wfile.write(wav)


def main() -> None:
    parser = argparse.ArgumentParser(description="Servidor local Qwen3-TTS")
    parser.add_argument(
        "--model",
        default=os.getenv("QWEN3_TTS_MODEL", MODELO_PADRAO),
    )
    parser.add_argument(
        "--clone-model",
        default=CLONE_MODELO_PADRAO,
        help="Modelo Base para clonar vozes (opcional; carregado no primeiro uso)",
    )
    parser.add_argument("--host", default=os.getenv("QWEN3_TTS_HOST", "0.0.0.0"))
    parser.add_argument(
        "--port", type=int, default=int(os.getenv("QWEN3_TTS_PORT", "8010"))
    )
    parser.add_argument(
        "--device",
        default=os.getenv("QWEN3_TTS_DEVICE", "auto"),
        help="auto, mps, cuda ou cpu",
    )
    parser.add_argument(
        "--speaker", default=os.getenv("QWEN3_TTS_SPEAKER", "Serena")
    )
    parser.add_argument(
        "--language", default=os.getenv("QWEN3_TTS_LANGUAGE", "Portuguese")
    )
    parser.add_argument(
        "--max-chars",
        type=int,
        default=int(os.getenv("QWEN3_TTS_MAX_CHARS", "2000")),
    )
    parser.add_argument(
        "--token",
        default=os.getenv("QWEN3_TTS_TOKEN", ""),
        help="Se definido, exige Authorization: Bearer <token>",
    )
    args = parser.parse_args()

    config.update(
        {
            "modelo": os.path.expanduser(args.model),
            "clone_modelo": os.path.expanduser(args.clone_model),
            "speaker": args.speaker,
            "language": args.language,
            "max_chars": args.max_chars,
            "token": args.token,
            "device": args.device,
        }
    )

    threading.Thread(target=carregar_modelo, daemon=True).start()

    servidor = ThreadingHTTPServer((args.host, args.port), Handler)
    print(
        f"[qwen3-tts] escutando em http://{args.host}:{args.port} "
        f"(health: /health)",
        flush=True,
    )
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\n[qwen3-tts] encerrando...", flush=True)
    finally:
        servidor.server_close()


if __name__ == "__main__":
    main()
