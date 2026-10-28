acessorImobi — Especificação da Plataforma
1. Definição e escopo
O acessorImobi é uma ferramenta interna de suporte à operação imobiliária. O corretor conversa por WhatsApp com um agente de IA que consulta imóveis, consulta e atualiza clientes no CRM da imobiliária, tira dúvidas e traz dados de mercado. A imobiliária administra seus corretores e seu agente.

O que o sistema é

Um assistente operacional que responde apenas ao corretor e à imobiliária.
Uma camada de leitura e escrita sobre o Imoview, com cache próprio e histórico de conversa.
Multitenant por natureza: cada imobiliária é um tenant com número, agente, configuração e dados isolados.
O que o sistema não é

Não é CRM. Não é fonte da verdade de imóveis, clientes ou propostas.
Não fala com o lead ou cliente final. Nenhuma mensagem sai do sistema para quem não é corretor ou administrador da imobiliária.
Não faz disparo em massa, campanha, follow-up automático nem qualificação de lead.
Não substitui o Imoview. Se o Imoview cai, o sistema consulta cache e declara a degradação.
Essa fronteira é o que mantém o escopo sob controle. Toda funcionalidade que exija conversar com o cliente final está fora, por definição.

2. Atores e superfícies
Quatro superfícies distintas, com domínios e permissões separados:

Painel do Desenvolvedor (admin.acessorimobi.com.br) — operação global da plataforma. Cria tenants, provisiona números, monitora saúde, acessa logs e métricas.
Portal da Imobiliária ({tenant}.acessorimobi.com.br) — aprova corretores, configura o agente, acompanha uso, revisa auditoria.
Portal do Corretor (corretor.acessorimobi.com.br) — consulta clientes, imóveis, histórico de conversas e materiais para enviar ao cliente.
Agente no WhatsApp — interface principal do corretor no dia a dia.
Três papéis: desenvolvedor (global), administrador da imobiliária (escopo do tenant), corretor (escopo próprio). O WhatsApp não cria papel novo: ele autentica por número.

3. Arquitetura geral
Monólito modular em Docker, com processos separados por responsabilidade. A escolha é deliberada: 100 corretores concorrentes não exigem microsserviços, exigem fila, isolamento de contexto e um modelo de IA bem servido.

traefik         → proxy reverso, TLS, roteamento por subdomínio (tenant)
web             → portal imobiliária + portal corretor + painel dev
api             → núcleo de negócio, webhooks do WhatsApp, ferramentas do agente
worker          → processamento de conversa (mesma imagem, processo distinto)
scheduler       → sincronização Imoview, expurgo, relatórios
postgres        → dados de negócio + pgvector para contexto
redis           → fila, cache, locks de conversa, sessões
evolution       → gateway WhatsApp (uma instância por número de agente)
ollama          → LLM e embeddings, local
whisper         → transcrição de áudio, local
minio           → áudios e anexos
Camadas lógicas

Ingestão: recebe o webhook, resolve tenant e corretor, persiste e enfileira. Não chama IA, não consulta Imoview, não responde.
Orquestração: worker que adquire o lock da conversa, monta contexto, chama ferramentas e produz a resposta.
Domínio: regras de corretor, cliente, imóvel, escrita no CRM e auditoria.
Integração: adaptadores de Imoview, WhatsApp, LLM, transcrição e busca externa. O núcleo nunca importa SDK de fornecedor.
Superfícies: APIs do portal e do painel administrativo.
Regra estrutural: o worker é o único componente que fala com o modelo. A API nunca chama IA diretamente. Isso permite escalar os dois de forma independente e mantém a latência da API previsível.

4. Modelo de isolamento multitenant
Isolamento em quatro camadas independentes. Cada uma sozinha já bloqueia vazamento; juntas, tornam o erro improvável.

