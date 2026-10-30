#!/usr/bin/env bash
# Variáveis de ambiente iguais às do docker-compose para rodar código montado (sem rebuild).
# Uso: source scripts/dev/env.sh
set -a
. "$(dirname "$0")/../../.env"
set +a
export DEV_NET="${DEV_NET:-acessorimobi-v2_internal}"
export DEV_IMG="${DEV_IMG:-acessorimobi-v2-worker}"
DEV_ENV=(
  -e "DATABASE_URL=postgresql+asyncpg://acessor:${POSTGRES_PASSWORD}@postgres:5432/acessorimobi"
  -e "REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0"
  -e "MINIO_ENDPOINT=minio:9000" -e "MINIO_BUCKET_AUDIOS=audios"
  -e "OLLAMA_BASE_URL=http://ollama:11434" -e "WHISPER_BASE_URL=http://whisper:9000"
  -e "EVOLUTION_BASE_URL=http://evolution:8080" -e "PYTHONPATH=/app"
)
