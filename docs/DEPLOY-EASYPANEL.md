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

## Atualizando uma instalação existente

Sempre nesta ordem, para o código novo não pedir coluna que ainda não existe:

1. No EasyPanel, **Implantar** (reconstrói `api`, `worker`, `scheduler` e `web`).
2. Logo depois, no terminal da VPS, aplique as migrações (todas são idempotentes):
   ```bash
   docker exec backend_quadra_acessor-imobi-api-1 alembic upgrade head   # (a API já faz isso sozinha ao subir; o comando serve para conferir ou repetir)
   ```
3. Recarregue o portal com Ctrl+Shift+R.

O que cada migração recente cria: `007` mídia das mensagens, `008` conversas do assistente,
`009` notas internas, `010` memória das conversas (pgvector), `011` integração e status do Imoview,
`012` configurações da imobiliária (dados, listas, localidades, tipos de atividade, roleta, lembretes),
`013` leads do Imoview (cliente sem responsável, telefone de busca, status da importação),
`014` funil automático (um negócio na etapa Lead para cada cliente, cadastro do Imoview em `dados_imoview`),
`015` foto do corretor vinda do perfil do WhatsApp, `016` fases do Imoview nos negócios, `017` Fluxo (conteúdo completo dos atendimentos: interações, interesses, visitas, propostas e negócios).

`018` modelos de book em PDF (os 3 de fábrica nascem na primeira abertura de Configurações → Books de imóveis). O deploy precisa **reconstruir a imagem** (novas dependências: reportlab e pillow).

A `017` zera a marca da última leitura do funil: depois do deploy, clique em **Ler atendimentos** (Configurações → Integrações → Funil de vendas) para preencher o conteúdo de todos os atendimentos. A etapa de cada negócio no Fluxo passa a ser deduzida desse conteúdo (lead → contato → qualificado → visita agendada/realizada → proposta → negociação; negócio realizado = ganho, descartado = perdido), com o espelho ligado por padrão. O mapa de fases 1–8 virou ajuste opcional.

## O que depende do Gemini

Com `LLM_PROVIDER=gemini` e `GEMINI_API_KEY` preenchida funcionam: o agente do WhatsApp, o assistente
do Início, o resumo das conversas e a **memória de longo prazo** (embeddings `gemini-embedding-001`).
Sem a chave, o agente cai nas respostas por regras e a memória fica desligada (a conversa segue só com
as mensagens recentes). Variáveis opcionais da memória: `MEMORIA_ATIVA`, `MEMORIA_K`, `MEMORIA_LIMIAR`,
`MEMORIA_TIMEOUT_S`, `MEMORIA_RESUMO_A_CADA`.

## Imoview

A URL base e a chave do Imoview **não** são mais pedidas ao criar a imobiliária no painel do
desenvolvedor: a própria imobiliária configura em **Configurações → Integrações** e pode testar a conexão
e sincronizar na hora. A sincronização automática continua a cada `IMOVIEW_SYNC_INTERVAL_MINUTES`.

### Leads do Imoview

Em **Configurações → Integrações → Clientes**, a imobiliária importa os leads do Imoview para a aba
**Clientes**. A primeira importação lê todos os leads (a API entrega 20 por página, então ~28 mil leads
levam alguns minutos) e pode ser acompanhada na tela ou deixada em segundo plano; se parar, retoma de
onde parou. Depois, o `scheduler` busca os novos a cada 30 minutos e confere tudo aos domingos 04:30
(dá para desligar na própria tela).

- Os leads entram **sem responsável**; na aba Clientes dá para atribuir um a um, em lote ou pela roleta.
- Se o telefone já existe em um cliente (por exemplo, anotado pelo corretor no WhatsApp), o lead é
  vinculado a ele, sem duplicar, e o responsável é mantido.
- CPF e CNPJ **não** são importados (LGPD).

Depois de aplicar a 014, clique em **Reimportar tudo** (Configurações → Integrações → Clientes) uma vez
para preencher o cadastro completo dos leads já importados. A foto dos corretores é buscada no WhatsApp
quando há sessão conectada; sem foto, aparecem as iniciais.

### Link dos imóveis e funil do Imoview

- Preencha **Configurações → Dados da imobiliária → Site** (ex.: `https://www.quadrabrasileira.com.br`):
  os imóveis passam a ter o link `{site}/imovel/{título}/{código}`, no cache e nas mensagens.
- **Configurações → Integrações → Funil de vendas**: leia os atendimentos do Imoview, ligue cada fase
  (1 a 8) a uma etapa do portal e ative o espelho. O sentido portal → Imoview fica como pendência até
  haver o código de acesso de um usuário do Imoview.