Identidade de sessão: cada número de agente pertence a exatamente um tenant. O webhook resolve o tenant pelo instanceId da sessão WhatsApp, nunca por dado do corpo da mensagem.
Chave de dados: tenant_id obrigatório em toda tabela de negócio, com índice composto iniciando por ele. Consulta sem filtro de tenant é rejeitada na camada de repositório, não no código de aplicação.
Row Level Security: políticas no Postgres usando a variável de sessão app.tenant_id. Defesa em profundidade: mesmo um WHERE esquecido não retorna linha de outro tenant.
Contexto de IA: montado por requisição e descartado ao final. Nenhum estado de conversa vive no processo, no modelo ou em cache global. O prompt de sistema do tenant é carregado por chave, nunca compartilhado entre tenants.
A unidade de isolamento real é a conversa, definida pelo trio tenant_id + número do agente + telefone do corretor. Toda mensagem é processada dentro desse escopo, e nenhuma consulta ao banco, ao CRM ou ao modelo pode escapar dele.

Telefone como identidade: normalizado em E.164, unicidade em (tenant_id, telefone). O mesmo número pode ser corretor em duas imobiliárias — são duas identidades independentes, com históricos, clientes e acessos separados. Isso não é exceção, é o comportamento esperado.

Provisionamento: banco compartilhado com tenant_id e RLS. Schema por tenant só se justifica com exigência contratual de isolamento físico; o custo de migração multiplicada por tenant não compensa em escala de dezenas de imobiliárias.

5. Fluxo de cadastro e aprovação do corretor
O gate de entrada é o que impede que qualquer número desconhecido use o agente.

Etapa 1 — primeiro contato. Mensagem de número sem vínculo no tenant. O sistema cria registro corretor com status pendente, sem acesso a qualquer dado.

Etapa 2 — coleta. O agente solicita nome completo e e-mail, uma informação por mensagem. Valida formato de e-mail. Se o corretor tentar pular ou pedir outra coisa, o agente insiste uma vez e encerra educadamente.

Etapa 3 — notificação. Com nome e e-mail válidos, dispara em paralelo: mensagem ao WhatsApp do administrador do tenant, e-mail para os administradores, e card na fila de aprovação do portal. O corretor recebe confirmação de que está em análise e o prazo esperado.

Etapa 4 — decisão. A imobiliária aprova ou recusa no portal, com motivo obrigatório na recusa. A decisão é registrada com autor e horário.

Etapa 5 — liberação. Aprovado, o corretor recebe confirmação, ganha acesso ao portal e o agente libera todas as ferramentas. Recusado, recebe mensagem neutra e é bloqueado; nova tentativa gera alerta ao administrador.

Enquanto pendente, o agente responde apenas sobre status do cadastro. Nenhuma consulta a imóvel, cliente ou mercado é executada. Isolar o onboarding evita que um número não aprovado use a plataforma como consulta gratuita.

6. Fluxo de processamento de mensagem
Pipeline determinístico, com a IA restrita ao ponto onde ela agrega:

Webhook recebe o envelope e responde 202 imediatamente.
Resolve sessão WhatsApp → tenant. Sessão sem tenant válido é descartada.
Normaliza o telefone, localiza o corretor e verifica status.
Deduplica por message_id. Repetição retorna 200 sem processar.
Persiste a mensagem antes de qualquer chamada externa.
Enfileira job com chave de partição tenant:corretor, garantindo ordem por conversa e paralelismo entre conversas.
Worker adquire o lock da conversa. Lock não obtido → reagenda; nunca processa duas mensagens da mesma conversa em paralelo.
Se áudio, transcreve antes de montar contexto.
Monta o contexto: últimas N mensagens, estado do corretor, dados do tenant e cache relevante. Nada além.
Executa: intenção reconhecida por rota determinística quando possível; IA apenas quando há ambiguidade real.
Se a intenção for escrita, monta proposta com antes e depois, envia para confirmação do corretor e só executa após resposta afirmativa.
Envia a resposta, persiste, registra trace e libera o lock.
Confirmação de escrita é o único ponto onde o fluxo para e espera humano. Vale para criar ou atualizar cliente no Imoview. Consulta não exige confirmação. A confirmação é vinculada ao conteúdo exibido: se o dado mudar entre a proposta e a resposta, a execução é recusada com conflito.

