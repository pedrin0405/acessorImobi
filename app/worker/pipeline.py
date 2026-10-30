"""
Pipeline de processamento de conversa.

Fluxo (seção 6 da spec):
1. Se áudio → transcreve antes de montar contexto
2. Monta contexto: últimas N mensagens + estado do corretor + dados do tenant
3. Roteamento determinístico quando possível; IA apenas quando há ambiguidade real
4. Se intenção for escrita → proposta + confirmação → executa
5. Envia resposta, persiste, registra trace, libera lock
"""
import asyncio
import hashlib
import json
import random
import re
import time
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

import structlog

from app.domain.corretor.service import CorretorService
from app.domain.conversa.service import ConversaService
from app.domain.imovel.service import ImovelService
from app.domain.cliente.service import ClienteService
from app.domain.auditoria.service import AuditoriaService
from app.domain.crm.acoes import TIPOS_ACAO, executar_acao
from app.integration.llm.agent import AgentOrchestrator
from app.integration.transcription.whisper import _decodificar_midia, transcrever_audio
from app.integration.tts import get_tts_client
from app.integration.tts.vozes import id_clone
from app.integration.whatsapp.evolution import EvolutionClient
from app.shared.config import get_settings
from app.shared.database import get_session
from app.shared.storage import guardar_midia

log = structlog.get_logger()
settings = get_settings()


def _deve_enviar_audio(
    *,
    modo: str,
    tipo: str,
    chance: float,
    tem_imoveis: bool = False,
    tem_proposta: bool = False,
    ultimo_foi_audio: bool = False,
    a_cada: int = 0,
    textos_desde_audio: int = 0,
    responder_audio: bool = True,
) -> bool:
    """
    Planeja se a resposta vai em áudio (chamado ANTES da IA, para ela já
    escrever como fala).

    - always: sempre
    - never: nunca
    - mirror: para áudio recebido, responde em áudio se `responder_audio`;
      para texto, de vez em quando: a cada `a_cada` respostas de texto
      (quando > 0) ou por sorteio com `chance` (0 a 1). Nunca dois áudios
      seguidos e nunca para listas de imóveis, para soar como uma pessoa
      alternando texto e voz.
    Propostas de escrita nunca viram áudio (precisam de confirmação escrita).
    """
    modo = (modo or "mirror").strip().lower()
    if modo == "never" or tem_proposta:
        return False
    if modo == "always":
        return True
    if modo != "mirror":
        return False
    if tipo == "audio":
        return responder_audio
    if tipo != "text" or tem_imoveis or ultimo_foi_audio:
        return False
    if a_cada > 0:
        return textos_desde_audio >= a_cada
    limite = max(0.0, min(float(chance or 0), 1.0))
    return limite > 0 and random.random() < limite


