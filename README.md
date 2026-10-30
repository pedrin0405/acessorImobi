# acessorImobi v2

Plataforma multi-tenant de suporte operacional a corretores de imóveis via WhatsApp com inteligência artificial local e integração com o CRM Imoview (Universal Software).

---

## 🏛️ Arquitetura

- **API (`api:8000`)**: FastAPI. Ingestão de webhooks, roteamento, portais e painel administrativo. Não chama IA diretamente.
- **Worker (`worker`)**: Processamento assíncrono particionado por conversa com locks distribuídos via Redis. Único processo que interage com os modelos de IA.
- **Scheduler (`scheduler`)**: Sincronização incremental do Imoview a cada 30min, expurgo LGPD diário, retries de CRM a cada 5min e health check do WhatsApp a cada 2min.
- **Web (`web:3000`)**: Next.js 14 standalone com Tailwind CSS atendendo aos três portais por subdomínio:
  - `admin.acessorimobi.com.br`: Painel do Desenvolvedor
  - `{tenant}.acessorimobi.com.br`: Portal da Imobiliária
  - `corretor.acessorimobi.com.br`: Portal do Corretor
- **Banco de Dados**: PostgreSQL 16 com extensão `pgvector` e Row Level Security (RLS) mandatória por tenant.
- **Mensageria**: Redis 7 (filas particionadas, locks distribuídos e cache de TTLs curtos).
- **IA**: Gemini como provedor principal de chat (Ollama local como alternativa), Whisper ASR para transcrição de áudios e Qwen3-TTS local para respostas em voz (fallback Gemini TTS).
- **WhatsApp**: Evolution API v2 (`v2.3.7`, instâncias dedicadas por tenant).

---

## 🚀 Como Iniciar

### 1. Configurar variáveis de ambiente
Copie o arquivo de exemplo e defina as chaves de segurança:
```bash
cp .env.example .env
```
Gere as chaves de segurança necessárias:
```bash
python3 -c "import secrets; print('SECRET_KEY=' + secrets.token_hex(32))"
python3 -c "import secrets; print('ENCRYPTION_KEY=' + secrets.token_hex(32))"
```

### 2. Subir a stack com Docker Compose
```bash
docker compose up -d --build
```

### 3. Verificar status dos serviços
```bash
docker compose ps
curl http://localhost:8000/health
```

### 4. Aplicar as migrações do banco
O `init.sql` cria o esquema base na primeira subida do Postgres. Tabelas novas
(como as do CRM) vêm por migração Alembic:
```bash
docker compose exec api alembic upgrade head
```

---

## 🔐 Acesso aos Portais

| Portal | URL | Credencial |
|---|---|---|
| Desenvolvedor | `admin.{BASE_DOMAIN}` | Senha definida em `DEV_PANEL_PASSWORD` |
| Imobiliária | `{tenant}.{BASE_DOMAIN}` | E-mail + senha do administrador criado no provisionamento |
| Corretor | `corretor.{BASE_DOMAIN}` | WhatsApp cadastrado (precisa estar `active`) + código de 6 dígitos enviado pelo WhatsApp do agente |

O provisionamento de um tenant cria, opcionalmente, o administrador inicial da imobiliária.
Para tenants já existentes, use:

```bash
curl -X POST https://api.$BASE_DOMAIN/dev/tenants/{tenant_id}/admins \
  -H "Authorization: Bearer $TOKEN_DEV" \
  -H "Content-Type: application/json" \
  -d '{"nome":"Maria","email":"maria@imob.com","senha":"senha-forte"}'
```

> ⚠️ Troque `DEV_PANEL_PASSWORD` em produção. O valor padrão `admin123` existe apenas para o primeiro acesso em desenvolvimento.

---

## 🏢 Portal da Imobiliária

Depois de entrar com o administrador do tenant, o portal oferece:

### Cadastro manual de corretor
Na aba **Corretores**, clique em **Novo Corretor** e informe nome, WhatsApp e e-mail (opcional).
O corretor é criado já `active` e pode entrar no Portal do Corretor usando o telefone cadastrado.
Se o telefone já existir como `pending`, `rejected` ou `blocked`, o cadastro é promovido a `active`.
Telefones duplicados ativos retornam `409`.

### Conversas (preview estilo WhatsApp)
Na aba **Conversas**, o administrador acompanha as mensagens trocadas entre o agente Acessor e os corretores:

- lista de conversas com última mensagem, horário e quantidade de mensagens não respondidas;
- chat com bolhas de entrada (corretor) e saída (agente), no estilo WhatsApp;
- atualização automática da lista a cada 8s e botão **Atualizar** para recarregar o histórico;
- acesso ao conteúdo registrado na auditoria append-only (`visualizar_conversa`).

### Conexão do WhatsApp do agente
Na aba **WhatsApp**, o administrador pode:

- ver o status da instância (`connected`, `qr_pending`, `disconnected`);
- gerar o QR code e parear o celular do agente;
- acompanhar automaticamente a conclusão do pareamento (polling a cada 4s);
- desconectar o número sem apagar a instância.

O QR code é retornado pela Evolution API e persistido em `whatsapp_sessions.qr_code`.
Quando o WhatsApp é conectado (ou desconectado), o QR é limpo automaticamente.

> A stack usa `evoapicloud/evolution-api:v2.3.7`. Versões antigas do Baileys
> (como a v2.2.3) não conseguem mais gerar QR code compatível com o WhatsApp atual.
> Para recriar uma instância com QR expirado, o serviço remove e provisiona novamente
> a instância com o mesmo nome e webhook.

### Agente Acessor

O agente responde pelo número conectado na aba WhatsApp. O pipeline é:

1. Evolution recebe a mensagem e chama `POST /webhook/{instance_id}`;
2. a API resolve o tenant pela instância, extrai o telefone real (inclusive quando o
   WhatsApp usa endereçamento **LID**, lendo `remoteJidAlt`), deduplica e persiste;
3. o worker consome a fila da conversa, monta o contexto e responde;
4. a resposta é enviada pela Evolution e também persistida como `outbound`.

O worker usa um roteador determinístico para saudações, testes de conexão, busca de
imóveis, consulta de clientes, cadastro e taxas. Mensagens ambíguas são enviadas ao
provedor configurado em `LLM_PROVIDER` (Gemini por padrão; Ollama local como
alternativa). Com `LLM_PROVIDER=ollama`, use modelos leves (`llama3.2:1b` ou
`llama3.2:3b`) e mantenha `OLLAMA_TIMEOUT_SECONDS` compatível com o tempo de geração.

Para reativar o Ollama (desligado momentaneamente):

```bash
docker compose start ollama
# e ajuste LLM_PROVIDER=ollama no .env, seguido de:
docker compose up -d worker
```

### Carteira, funil e agenda (CRM do corretor)

O corretor alimenta o CRM conversando com o agente pelo WhatsApp:

| O corretor diz | O agente faz |
|---|---|
| "anota a Ana, quer alugar apê de 2 quartos na Orla até 3 mil" | cria o cliente com perfil de busca |
| "o que combina com a Ana?" | cruza o perfil com a carteira do Imoview e manda as fotos |
| "abre um negócio pra Ana de 900 mil, já em proposta" | abre o negócio no funil |
| "a Ana fechou" / "perdemos a Ana, achou caro" | marca ganho ou perdido (perda pede motivo) |
| "marca visita com a Ana amanhã às 10h no 16992" | agenda e lembra o corretor 1 hora antes |
| "minha agenda" / "meus negócios" | lista compromissos e o funil com a previsão |

- **Aprovação:** com "Confirmar antes de gravar" ligado (padrão, na aba Agente), o agente
  mostra o que vai gravar e só grava depois do "sim". Uma mensagem que não é "sim" nem
  "não" descarta a proposta e segue como conversa normal.
- **Funil padrão:** Lead (5%), Contato feito (15%), Qualificado (30%), Visita agendada (50%),
  Visita realizada (60%), Proposta (70%) e Negociação (85%). A previsão é valor × probabilidade.
  Negócio parado além do limite da etapa (padrão 14 dias) vira alerta.
- **Briefing diário:** ao abrir o horário comercial do tenant, cada corretor recebe no
  WhatsApp a agenda do dia, as atividades atrasadas, os negócios parados e os imóveis novos
  que combinam com seus clientes. Sem novidade, nada é enviado.
- **Portal da imobiliária:** abas **Negociações** (Kanban com arrastar, Lista, Previsão,
  configuração das etapas e **Novo negócio**), **Agenda** (com **Nova atividade**) e
  **Clientes** (perfil de busca e imóveis compatíveis).