7. Módulos funcionais
7.1 Agente de IA Um único agente por tenant, com persona e vocabulário definidos em configuração. Ferramentas expostas: consultar imóveis, consultar clientes, propor criação ou atualização de cliente, consultar taxas, consultar notícias, consultar dúvidas de mercado. O modelo classifica e preenche parâmetros; o núcleo decide o que executa. Instruções vindas de mensagem são dado, não comando.

7.2 Consulta de imóveis Busca por bairro, faixa de preço, tipo, quartos e código. Retorna até 5 resultados formatados para envio: código, tipo, bairro, área, quartos, valor e link do anúncio no Imoview. O corretor copia e encaminha ao cliente pelo próprio WhatsApp. A plataforma não envia ao cliente.

7.3 Clientes e leads Consulta por nome, telefone, e-mail ou código. Exibe cadastro e histórico de interações quando disponível. Criação e atualização passam por proposta, confirmação e escrita no Imoview. O portal do corretor é somente leitura.

7.4 Mercado, taxas e notícias Consulta a indicadores (Selic, TR, IPCA, taxas médias de financiamento) e notícias recentes. Resultado sempre com fonte, data de referência e ressalva de que não constitui recomendação. Cache curto: 1 hora para indicadores, 15 minutos para notícias.

7.5 Áudio Recebe o áudio, armazena no MinIO, transcreve com Whisper local, processa como texto. Se a transcrição falhar ou vier vazia, pede que o corretor reenvie por escrito. Limite de 3 minutos por áudio.

7.6 Auditoria Registro append-only de toda ação: quem pediu, o que foi consultado, o que foi escrito, aprovador, horário e resultado. Sem update nem delete. Retenção padrão de 12 meses, configurável por tenant.

8. Integração com o Imoview
Contrato: API REST por tenant. Cada imobiliária tem sua própria base, credenciais e instância. O adaptador é configurado no provisionamento e guardado cifrado.

Leitura

Imóveis com sincronização incremental para o cache local, mantendo código, status, tipo, bairro, área, quartos, vagas, valor e link.
Clientes consultados sob demanda, com cache de 15 minutos.
Sincronização agendada a cada 30 minutos; consulta ao vivo quando o corretor pede dado específico e o cache está vencido.
Escrita

Criação e atualização de cliente como operação sempre proposta, nunca silenciosa.
Chave de idempotência por (tenant, telefone normalizado, hash do payload). Repetir a confirmação não duplica cadastro.
Falha de escrita gera pendência tipada com motivo e tentativa, visível no portal. Nunca vira sucesso presumido.
Degradação: Imoview indisponível → o agente responde com o dado do cache e informa a data de referência. Sem cache → declara a indisponibilidade e registra a falha. Nunca inventa imóvel ou cliente.

9. WhatsApp local
Gateway em container, com uma instância por número de agente. Cada instância tem sessão, QR e credenciais próprias, mapeadas a um tenant.

Ponto crítico e honesto: soluções locais de WhatsApp são não oficiais. Elas funcionam bem para uso interno com volume moderado, mas implicam risco de bloqueio do número e de instabilidade na sessão. Algumas decisões reduzem esse risco de forma significativa.

Use números dedicados, nunca o número principal da imobiliária.
Volume por número abaixo de 1.000 mensagens/dia.
Comportamento humano: sem disparo, sem listas de transmissão, sem mensagem para quem não iniciou contato.
Reconexão automática com alerta ao administrador quando a sessão cai.
Mapeamento de estado real: enviado, entregue, lido, não confirmado, erro.
Plano de saída: a camada de mensageria é um adaptador. A migração para a API oficial da Meta, por tenant, é uma troca de adaptador — não um retrabalho. Projete assim desde o começo.

10. IA local
Ollama serve o modelo e os embeddings, sem dependência externa. Três decisões que determinam se isso funciona em produção:

Modelo adequado a ferramentas. Escolha um modelo com bom suporte a chamada de ferramentas e saída estruturada, na faixa de 7 a 14 bilhões de parâmetros quantizado. Modelos muito pequenos falham em selecionar ferramenta corretamente; muito grandes não cabem no orçamento de latência.

Serviço de inferência preparado para concorrência. O Ollama serializa requisições por padrão, o que derruba a experiência com 30 corretores simultâneos. Configure paralelismo explícito e, se a latência p95 passar do alvo, sirva o mesmo modelo por um servidor com batching contínuo. O adaptador é o mesmo; muda o endpoint.

Fallback determinístico. Saída fora do esquema, timeout ou ferramenta inexistente caem em roteamento por regra. O corretor nunca vê erro de modelo — vê uma resposta mais simples, marcada internamente como origem fallback.

Embeddings para busca semântica em dúvidas frequentes e descrição de imóveis, com pgvector. Isso reduz idas ao modelo e melhora a consistência das respostas.

11. Escalabilidade e concorrência
O gargalo não é o banco. É a inferência.

Dimensionamento de referência para 100 corretores ativos

Pico simultâneo realista: 25 a 35 conversas em andamento.
Vazão de entrada: 8 a 12 mensagens por segundo.
Custo por turno: contexto de 1.500 a 2.500 tokens, resposta de 200 a 400 tokens.
O que garante estabilidade

Fila com partição por conversa: ordem garantida dentro da conversa, paralelismo entre conversas.
Lock distribuído por conversa: impede resposta duplicada e processamento fora de ordem.
Limite de concorrência por tenant: um tenant com volume anormal não consome a capacidade dos demais.
Timeout e circuit breaker em toda chamada externa, com resposta degradada definida.
Idempotência na ingestão: reprocessamento nunca duplica mensagem nem cadastro.
Contexto curto por design: janela de 12 mensagens mais estado resumido. Histórico longo é resumido, não acumulado.
Capacidade de GPU

Uma GPU de 24 GB com modelo quantizado sustenta 15 a 25 respostas simultâneas com latência aceitável.
Uma GPU de 48 GB sustenta 40 a 60, com folga para picos.
Sem GPU, Whisper em CPU não acompanha o volume de áudio esperado; transcrição vira o novo gargalo.
Alvo de latência: p95 abaixo de 8 segundos para resposta completa, abaixo de 3 segundos para consulta com cache. Se o p95 subir, a resposta é encurtar contexto e reduzir o modelo — não escalar hardware às cegas.

12. Permissões
Desenvolvedor: cria, suspende e remove tenants. Provisiona número e sessão WhatsApp. Configura credenciais do Imoview. Acessa métricas e logs de todos os tenants, sem acesso ao conteúdo das conversas, salvo com justificativa registrada.

Administrador da imobiliária: aprova e desativa corretores. Configura persona e vocabulário do agente. Define retenção de dados. Consulta uso, auditoria e pendências de integração. Não acessa conteúdo de conversa de corretor por padrão — se acessar, fica registrado.

Corretor: consulta imóveis, clientes e histórico próprio. Propõe escrita, sempre com confirmação. Não vê dado de outro corretor, nem lista de corretores, nem configuração do tenant.

Toda verificação ocorre no servidor, em cada requisição. Esconder botão não é permissão. Recurso fora do escopo retorna 404, não 403, para não revelar existência.

13. Organização dos ambientes por tenant
Provisionamento em um único fluxo no painel do desenvolvedor: cria tenant, define subdomínio, cria instância WhatsApp, gera credenciais de API, solicita credenciais do Imoview, seleciona modelo, aplica configuração inicial.

Configuração por tenant: persona do agente, vocabulário de bairros e tipos, limites de uso, retenção, fuso, horário de operação, canais de notificação da imobiliária.

Segredos: por tenant, cifrados em repouso, nunca em variável de ambiente global e nunca no prompt.

Ambientes: dev, staging, produção como stacks Docker separadas na mesma VPS ou em VPS distintas. Um tenant de demonstração fixo em staging, nunca em produção.

