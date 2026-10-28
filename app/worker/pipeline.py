"""
Pipeline de processamento de conversa.

Fluxo (seção 6 da spec):
1. Se áudio → transcreve antes de montar contexto
2. Monta contexto: últimas N mensagens + estado do corretor + dados do tenant
3. Roteamento determinístico quando possível; IA apenas quando há ambiguidade real
4. Se intenção for escrita → proposta + confirmação → executa
5. Envia resposta, persiste, registra trace, libera lock
"""
import hashlib
import json
import time
from typing import Optional
from uuid import UUID

import structlog

from app.domain.corretor.service import CorretorService
from app.domain.conversa.service import ConversaService
from app.domain.imovel.service import ImovelService
from app.domain.cliente.service import ClienteService
from app.domain.auditoria.service import AuditoriaService
from app.integration.llm.agent import AgentOrchestrator
from app.integration.transcription.whisper import transcrever_audio
from app.integration.whatsapp.evolution import EvolutionClient
from app.shared.config import get_settings
from app.shared.database import get_session

log = structlog.get_logger()
settings = get_settings()


async def processar_conversa(job: dict) -> None:
    """Pipeline principal de processamento de uma mensagem."""
    trace = {"inicio": time.time()}

    tenant_id = UUID(job["tenant_id"])
    corretor_id = UUID(job["corretor_id"])
    mensagem_id = UUID(job["mensagem_id"])
    tipo = job.get("tipo", "text")
    audio_url = job.get("audio_url")

    async with get_session(tenant_id) as session:
        # --- Carrega estado do corretor ---
        corretor_service = CorretorService(session)
        corretor = await corretor_service.get_by_id(corretor_id)
        if not corretor:
            log.error("corretor_nao_encontrado", corretor_id=str(corretor_id)[:8])
            return

        conversa_service = ConversaService(session)
        auditoria_service = AuditoriaService(session)

        # --- Transcrita áudio se necessário ---
        conteudo = None
        if tipo == "audio" and audio_url:
            trace["transcricao_inicio"] = time.time()
            try:
                conteudo = await transcrever_audio(audio_url)
                if not conteudo or not conteudo.strip():
                    conteudo = None
            except Exception as e:
                log.warning("transcricao_falhou", error=str(e))
                conteudo = None
            trace["transcricao_fim"] = time.time()

            if not conteudo:
                # Falha de transcrição → pede reenvio por escrito
                await _enviar_resposta(
                    tenant_id=tenant_id,
                    corretor=corretor,
                    texto="Não consegui ouvir o áudio com clareza. Poderia me enviar a mensagem por escrito? 🙏",
                    session=session,
                    mensagem_id=mensagem_id,
                )
                return

            # Atualiza a mensagem com a transcrição
            from sqlalchemy.sql import text as sqltext
            await session.execute(
                sqltext("UPDATE mensagens SET transcricao=:t WHERE id=:id"),
                {"t": conteudo, "id": str(mensagem_id)},
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
                await corretor_service.bloquear(corretor.id)
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
            await _processar_confirmacao(
                confirmacao=confirmacao,
                resposta_corretor=conteudo.strip().lower(),
                session=session,
                tenant_id=tenant_id,
                corretor=corretor,
                auditoria_service=auditoria_service,
            )
            return

        # --- Monta contexto ---
        trace["contexto_inicio"] = time.time()
        historico = await conversa_service.historico(
            corretor_id=corretor_id,
            limit=settings.context_window_messages,
        )
        trace["contexto_fim"] = time.time()

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
        )
        trace["ia_fim"] = time.time()

        # --- Envia resposta ---
        await _enviar_resposta(
            tenant_id=tenant_id,
            corretor=corretor,
            texto=resposta.texto,
            session=session,
            mensagem_id=mensagem_id,
            trace=trace,
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


async def _processar_confirmacao(
    confirmacao,
    resposta_corretor: str,
    session,
    tenant_id: UUID,
    corretor,
    auditoria_service: AuditoriaService,
) -> None:
    """
    Processa a confirmação/negação de uma operação de escrita pendente.
    """
    from sqlalchemy.sql import text as sqltext

    afirmativo = resposta_corretor in ("sim", "s", "confirmar", "confirmo", "ok", "yes")
    negativo = resposta_corretor in ("não", "nao", "n", "cancelar", "cancelo", "no")

    await session.execute(
        sqltext("UPDATE confirmacoes_pendentes SET respondido=TRUE WHERE id=:id"),
        {"id": str(confirmacao.id)},
    )

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
            return

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

    elif negativo:
        await _enviar_resposta(
            tenant_id=tenant_id, corretor=corretor,
            texto="OK! Operação cancelada. Como posso ajudar?",
            session=session,
        )
    else:
        # Resposta ambígua — aguarda confirmação clara
        await _enviar_resposta(
            tenant_id=tenant_id, corretor=corretor,
            texto="Para confirmar a operação, responda *sim* ou *não*.",
            session=session,
        )


async def _enviar_resposta(
    tenant_id: UUID,
    corretor,
    texto: str,
    session,
    mensagem_id: Optional[UUID] = None,
    trace: Optional[dict] = None,
) -> None:
    """Envia mensagem via Evolution API e persiste no banco."""
    from sqlalchemy.sql import text as sqltext
    from app.integration.whatsapp.evolution import EvolutionClient

    # Busca instância WhatsApp do tenant
    row = await session.execute(
        sqltext("SELECT instance_id FROM whatsapp_sessions WHERE tenant_id=:tid AND status='connected' LIMIT 1"),
        {"tid": str(tenant_id)},
    )
    ws = row.first()
    if not ws:
        log.error("sem_sessao_whatsapp_ativa", tenant_id=str(tenant_id)[:8])
        return

    client = EvolutionClient()
    try:
        await client.send_text(
            instance_id=ws.instance_id,
            to=corretor.telefone,
            text=texto,
        )
    except Exception as e:
        log.error("envio_whatsapp_falhou", error=str(e))
        return

    # Persiste a mensagem de saída
    await session.execute(
        sqltext("""
            INSERT INTO mensagens (tenant_id, corretor_id, message_id, direcao, tipo, conteudo, status, trace)
            VALUES (:tid, :cid, :mid, 'outbound', 'text', :conteudo, 'sent', :trace::jsonb)
        """),
        {
            "tid": str(tenant_id),
            "cid": str(corretor.id),
            "mid": f"out_{int(time.time() * 1000)}",
            "conteudo": texto,
            "trace": json.dumps(trace or {}),
        },
    )

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