- **Aba Agente:** tom de voz com exemplo, especialidades, público-alvo, palavras proibidas
  (removidas da resposta se escaparem), nota de marca (até 1000 caracteres), memória em itens
  e persona livre em "avançado".

### Assistente pessoal do corretor (WhatsApp pessoal)

São dois números com papéis diferentes:

- **Número do agente** (aba WhatsApp da imobiliária): o corretor conversa com o agente de suporte.
- **Número pessoal do corretor** (Portal do Corretor → Meu WhatsApp): o corretor conecta o
  próprio WhatsApp, por QR code ou código de pareamento, para o assistente **acompanhar** os
  atendimentos com clientes. O assistente **nunca envia mensagens por esse número** nem fala
  com clientes; ele ajuda o corretor a vender.

Ao conectar, o assistente importa as conversas individuais dos **últimos 3 dias** (e, a cada
2 minutos, o que faltar), analisando primeiro as 30 mais recentes. Avisos proativos só saem
para mensagens do cliente de até 3 horas, para não disparar alertas de conversas antigas.

O que o assistente faz com as conversas (individuais; grupos e a conversa com o agente ficam de fora):

1. alguns minutos depois da última mensagem (`ASSISTENTE_ANALISE_ATRASO_MIN`, padrão 5),
   o worker analisa o atendimento: se é imobiliário, resumo, o que o cliente procura,
   objeções, pendências, temperatura, próximo passo e uma sugestão de resposta;
2. liga o atendimento ao cliente da carteira pelo telefone, ou cria o cliente com o perfil;
3. se o cliente está esperando resposta, avisa o corretor **pelo número do agente**, no
   horário comercial, com a sugestão pronta para copiar. Fatos que só o corretor sabe
   (preço, FGTS, horário) aparecem como `[confirmar …]`, nunca inventados;
4. pelo agente, o corretor pede "meus atendimentos", "resume o atendimento com a Ana" e
   "o que respondo pra Ana?".

Privacidade: só o próprio corretor vê os atendimentos (a imobiliária não), a conexão exige
consentimento no portal, o número conectado precisa ser o mesmo cadastrado (outro número é
desconectado antes de qualquer leitura) e as mensagens seguem a retenção de 180 dias.
O corretor pode desligar o assistente, os avisos ou a carteira automática a qualquer momento.

### Voz (TTS)

As respostas em áudio usam o **Qwen3-TTS 1.7B** rodando localmente no Mac (Apple
Silicon/MPS), com o Gemini TTS como fallback. O modelo roda fora do Docker porque o
Docker no macOS não acessa a GPU Metal.

Iniciar o servidor local (carrega o modelo em ~20s):

```bash
~/.venvs/qwen3-tts/bin/python scripts/qwen3_tts_server.py
# health: curl http://127.0.0.1:8010/health
# parar: Ctrl+C (ou: pkill -f qwen3_tts_server.py)
```

O worker acessa `http://host.docker.internal:8010`. O servidor escuta em
`0.0.0.0` para ser alcançável pelo Docker; em redes compartilhadas, defina
`QWEN3_TTS_TOKEN` no servidor e no `.env` para exigir autenticação. Configuração:

```text
TTS_PROVIDER=auto          # auto = Qwen3 e, se falhar, Gemini; ou qwen3 / gemini
QWEN3_TTS_SPEAKER=Serena   # vozes: aiden, dylan, eric, ono_anna, ryan,
                           #        serena, sohee, uncle_fu, vivian
QWEN3_TTS_LANGUAGE=Portuguese
QWEN3_TTS_MAX_CHARS=500    # falas curtas: ~3-5x o tempo real no M4
```

Com `VOICE_REPLY_MODE=always`, toda resposta também vira áudio; com `mirror`, a
resposta é em áudio quando o corretor envia áudio e, de vez em quando, também em
mensagens de texto (`VOICE_REPLY_AUDIO_CHANCE=0.2`). O texto (e as fotos) é enviado
primeiro; o áudio vem depois como complemento. Se o servidor local estiver parado e
`TTS_PROVIDER=auto`, o áudio é gerado pelo Gemini (sujeito à cota diária do plano
gratuito); se ambos falharem, a resposta segue em texto.

### Consumo de APIs no painel do desenvolvedor

