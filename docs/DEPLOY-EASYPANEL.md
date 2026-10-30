# Deploy no EasyPanel (VPS Hostinger)

O arquivo `docker-compose.easypanel.yml` é o `docker-compose.yml` sem o Traefik
(o EasyPanel já faz proxy e HTTPS), sem `container_name`, sem portas publicadas
e com o Ollama opcional (o LLM padrão é o Gemini).

## 1. Serviço

1. No EasyPanel, crie um projeto e adicione um serviço **Compose**.
2. Fonte: **GitHub**, repositório `pedrin0405/acessorImobi`, branch `main`.
3. Caminho do compose: `docker-compose.easypanel.yml`.

## 2. Variáveis de ambiente (aba Environment)

Copie o `.env.example` e **gere valores novos** para tudo que for segredo
(não reaproveite os do ambiente local):

| Variável | Observação |
|---|---|
| `BASE_DOMAIN` | domínio raiz, ex.: `acessorimobi.com.br` |
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | senhas novas |
| `EVOLUTION_API_KEY`, `SECRET_KEY`, `ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `DEV_PANEL_PASSWORD` | **nunca** deixe `admin123` |
| `GEMINI_API_KEY` | chave do AI Studio |
| `LLM_PROVIDER` | `gemini` |
| `TTS_PROVIDER` | `gemini` (o Qwen3 local roda só no Mac, não na VPS) |
| `WHISPER_MODEL` | `small` (padrão aqui); `medium` exige mais CPU/RAM |
| `ENVIRONMENT` | `production` |

`DATABASE_URL`, `REDIS_URL`, `MINIO_*` e as URLs internas são montadas pelo
próprio compose.

## 3. Domínios (aba Domains)

Aponte o DNS (registro A) de cada nome para o IP da VPS e associe ao serviço:

| Domínio | Serviço : porta |
|---|---|
| `admin.<BASE_DOMAIN>` | `web` : 3000 |
| `corretor.<BASE_DOMAIN>` | `web` : 3000 |
| `*.<BASE_DOMAIN>` (portais das imobiliárias, wildcard) | `web` : 3000 |
| `api.<BASE_DOMAIN>` | `api` : 8000 |
| `evo.<BASE_DOMAIN>` | `evolution` : 8080 |
| `storage.<BASE_DOMAIN>` (opcional) | `minio` : 9000 |

O wildcard precisa de DNS `*.<BASE_DOMAIN>` e, para HTTPS, certificado
wildcard (DNS-01) ou um domínio por imobiliária.

## 4. Depois do primeiro deploy

No console do serviço `api`:

```bash
alembic upgrade head
```

Confira `https://api.<BASE_DOMAIN>/health` e entre em `admin.<BASE_DOMAIN>`.

## Limitações na VPS

- **Voz Qwen3 / clonagem:** dependem de GPU/MPS e do servidor `scripts/qwen3_tts_server.py`;
  na VPS o áudio sai pelo Gemini TTS (limite diário do plano) ou em texto.
- **Whisper** roda em CPU: prefira `small` e uma VPS com 4+ GB de RAM livres.
- **Ollama** fica desligado; ative com `COMPOSE_PROFILES=ollama` só se precisar.