Backup: Postgres diário com retenção de 7 dias e teste de restauração mensal. Áudios no MinIO com política de expurgo alinhada à retenção do tenant.

14. Segurança e LGPD
Conversas contêm dado pessoal de terceiros — nome, telefone, e-mail de clientes. Isso exige tratamento explícito.

Base legal documentada: execução de contrato com a imobiliária e legítimo interesse na operação.
Retenção padrão de 180 dias para mensagens e 12 meses para auditoria, configurável e com expurgo automático.
Direito de eliminação: comando no painel do desenvolvedor remove mensagens de um titular, mantendo apenas o registro de auditoria sem conteúdo.
Logs sem PII: telefone mascarado, e-mail hasheado. Nunca prompt completo em log de produção.
Áudio cifrado em repouso, com URL assinada de curta duração.
Acesso do desenvolvedor ao conteúdo de conversa exige justificativa registrada e gera notificação ao administrador do tenant.
15. Observabilidade e operação
Métricas por tenant: mensagens recebidas, tempo de resposta, taxa de fallback, erros de integração, sessões WhatsApp ativas.
Alerta imediato para: sessão WhatsApp caída, fila acima do limite, p95 acima do alvo, falha de sincronização do Imoview.
Health check por container, com página de status no painel do desenvolvedor.
Trace por mensagem: do webhook à resposta, com tempo gasto em cada etapa. Sem isso, diagnosticar lentidão com 100 corretores é adivinhação.
16. Critérios de aceite
Isolamento entre tenants: corretor do tenant A não obtém, por nenhuma rota, dado do tenant B. Teste negativo em leitura, contagem, exportação e mensagem de erro.
Isolamento entre corretores: dois corretores do mesmo tenant, mensagens simultâneas, nenhuma resposta trocada e nenhum contexto cruzado, com 50 iterações concorrentes.
Isolamento de conversa: mensagem enviada durante o processamento da anterior não gera resposta fora de ordem.
Cadastro: primeiro contato cria corretor pendente, solicita nome e e-mail, notifica a imobiliária e bloqueia todas as ferramentas até aprovação.
Aprovação: aprovado, libera acesso; recusado, bloqueia e alerta em nova tentativa.
Consulta de imóveis: retorna até 5 imóveis com dados do cache, formato pronto para encaminhar.
Escrita no Imoview: nunca ocorre sem confirmação explícita; repetir a confirmação não duplica cadastro; falha vira pendência, não sucesso.
Áudio: áudio transcrito e processado; falha de transcrição solicita reenvio por escrito.
Degradação: Imoview fora e IA fora produzem resposta útil declarando a limitação, sem inventar dado.
Idempotência: mensagem repetida pelo provedor não gera segunda resposta.
Permissões: corretor não acessa portal de outro nem painel administrativo; recurso fora de escopo retorna 404.
Auditoria: toda escrita registrada com autor, aprovador, antes, depois e horário; update e delete recusados.
17. Sequência de entrega
Fase 1 — esqueleto multitenant. Docker completo, Postgres com RLS, autenticação, painel do desenvolvedor com criação de tenant. Nada de IA ainda. O valor aqui é provar o isolamento antes de construir em cima.

Fase 2 — canal e conversa. WhatsApp por instância, ingestão, fila, lock, persistência, resposta eco. Prova o fluxo e a concorrência sem IA.

Fase 3 — cadastro e aprovação. Onboarding do corretor, notificação à imobiliária, portais de aprovação. Fecha o gate de acesso.

Fase 4 — agente e consultas. Ollama, ferramentas de imóvel e cliente, cache do Imoview, áudio.

Fase 5 — escrita e auditoria. Proposta, confirmação, escrita no Imoview, pendências, auditoria.

Fase 6 — mercado, notícias e observabilidade. Fontes externas, métricas, alertas, retenção.

Cada fase termina funcionando ponta a ponta. Nenhuma fase depende de outra incompleta.