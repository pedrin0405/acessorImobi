#!/usr/bin/env bash
# Sobe uma API de desenvolvimento com o código desta pasta (recarrega ao salvar).
# Uso: scripts/dev/api.sh <porta-local> <nome>      Ex.: scripts/dev/api.sh 8002 api-imoveis
# Para parar: docker rm -f <nome>
cd "$(dirname "$0")/../.." || exit 1
source scripts/dev/env.sh
PORTA="${1:?porta}"; NOME="${2:?nome}"
docker rm -f "$NOME" >/dev/null 2>&1
docker run -d --name "$NOME" --network "$DEV_NET" --env-file .env "${DEV_ENV[@]}" \
  -p "127.0.0.1:${PORTA}:8000" -v "$PWD":/app -w /app "$DEV_IMG" \
  uvicorn app.api.main:app --host 0.0.0.0 --port 8000 --reload >/dev/null && echo "API em http://localhost:${PORTA}"