def _config_audio(agent_config: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Opções de áudio da imobiliária (portal → agent_config), com os valores
    do .env como padrão. Devolve os argumentos de `_deve_enviar_audio`.

    audio_frequencia: 'nunca' | 'aleatorio' | 'a_cada' | 'sempre'.
    """
    cfg = agent_config or {}
    modo_env = (settings.voice_reply_mode or "mirror").strip().lower()
    if modo_env == "never":
        return {"modo": "never", "chance": 0.0, "a_cada": 0, "responder_audio": False}

    frequencia = cfg.get("audio_frequencia")
    if frequencia not in ("nunca", "aleatorio", "a_cada", "sempre"):
        frequencia = "sempre" if modo_env == "always" else "aleatorio"

    try:
        chance = int(cfg.get("audio_chance"))
    except (TypeError, ValueError):
        chance = round(float(settings.voice_reply_audio_chance) * 100)
    try:
        a_cada = int(cfg.get("audio_a_cada"))
    except (TypeError, ValueError):
        a_cada = 5

    return {
        "modo": "always" if frequencia == "sempre" else "mirror",
        "chance": max(0, min(chance, 100)) / 100 if frequencia == "aleatorio" else 0.0,
        "a_cada": max(2, min(a_cada, 20)) if frequencia == "a_cada" else 0,
        "responder_audio": cfg.get("audio_responder_audio", True) is not False,
    }


def _textos_desde_ultimo_audio(historico: List[Dict[str, Any]]) -> int:
    """Quantas mensagens de texto o agente enviou desde o último áudio."""
    total = 0
    for h in reversed(historico):
        if h.get("direcao") != "outbound":
            continue
        if h.get("tipo") == "audio":
            break
        if h.get("tipo") == "text":
            total += 1
    return total


async def _carregar_agent_config(session, tenant_id: UUID) -> Dict[str, Any]:
    from sqlalchemy.sql import text as sqltext

    row = await session.execute(
        sqltext("SELECT agent_config FROM tenants WHERE id=:tid"), {"tid": str(tenant_id)}
    )
    r = row.first()
    return (r.agent_config if r else None) or {}


async def _carregar_clone(session, voz: Optional[str]) -> Optional[Dict[str, Any]]:
    """Áudio e transcrição de referência de uma voz clonada (None se não for clone ou não existir)."""
    from sqlalchemy.sql import text as sqltext

    clone_id = id_clone(voz)
    if not clone_id:
        return None
    row = await session.execute(
        sqltext("SELECT ref_audio, ref_texto FROM vozes_clonadas WHERE id=:id"),
        {"id": clone_id},
    )
    r = row.first()
    if not r:
        log.warning("voz_clonada_nao_encontrada", voz=voz)
        return None
    return {"ref_audio": bytes(r.ref_audio), "ref_texto": r.ref_texto}


_MAX_CARACTERES_FALA = 600


def _texto_falavel(texto: str) -> bool:
    """Texto com link, muitos números (telefone, código) ou lista fica melhor escrito."""
    texto = texto or ""
    if not texto.strip() or len(texto) > _MAX_CARACTERES_FALA:
        return False
    if re.search(r"https?://|www\.", texto):
        return False
    if sum(ch.isdigit() for ch in texto) > 14:
        return False
    itens = re.findall(r"^\s*(?:[-•*]|\d+[.)])\s", texto, flags=re.MULTILINE)
    return len(itens) < 3


def _audio_cabe_na_resposta(
    texto: str,
    *,
    modo: str,
    tipo: str,
    tem_imoveis: bool,
    tem_proposta: bool,
) -> bool:
    """Confirma, DEPOIS da IA, se o conteúdo gerado combina com voz."""
    if tem_proposta:
        return False
    if tem_imoveis:
        # Fotos levam os dados; o áudio só comenta. Só vale quando o
        # corretor falou por áudio (ou o modo é always).
        modo = (modo or "mirror").strip().lower()
        return tipo == "audio" or modo == "always"
    return _texto_falavel(texto)


async def processar_conversa(job: dict) -> None:
    """Pipeline principal de processamento de uma mensagem."""
    # Análise de atendimento do WhatsApp pessoal (usa a mesma fila e o mesmo
    # lock da conversa do corretor, mas não é mensagem para responder).
    if job.get("tipo_job") == "analisar_atendimento":
        from app.domain.atendimento.analise import processar_job_analise

        await processar_job_analise(job)
        return

    trace = {"inicio": time.time()}

    tenant_id = UUID(job["tenant_id"])
    corretor_id = UUID(job["corretor_id"])
    mensagem_id = UUID(job["mensagem_id"])
    tipo = job.get("tipo", "text")
    audio_url = job.get("audio_url")
    message_key = job.get("message_key")
    mensagem_original = job.get("message")

    async with get_session(tenant_id) as session:
        # --- Carrega estado do corretor ---
        corretor_service = CorretorService(session)
        corretor = await corretor_service.get_by_id(corretor_id, tenant_id)
        if not corretor:
            log.error("corretor_nao_encontrado", corretor_id=str(corretor_id)[:8])
            return

        conversa_service = ConversaService(session)
        auditoria_service = AuditoriaService(session)

        # --- Transcreve áudio se necessário ---
        conteudo = None
        if tipo == "audio":
            trace["transcricao_inicio"] = time.time()
            tentou_evolucao = False
            audio_webhook = audio_url

            # O webhook nem sempre traz a URL/base64 da mídia, e quando traz
            # pode ser uma URL criptografada do CDN do WhatsApp. Nesses casos
            # baixa a mídia diretamente da Evolution pela key da mensagem.
            if message_key and message_key.get("id") and (
                not audio_url or "mmg.whatsapp.net" in (audio_url or "")
            ):
                tentou_evolucao = True
                audio_evolucao = await _buscar_audio_evolucao(
                    tenant_id, message_key, session, mensagem_original
                )
                if audio_evolucao:
                    audio_url = audio_evolucao
                else:
                    audio_url = audio_webhook

            if audio_url:
                try:
                    conteudo = await transcrever_audio(audio_url)
                    if not conteudo or not conteudo.strip():
                        conteudo = None
                except Exception as e:
                    log.warning("transcricao_falhou", error=str(e))
                    conteudo = None

            # Se a mídia baixada da Evolution não transcreveu, tenta a URL
            # que veio no webhook (pode ser um link público válido).
            if not conteudo and audio_webhook and audio_url != audio_webhook:
                try:
                    conteudo = await transcrever_audio(audio_webhook)
                    conteudo = conteudo.strip() if conteudo else None
                except Exception as e:
                    log.warning("transcricao_webhook_falhou", error=str(e))

            # Última tentativa: se a mídia do webhook falhou, busca na Evolution.
            if not conteudo and not tentou_evolucao and message_key and message_key.get("id"):
                try:
                    base64_evolucao = await _buscar_audio_evolucao(
                        tenant_id, message_key, session, mensagem_original
                    )
                    if base64_evolucao:
                        conteudo = await transcrever_audio(base64_evolucao)
                        conteudo = conteudo.strip() if conteudo else None
                except Exception as e:
                    log.warning("transcricao_fallback_evolucao_falhou", error=str(e))

            trace["transcricao_fim"] = time.time()

            if not conteudo:
                # Falha de transcrição → pede reenvio por escrito
                await _enviar_resposta(
                    tenant_id=tenant_id,
                    corretor=corretor,
                    texto=(
                        "O áudio chegou sem a mídia aqui do meu lado. "
                        "Pode me reenviar ou escrever rapidinho o que você precisa? 🙏"
                    ),
                    session=session,
                    mensagem_id=mensagem_id,
                )
                return

            # Guarda o áudio recebido (quando veio como mídia embutida) para o
            # portal poder tocá-lo; falha de storage não impede a resposta.
            arquivo = None
            bruto = _decodificar_midia(audio_url) if audio_url else None
            if bruto:
                arquivo = await guardar_midia(tenant_id, corretor_id, bruto, "ogg", "audio/ogg")

            # Atualiza a mensagem com a transcrição
            from sqlalchemy.sql import text as sqltext
            await session.execute(
                sqltext("UPDATE mensagens SET transcricao=:t, midia_url=:m WHERE id=:id"),
                {"t": conteudo, "m": arquivo, "id": str(mensagem_id)},
            )

        else:
            # Busca conteúdo da mensagem text
            from sqlalchemy.sql import text as sqltext
            row = await session.execute(
                sqltext("SELECT conteudo FROM mensagens WHERE id=:id"),
                {"id": str(mensagem_id)},
            )
            r = row.first()
            conteudo = r.conteudo if r else ""

        # --- Gate de onboarding ---
        if corretor.status == "pending":
            await _processar_onboarding(
                corretor=corretor,
                conteudo=conteudo or "",
                corretor_service=corretor_service,
                conversa_service=conversa_service,
                session=session,
                tenant_id=tenant_id,
            )
            return

        if corretor.status in ("rejected", "blocked"):
            if corretor.status == "rejected":
                # Nova tentativa pós-recusa → alerta ao administrador
                await corretor_service.bloquear(corretor.id, tenant_id)
                await _notificar_admin_nova_tentativa(tenant_id, corretor, session)
            return

        if corretor.status != "active":
            return

        # --- Verifica se há confirmação pendente esperando resposta ---
        confirmacao = await conversa_service.get_confirmacao_pendente(
            corretor_id=corretor_id,
            tenant_id=tenant_id,
        )

        if confirmacao and conteudo:
            tratada = await _processar_confirmacao(
                confirmacao=confirmacao,
                resposta_corretor=conteudo.strip().lower(),
                session=session,
                tenant_id=tenant_id,
                corretor=corretor,
                auditoria_service=auditoria_service,
            )
            if tratada:
                return

        # --- Monta contexto ---
        trace["contexto_inicio"] = time.time()
        # Busca a mais: cada busca de imóveis gera várias mensagens de foto,
        # que o agente compacta em uma linha antes de aplicar a janela.
        historico = await conversa_service.historico(
            corretor_id=corretor_id,
            tenant_id=tenant_id,
            limit=settings.context_window_messages * 3,
        )
        # A mensagem atual já foi persistida e será enviada explicitamente
        # ao orquestrador; evita duplicá-la no contexto.
        atual = next((h for h in historico if h["id"] == str(mensagem_id)), None)
        historico = [h for h in historico if h["id"] != str(mensagem_id)]
        # Mensagens que chegaram depois da atual ainda serão processadas na vez
        # delas; no contexto, só confundiriam a ordem dos pedidos.
        if atual and atual.get("created_at"):
            historico = [
                h for h in historico if (h.get("created_at") or "") < atual["created_at"]
            ]
        trace["contexto_fim"] = time.time()

        # --- Planeja o canal da resposta (texto ou voz) ---
        ultima_saida = next(
            (h for h in reversed(historico) if h["direcao"] == "outbound"), None
        )
        agent_config = await _carregar_agent_config(session, tenant_id)
        opcoes_audio = _config_audio(agent_config)
        quer_audio = _deve_enviar_audio(
            tipo=tipo,
            ultimo_foi_audio=bool(ultima_saida and ultima_saida["tipo"] == "audio"),
            textos_desde_audio=_textos_desde_ultimo_audio(historico),
            **opcoes_audio,
        )

        # --- Orquestra IA ---
        trace["ia_inicio"] = time.time()
        orchestrator = AgentOrchestrator(
            tenant_id=tenant_id,
            corretor=corretor,
            session=session,
        )
        resposta = await orchestrator.processar(
            mensagem=conteudo or "",
            historico=historico,
            entrada_audio=tipo == "audio",
            resposta_em_audio=quer_audio,
        )
        trace["ia_fim"] = time.time()
        # Processo da IA para o portal (rota, etapas e tempos); só metadados.
        trace["processo"] = {
            "rota": resposta.rota,
            "passos": resposta.passos,
            "contexto_msgs": len(historico),
            "entrada": tipo,
            "modelo": settings.gemini_model if resposta.rota == "gemini" else None,
        }

        # --- Envia resposta ---
        quer_audio = quer_audio and _audio_cabe_na_resposta(
            resposta.texto,
            modo=opcoes_audio["modo"],
            tipo=tipo,
            tem_imoveis=bool(resposta.imoveis),
            tem_proposta=bool(resposta.proposta_escrita),
        )
        trace["processo"]["canal"] = "audio" if quer_audio else "texto"
        await _enviar_resposta(
            tenant_id=tenant_id,
            corretor=corretor,
            texto=resposta.texto,
            session=session,
            mensagem_id=mensagem_id,
            trace=trace,
            imoveis=resposta.imoveis,
            audio=quer_audio,
            voz=agent_config.get("voz"),
        )

        # --- Registra proposta de escrita se houver ---
        if resposta.proposta_escrita:
            await conversa_service.criar_confirmacao_pendente(
                tenant_id=tenant_id,
                corretor_id=corretor_id,
                tipo=resposta.proposta_escrita.tipo,
                payload=resposta.proposta_escrita.payload,
            )

        log.info(
            "conversa_processada",
            tenant_id=str(tenant_id)[:8],
            duracao_ms=round((time.time() - trace["inicio"]) * 1000),
            fallback=resposta.fallback,
        )


async def _buscar_audio_evolucao(
    tenant_id: UUID,
    message_key: dict,
    session,
    mensagem: Optional[dict] = None,
) -> Optional[str]:
    """Baixa a mídia de áudio da Evolution quando o webhook não a trouxe."""
    from sqlalchemy.sql import text as sqltext
    from app.integration.whatsapp.evolution import EvolutionClient

    row = await session.execute(
        sqltext(
            "SELECT instance_id FROM whatsapp_sessions "
            "WHERE tenant_id=:tid AND tipo='agente' AND status='connected' LIMIT 1"
        ),
        {"tid": str(tenant_id)},
    )
    ws = row.first()
    if not ws:
        log.warning("audio_sem_sessao_para_baixar", tenant_id=str(tenant_id)[:8])
        return None

    try:
        base64_media = await EvolutionClient().get_media_base64(
            ws.instance_id, message_key, mensagem
        )
    except Exception as e:
        log.warning("audio_busca_evolucao_falhou", error=str(e))
        return None

    if not base64_media:
        return None
    return f"data:audio/ogg;base64,{base64_media}"


async def _processar_onboarding(
    corretor,
    conteudo: str,
    corretor_service: CorretorService,
    conversa_service: ConversaService,
    session,
    tenant_id: UUID,
) -> None:
    """
    Coleta nome e e-mail durante o onboarding.
    Uma informação por mensagem. Insiste uma vez e encerra educadamente.
    """
    from sqlalchemy.sql import text as sqltext
    row = await session.execute(
        sqltext("SELECT * FROM onboarding_states WHERE corretor_id=:id"),
        {"id": str(corretor.id)},
    )
    state = row.first()

    if not state:
        # Inicializa estado de onboarding
        await session.execute(
            sqltext("""
                INSERT INTO onboarding_states (corretor_id, etapa)
                VALUES (:id, 'aguardando_nome')
                ON CONFLICT (corretor_id) DO NOTHING
            """),
            {"id": str(corretor.id)},
        )
        etapa = "aguardando_nome"
        tentativas = 0
    else:
        etapa = state.etapa
        tentativas = state.tentativas

    if etapa == "aguardando_nome":
        if conteudo and len(conteudo.strip()) >= 2 and not conteudo.strip().isdigit():
            nome = conteudo.strip()[:255]
            await corretor_service.atualizar_onboarding(corretor.id, nome=nome)
            await session.execute(
                sqltext("UPDATE onboarding_states SET etapa='aguardando_email', tentativas=0 WHERE corretor_id=:id"),
                {"id": str(corretor.id)},
            )
            resposta = f"Obrigado, {nome.split()[0]}! 😊 Agora preciso do seu e-mail profissional para concluir o cadastro."
        else:
            if tentativas >= 1:
                resposta = "Entendo, mas preciso do seu nome completo para prosseguir. Caso precise de ajuda, entre em contato com a imobiliária. Até logo!"
            else:
                await session.execute(
                    sqltext("UPDATE onboarding_states SET tentativas=tentativas+1 WHERE corretor_id=:id"),
                    {"id": str(corretor.id)},
                )
                resposta = "Olá! Para começar, preciso do seu nome completo. Como você se chama?"

    elif etapa == "aguardando_email":
        import re
        email_valido = bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", conteudo.strip()))
        if email_valido:
            await corretor_service.atualizar_onboarding(corretor.id, email=conteudo.strip())
            await session.execute(
                sqltext("UPDATE onboarding_states SET etapa='notificado', tentativas=0 WHERE corretor_id=:id"),
                {"id": str(corretor.id)},
            )
            # Notifica imobiliária
            await _notificar_imobiliaria_novo_corretor(tenant_id, corretor, session)
            resposta = "Perfeito! ✅ Seu cadastro foi enviado para análise da imobiliária. Em breve você receberá uma resposta. O prazo esperado é de até 1 dia útil."
        else:
            if tentativas >= 1:
                resposta = "Não foi possível validar o e-mail informado. Por favor, entre em contato diretamente com a imobiliária. Até logo!"
            else:
                await session.execute(
                    sqltext("UPDATE onboarding_states SET tentativas=tentativas+1 WHERE corretor_id=:id"),
                    {"id": str(corretor.id)},
                )
                resposta = "Não reconheci esse e-mail. Poderia informar seu e-mail profissional no formato nome@empresa.com?"

    elif etapa == "notificado":
        resposta = "Seu cadastro já está em análise! ⏳ Assim que a imobiliária tomar uma decisão, você será notificado aqui."
    else:
        resposta = "Seu cadastro está em análise. Aguarde a confirmação da imobiliária."

    await _enviar_resposta(
        tenant_id=tenant_id,
        corretor=corretor,
        texto=resposta,
        session=session,
    )


_AFIRMATIVOS = {"sim", "s", "confirmar", "confirmo", "confirma", "ok", "yes", "pode", "isso"}
_NEGATIVOS = {"nao", "n", "cancelar", "cancelo", "cancela", "no"}


def _interpretar_confirmacao(resposta: str) -> tuple:
    """
    Retorna (afirmativo, negativo) olhando a primeira palavra.

    Áudios transcritos chegam como "Sim." ou "Sim, pode cadastrar", e o
    corretor também escreve "Não, cancela"; comparar a frase inteira
    com "sim" deixava a confirmação travada.
    """
    import unicodedata

    texto = unicodedata.normalize("NFKD", resposta or "").encode("ascii", "ignore").decode()
    palavras = re.findall(r"[a-z]+", texto.lower())
    if not palavras:
        return False, False
    primeira = palavras[0]
    return primeira in _AFIRMATIVOS, primeira in _NEGATIVOS


async def _processar_confirmacao(
    confirmacao,
    resposta_corretor: str,
    session,
    tenant_id: UUID,
    corretor,
    auditoria_service: AuditoriaService,
) -> bool:
    """
    Processa a confirmação/negação de uma operação de escrita pendente.

    Retorna False quando a mensagem não é um "sim" nem um "não": a proposta é
    descartada e a mensagem segue para o agente como uma conversa normal
    (antes ela era consumida e o corretor ficava sem resposta).
    """
    from sqlalchemy.sql import text as sqltext

    afirmativo, negativo = _interpretar_confirmacao(resposta_corretor)

    await session.execute(
        sqltext("UPDATE confirmacoes_pendentes SET respondido=TRUE WHERE id=:id"),
        {"id": str(confirmacao.id)},
    )

    if not afirmativo and not negativo:
        log.info("confirmacao_descartada_por_nova_mensagem", tipo=confirmacao.tipo)
        return False

    if afirmativo:
        # Verifica se o payload não mudou (conflito de dados)
        payload_atual = json.loads(confirmacao.payload)
        payload_hash_atual = hashlib.sha256(
            json.dumps(payload_atual, sort_keys=True).encode()
        ).hexdigest()

        if payload_hash_atual != confirmacao.payload_hash:
            await _enviar_resposta(
                tenant_id=tenant_id, corretor=corretor,
                texto="⚠️ Os dados mudaram desde a proposta. A operação foi cancelada por segurança. Por favor, faça a solicitação novamente.",
                session=session,
            )
            return True

        # Escrita no CRM do Acessor (carteira, funil, agenda)
        if confirmacao.tipo in TIPOS_ACAO:
            texto = await executar_acao(
                session, tenant_id, corretor.id, confirmacao.tipo, payload_atual
            )
            await _enviar_resposta(
                tenant_id=tenant_id, corretor=corretor, texto=texto, session=session,
            )
            return True

        # Executa a escrita no Imoview
        from app.domain.cliente.service import ClienteService
        cliente_service = ClienteService(session)

        try:
            if confirmacao.tipo == "criar_cliente":
                resultado = await cliente_service.criar_no_imoview(
                    tenant_id=tenant_id,
                    payload=payload_atual,
                )
                await auditoria_service.registrar(
                    tenant_id=tenant_id,
                    corretor_id=corretor.id,
                    aprovado_por=corretor.id,
                    acao="criar_cliente",
                    entidade="cliente",
                    entidade_id=str(resultado.get("codigo", "")),
                    payload_depois=payload_atual,
                )
                texto = f"✅ Cliente criado com sucesso no Imoview! Código: {resultado.get('codigo', 'N/A')}"

            elif confirmacao.tipo == "atualizar_cliente":
                await cliente_service.atualizar_no_imoview(
                    tenant_id=tenant_id,
                    payload=payload_atual,
                )
                await auditoria_service.registrar(
                    tenant_id=tenant_id,
                    corretor_id=corretor.id,
                    aprovado_por=corretor.id,
                    acao="atualizar_cliente",
                    entidade="cliente",
                    entidade_id=str(payload_atual.get("codigo", "")),
                    payload_depois=payload_atual,
                )
                texto = "✅ Cadastro do cliente atualizado com sucesso no Imoview!"
            else:
                texto = "Operação não reconhecida."

        except Exception as e:
            log.error("escrita_imoview_falhou", error=str(e))
            # Gera pendência tipada
            await cliente_service.criar_pendencia(
                tenant_id=tenant_id,
                corretor_id=corretor.id,
                tipo=confirmacao.tipo,
                payload=payload_atual,
                erro=str(e),
            )
            texto = "❌ Não consegui salvar no Imoview agora. A operação foi registrada como pendente e será reprocessada automaticamente. Nenhum dado foi perdido."

        await _enviar_resposta(
            tenant_id=tenant_id, corretor=corretor,
            texto=texto, session=session,
        )

    else:
        await _enviar_resposta(
            tenant_id=tenant_id, corretor=corretor,
            texto="Beleza, não gravei nada. 👍",
            session=session,
        )
    return True


async def _persistir_saida(
    session,
    tenant_id: UUID,
    corretor,
    conteudo: str,
    tipo: str = "text",
    trace: Optional[dict] = None,
    midia_url: Optional[str] = None,
) -> None:
    """Persiste uma mensagem enviada pelo assistente."""
    from sqlalchemy.sql import text as sqltext

    await session.execute(
        sqltext("""
            INSERT INTO mensagens (tenant_id, corretor_id, message_id, direcao, tipo, conteudo, status, trace, midia_url)
            VALUES (:tid, :cid, :mid, 'outbound', :tipo, :conteudo, 'sent', CAST(:trace AS jsonb), :midia)
        """),
        {
            "tid": str(tenant_id),
            "cid": str(corretor.id),
            "mid": f"out_{int(time.time() * 1000)}_{uuid4().hex[:6]}",
            "tipo": tipo,
            "conteudo": conteudo,
            "trace": json.dumps(trace or {}),
            "midia": midia_url,
        },
    )


def _texto_para_fala(texto: str, imoveis: Optional[List[Dict[str, Any]]]) -> str:
    """Resume a resposta para uma fala curta e natural no WhatsApp."""
    if imoveis:
        total = len(imoveis)
        rotulo = "opção" if total == 1 else "opções"
        intro = (texto or "").split("\n\n", 1)[0].strip().rstrip(" .,;:!?")
        if not intro:
            intro = f"Encontrei {total} {rotulo}"
        if total == 1:
            return f"{intro}. Enviei a foto com os detalhes."
        return f"{intro}. Enviei as fotos com os detalhes de cada imóvel."
    return texto or ""


async def _enviar_resposta(
    tenant_id: UUID,
    corretor,
    texto: str,
    session,
    mensagem_id: Optional[UUID] = None,
    trace: Optional[dict] = None,
    imoveis: Optional[List[Dict[str, Any]]] = None,
    audio: bool = False,
    voz: Optional[str] = None,
) -> None:
    """Envia mensagem via Evolution API e persiste no banco.

    Quando a resposta traz imóveis, cada imóvel é enviado como foto com os
    dados na legenda (e texto puro como fallback se não houver foto).

    Com `audio=True` a resposta sai como mensagem de voz NO LUGAR do texto,
    como uma pessoa faria (texto + áudio repetindo o mesmo soava robótico).
    Com imóveis, as fotos vão primeiro e o áudio comenta a busca. Se o TTS
    falhar, o texto é enviado no lugar, então o corretor nunca fica sem
    resposta. TTS: Qwen3 local por padrão, com fallback para o Gemini.
    """
    from sqlalchemy.sql import text as sqltext
    from app.integration.whatsapp.evolution import EvolutionClient

    # Busca instância WhatsApp do tenant
    row = await session.execute(
        sqltext("SELECT instance_id FROM whatsapp_sessions WHERE tenant_id=:tid AND tipo='agente' AND status='connected' LIMIT 1"),
        {"tid": str(tenant_id)},
    )
    ws = row.first()
    if not ws:
        log.error("sem_sessao_whatsapp_ativa", tenant_id=str(tenant_id)[:8])
        return

    client = EvolutionClient()
    enviados = 0
    clone = await _carregar_clone(session, voz) if audio else None

    async def _texto(conteudo: str) -> None:
        nonlocal enviados
        await client.send_text(
            instance_id=ws.instance_id,
            to=corretor.telefone,
            text=conteudo,
        )
        await _persistir_saida(session, tenant_id, corretor, conteudo, "text", trace)
        enviados += 1

    async def _audio(fala: str) -> bool:
        """Gera e envia a voz. Retorna False se não conseguiu (chamador manda texto)."""
        nonlocal enviados
        if not fala:
            return False
        # "gravando áudio..." enquanto o TTS local gera (pode levar dezenas de segundos).
        presenca = asyncio.create_task(
            client.send_presence(ws.instance_id, corretor.telefone, "recording")
        )
        try:
            ogg = await get_tts_client().texto_para_audio(fala, voz, clone)
            if not ogg:
                return False
            await client.send_audio(
                instance_id=ws.instance_id,
                to=corretor.telefone,
                audio=ogg,
            )
        except Exception as e:
            log.warning("tts_falhou_enviando_texto", error=str(e)[:300])
            return False
        finally:
            presenca.cancel()
        arquivo = await guardar_midia(tenant_id, corretor.id, ogg, "ogg", "audio/ogg")
        await _persistir_saida(session, tenant_id, corretor, fala, "audio", trace, midia_url=arquivo)
        enviados += 1
        return True

    async def _foto(imovel: Dict[str, Any]) -> None:
        nonlocal enviados
        resumo = (imovel.get("resumo_texto") or "").strip()
        foto = imovel.get("foto_url")
        codigo = imovel.get("codigo")

        if foto:
            try:
                await client.send_media(
                    instance_id=ws.instance_id,
                    to=corretor.telefone,
                    media_url=foto,
                    caption=resumo[:1000],
                    file_name=f"imovel-{codigo}.jpg",
                )
                await _persistir_saida(
                    session, tenant_id, corretor, resumo, "image", trace, midia_url=foto
                )
                enviados += 1
                return
            except Exception as e:
                log.error(
                    "envio_foto_imovel_falhou",
                    codigo=codigo,
                    error=str(e),
                )

        # Fallback: sem foto ou falha no envio da imagem.
        if resumo:
            await _texto(resumo)

    if imoveis:
        # Cabeçalho curto; os dados de cada imóvel vão na legenda da foto.
        # Com áudio, o comentário falado substitui o cabeçalho escrito.
        intro = (texto or "").split("\n\n", 1)[0].strip()
        if intro and len(imoveis) > 1 and not audio:
            try:
                await _texto(intro)
            except Exception as e:
                log.error("envio_whatsapp_falhou", etapa="intro", error=str(e))

        for imovel in imoveis:
            try:
                await _foto(imovel)
            except Exception as e:
                log.error(
                    "envio_imovel_falhou",
                    codigo=imovel.get("codigo"),
                    error=str(e),
                )

        if audio and not await _audio(_texto_para_fala(texto, imoveis)):
            if intro and len(imoveis) > 1:
                try:
                    await _texto(intro)
                except Exception as e:
                    log.error("envio_whatsapp_falhou", etapa="intro", error=str(e))
    else:
        if not (audio and await _audio(_texto_para_fala(texto, None))):
            try:
                await _texto(texto)
            except Exception as e:
                log.error("envio_whatsapp_falhou", error=str(e))

    if not enviados:
        return

    # Atualiza status da mensagem de entrada
    if mensagem_id:
        await session.execute(
            sqltext("UPDATE mensagens SET status='sent' WHERE id=:id"),
            {"id": str(mensagem_id)},
        )


async def _notificar_imobiliaria_novo_corretor(tenant_id, corretor, session) -> None:
    """Notifica a imobiliária sobre novo corretor aguardando aprovação."""
    from sqlalchemy.sql import text as sqltext
    # Busca admins do tenant para notificação
    admins = await session.execute(
        sqltext("SELECT email FROM tenant_admins WHERE tenant_id=:tid AND ativo=TRUE"),
        {"tid": str(tenant_id)},
    )
    # TODO: enviar e-mail e notificação WhatsApp para admins
    log.info("notificacao_imobiliaria_novo_corretor", tenant_id=str(tenant_id)[:8])


async def _notificar_admin_nova_tentativa(tenant_id, corretor, session) -> None:
    """Alerta administrador sobre nova tentativa de acesso de corretor bloqueado."""
    log.warning(
        "nova_tentativa_corretor_bloqueado",
        tenant_id=str(tenant_id)[:8],
        corretor_id=str(corretor.id)[:8],
    )
