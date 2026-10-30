"""
Gera as amostras de voz do portal (web/public/vozes/<id>.wav).

Requer o servidor TTS local no ar (scripts/qwen3_tts_server.py).
Uso: python scripts/gerar_amostras_voz.py [--url http://localhost:8010] [--forcar]
"""
import argparse
import sys
from pathlib import Path

import importlib.util
import json
import urllib.request

RAIZ = Path(__file__).resolve().parent.parent

# Carrega só o catálogo (sem dependências), já que roda no venv do servidor TTS.
_spec = importlib.util.spec_from_file_location("vozes", RAIZ / "app/integration/tts/vozes.py")
vozes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vozes)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8010")
    ap.add_argument("--forcar", action="store_true", help="regera amostras existentes")
    args = ap.parse_args()

    destino = RAIZ / "web" / "public" / "vozes"
    destino.mkdir(parents=True, exist_ok=True)

    for voz in vozes.listar_vozes():
        saida = destino / f"{voz['id']}.wav"
        if saida.exists() and not args.forcar:
            print(f"= {voz['id']} (já existe)")
            continue
        payload = {
            "text": vozes.FRASE_AMOSTRA,
            "speaker": voz["id"],
            "language": "Portuguese",
            "instruct": vozes.INSTRUCT_PADRAO,
        }
        req = urllib.request.Request(
            f"{args.url}/tts", data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=300) as resposta:
            saida.write_bytes(resposta.read())
        print(f"+ {voz['id']} -> {saida.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
