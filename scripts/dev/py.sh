#!/usr/bin/env bash
# Roda um comando Python/pytest na rede do compose com o código desta pasta montado.
# Uso: scripts/dev/py.sh python -m pytest tests -q   |   scripts/dev/py.sh python meu_script.py
cd "$(dirname "$0")/../.." || exit 1
source scripts/dev/env.sh
exec docker run --rm -i --network "$DEV_NET" --env-file .env "${DEV_ENV[@]}" -v "$PWD":/app -w /app "$DEV_IMG" "$@"