O worker registra cada chamada ao Gemini (chat e TTS) na tabela `api_usage`, com
requisições, erros, tokens e caracteres por dia/modelo. O endpoint
`GET /dev/usage?dias=7` alimenta o card **Consumo de APIs** em `/admin`:

```text
GEMINI_CHAT_DAILY_LIMIT=200   # 0 = sem limite configurado
GEMINI_TTS_DAILY_LIMIT=10
USAGE_TIMEZONE=America/Sao_Paulo
```

O painel mostra barra de progresso, percentual e um alerta quando o limite diário
é atingido. A tabela é criada automaticamente na primeira gravação e também está
em `infra/postgres/init.sql`.

### Diagnóstico de webhooks da Evolution

Dentro do container da Evolution, `localhost` e `127.0.0.1` apontam para o próprio
container. Como `evolution` e `api` estão na mesma rede bridge (`acessorimobi-v2_internal`),
a URL do webhook deve usar o nome do serviço:

```text
http://api:8000/webhook/inst_quadra-brasileira
```

Não use `172.17.0.1` (gateway da bridge padrão, que não é a rede desta stack) nem
`localhost`. O Traefik também funcionaria, mas exigiria o `Host` correto e TLS; o nome
do serviço é o caminho mais simples e estável.

Conferir a configuração efetiva da instância:

```bash
docker compose exec -T evolution sh -c \
  'wget -qO- --header="apikey: $AUTHENTICATION_API_KEY" \
   http://localhost:8080/webhook/find/inst_quadra-brasileira'
```

Atualizar a URL (o corpo abaixo preserva os eventos já usados pelo agente):

```bash
docker compose exec -T evolution sh -c \
  'wget -qO- --header="apikey: $AUTHENTICATION_API_KEY" \
   --header="Content-Type: application/json" \
   --post-data="{\"webhook\":{\"enabled\":true,\"url\":\"http://api:8000/webhook/inst_quadra-brasileira\",\"byEvents\":false,\"base64\":false,\"events\":[\"MESSAGES_UPSERT\"]}}" \
   http://localhost:8080/webhook/set/inst_quadra-brasileira'
```

Testar a conectividade e o endpoint a partir do container da Evolution:

```bash
docker compose exec -T evolution wget -qO- http://api:8000/health
```

Em operação normal o log da Evolution fica em `ERROR`, então envios bem-sucedidos não
aparecem. Para diagnosticar, suba temporariamente com `INFO` ou `DEBUG`:

```bash
EVOLUTION_LOG_LEVEL=INFO docker compose up -d evolution
docker compose logs -f evolution | grep -iE 'webhook|ECONNREFUSED|ETIMEDOUT|timeout|api:8000'
```

O `202 Accepted` devolvido pela API significa apenas que o evento foi recebido; o
processamento ocorre em background. Confirme o restante do fluxo nos logs da API
(`mensagem_enfileirada`) e do worker (`conversa_processada`). Se a API descartar o
evento, ela registra o motivo, por exemplo `webhook_telefone_invalido` ou
`webhook_instance_sem_tenant`.

> O WhatsApp ainda pode entregar JIDs móveis no formato antigo, sem o nono dígito
> (ex.: `556392185349` para `+5563992185349`). `normalize_phone` converte esse formato
> automaticamente; sem isso o webhook chega, mas a mensagem é descartada.

### Portal do Corretor — Conversas

A aba **Conversas** exibe o histórico do próprio corretor com o agente, em ordem
cronológica e com bolhas estilo WhatsApp. O corretor vê apenas as próprias mensagens
e o painel é somente leitura; novas mensagens são enviadas pelo WhatsApp.

---

## 🔒 Segurança e LGPD

1. **Isolamento de Dados**: Todo acesso ao banco de dados executa `SET LOCAL app.tenant_id = '{tenant_id}'`, ativando as políticas de RLS.
2. **Criptografia em Repouso**: Chaves de API e credenciais do Imoview são cifradas com AES-256-GCM antes de serem salvas no Postgres.
3. **Auditoria Append-Only**: Tabelas de auditoria possuem regras rígidas no PostgreSQL que anulam qualquer tentativa de `UPDATE` ou `DELETE`.
4. **Logs Sem PII**: Telefones são mascarados (`+55***88`) e e-mails são hasheados com SHA-256 antes de qualquer registro em log.
