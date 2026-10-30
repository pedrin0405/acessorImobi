"""
Processo Scheduler — execução de tarefas periódicas em segundo plano.
- Sincronização incremental do Imoview a cada 30 minutos
- Reprocessamento de pendências de escrita no CRM a cada 5 minutos
- Health check das sessões de WhatsApp a cada 2 minutos
- Expurgo LGPD diário de mensagens e confirmações expiradas
- Lembretes de compromissos do CRM (a cada 5 min, no horário comercial)
- Briefing diário do corretor (verifica a cada 15 min; um por dia)
"""
import asyncio
import json
from datetime import datetime, timedelta
from types import SimpleNamespace
from uuid import UUID
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
import structlog
from sqlalchemy.sql import text

from app.domain.cliente.service import ClienteService
from app.domain.conversa.memoria import job_backfill_memoria
from app.integration.imoview.client import ImoviewClient
from app.integration.whatsapp.evolution import EvolutionClient
from app.domain.imovel.sync import processar_pedidos, sincronizar_tenant
from app.shared.config import get_settings
from app.shared.database import get_admin_session, get_session
from app.shared.security import decrypt_credentials

log = structlog.get_logger()
settings = get_settings()


async def sync_imoveis_por_tenant(tenant_id: UUID, imoview_creds: bytes = b""):
    """Sincroniza os imóveis do Imoview com o cache (lógica em app/domain/imovel/sync.py)."""
    await sincronizar_tenant(tenant_id, origem="agendada")


async def job_sync_pedidos():
    """Atende, em poucos segundos, as sincronizações pedidas pelo portal ("Sincronizar agora")."""
    from app.domain.crm.importacao_imoview import processar_pedidos as processar_pedidos_leads

    await processar_pedidos()
    await processar_pedidos_leads()


async def job_sync_imoveis():
    """Roda a cada 30 minutos para todos os tenants ativos."""
    log.info("job_sync_imoveis_iniciando")
    async with get_admin_session() as session:
        rows = await session.execute(
            text("SELECT id, imoview_creds FROM tenants WHERE status = 'active' AND imoview_creds IS NOT NULL")
        )
        tenants = rows.fetchall()

    for tid, creds in tenants:
        await sync_imoveis_por_tenant(tid, creds)


async def job_retry_pendencias():
    """Tenta reprocessar pendências de escrita no Imoview a cada 5 minutos."""
    log.info("job_retry_pendencias_iniciando")
    async with get_admin_session() as session:
        rows = await session.execute(
            text("""
                SELECT id, tenant_id, corretor_id, tipo, payload, tentativas
                FROM pendencias_crm
                WHERE resolvido = FALSE AND tentativas < 5
                ORDER BY created_at ASC
                LIMIT 20
            """)
        )
        pendencias = rows.fetchall()

    for p in pendencias:
        pid, tid, cid, tipo, payload, tentativas = p
        async with get_session(tid) as tenant_session:
            cliente_service = ClienteService(tenant_session)
            try:
                if tipo == "criar_cliente":
                    await cliente_service.criar_no_imoview(tid, payload)
                elif tipo == "atualizar_cliente":
                    await cliente_service.atualizar_no_imoview(tid, payload)

                await tenant_session.execute(
                    text("UPDATE pendencias_crm SET resolvido = TRUE, updated_at = NOW() WHERE id = :id"),
                    {"id": str(pid)},
                )
                log.info("pendencia_crm_resolvida", pendencia_id=str(pid))

            except Exception as e:
                await tenant_session.execute(
                    text("""
                        UPDATE pendencias_crm
                        SET tentativas = tentativas + 1, ultimo_erro = :err, updated_at = NOW()
                        WHERE id = :id
                    """),
                    {"id": str(pid), "err": str(e)[:500]},
                )
                log.warning("retry_pendencia_falhou", pendencia_id=str(pid), erro=str(e)[:100])


async def job_health_check_whatsapp():
    """Verifica e atualiza o estado de conexão das sessões de WhatsApp a cada 2 minutos."""
    evolution = EvolutionClient()
    async with get_admin_session() as session:
        rows = await session.execute(
            text("""
                SELECT ws.id, ws.instance_id, ws.status, ws.tipo, c.telefone AS corretor_telefone
                FROM whatsapp_sessions ws
                LEFT JOIN corretores c ON c.id = ws.corretor_id
            """)
        )
        sessions = rows.fetchall()

    for sid, instance_id, status_atual, tipo, corretor_telefone in sessions:
        try:
            res = await evolution.get_instance_status(instance_id)
            state = res.get("instance", {}).get("state", "disconnected")
            novo_status = "connected" if state == "open" else "disconnected"

            # Número pessoal só vira "connected" (o que libera a leitura das
            # conversas) se o número pareado for o do próprio corretor.
            if tipo == "corretor" and novo_status == "connected" and status_atual != "connected":
                from app.domain.whatsapp.corretor import numero_confere

                info = await evolution.get_instance_info(instance_id) or {}
                owner = str(info.get("ownerJid") or "").split("@")[0]
                if not owner:
                    # Não deu para verificar agora: não promove nem desconecta.
                    continue
                if not numero_confere(owner, corretor_telefone):
                    await evolution.logout_instance(instance_id)
                    novo_status = "disconnected"
                    log.warning("whatsapp_corretor_numero_divergente", instance_id=instance_id)

            if novo_status != status_atual:
                async with get_admin_session() as session_up:
                    await session_up.execute(
                        text("UPDATE whatsapp_sessions SET status = :st, last_seen = NOW() WHERE id = :id"),
                        {"st": novo_status, "id": str(sid)},
                    )
                log.info("whatsapp_status_mudou", instance_id=instance_id, novo_status=novo_status)
        except Exception:
            pass


async def job_lembretes_atividades():
    """Lembra o corretor dos compromissos conforme as regras da imobiliária (Configurações → Lembretes)."""
    from datetime import time as hora_do_dia

    from app.domain.configuracoes.padroes import lembretes_padrao, regra_do_lembrete
    from app.domain.crm.mensagens import dentro_da_janela, texto_lembrete, texto_lembrete_regra
    from app.worker.pipeline import _enviar_resposta

    async with get_admin_session() as session:
        rows = await session.execute(
            text("""
                SELECT a.id, a.tenant_id, a.titulo, a.tipo, a.inicio, a.local, a.imovel_codigo, a.lembrete_min,
                       c.id AS corretor_id, c.telefone, c.nome AS corretor_nome,
                       (SELECT l.nome FROM crm_leads l WHERE l.id = a.lead_id) AS cliente_nome,
                       t.fuso, t.horario_inicio, t.horario_fim, t.dados
                FROM crm_atividades a
                JOIN corretores c ON c.id = a.corretor_id AND c.status = 'active'
                JOIN tenants t ON t.id = a.tenant_id AND t.status = 'active'
                WHERE a.status = 'aberta'
                  AND a.lembrete_enviado_em IS NULL
                  AND a.lembrete_min > 0
                  AND a.inicio > NOW()
                  AND a.inicio - make_interval(mins => a.lembrete_min) <= NOW()
                LIMIT 200
            """)
        )
        pendentes = rows.fetchall()

    for a in pendentes:
        fuso = ZoneInfo(a.fuso or settings.usage_timezone)
        dados = a.dados if isinstance(a.dados, dict) else {}
        regras = dados.get("lembretes") if isinstance(dados.get("lembretes"), list) else lembretes_padrao()
        regra = regra_do_lembrete(regras, a.tipo, a.lembrete_min)
        # Fora da janela de envio o lembrete espera ela abrir; se o compromisso
        # começar antes disso, não é mandado de madrugada. A regra define a janela;
        # sem regra (ex.: atividade antiga), vale o horário comercial da imobiliária.
        inicio_janela, fim_janela = a.horario_inicio, a.horario_fim
        if regra:
            inicio_janela = hora_do_dia.fromisoformat(regra["janela_inicio"])
            fim_janela = hora_do_dia.fromisoformat(regra["janela_fim"])
        if not dentro_da_janela(datetime.now(fuso), inicio_janela, fim_janela):
            continue
        atividade = {
            "titulo": a.titulo, "tipo": a.tipo, "inicio": a.inicio.isoformat(),
            "local": a.local, "imovel_codigo": a.imovel_codigo,
        }
        texto = (
            texto_lembrete_regra(regra, atividade, fuso, a.corretor_nome, a.cliente_nome, dados.get("tipos_atividade"))
            if regra else texto_lembrete(atividade, fuso)
        )
        try:
            async with get_session(a.tenant_id) as session:
                await _enviar_resposta(
                    tenant_id=a.tenant_id,
                    corretor=SimpleNamespace(id=a.corretor_id, telefone=a.telefone),
                    texto=texto,
                    session=session,
                )
                await session.execute(
                    text("UPDATE crm_atividades SET lembrete_enviado_em = NOW() WHERE id = :id"),
                    {"id": str(a.id)},
                )
            log.info("crm_lembrete_enviado", tenant_id=str(a.tenant_id)[:8])
        except Exception as e:
            log.warning("crm_lembrete_falhou", error=str(e)[:200])


async def job_briefing_diario():
    """Briefing no WhatsApp de cada corretor, uma vez por dia, ao abrir o horário comercial."""
    from app.domain.crm.mensagens import dentro_da_janela, texto_briefing
    from app.domain.crm.service import CrmService
    from app.worker.pipeline import _enviar_resposta

    async with get_admin_session() as session:
        rows = await session.execute(
            text("""
                SELECT t.id AS tenant_id, t.fuso, t.horario_inicio, t.horario_fim,
                       c.id AS corretor_id, c.nome, c.telefone
                FROM tenants t
                JOIN corretores c ON c.tenant_id = t.id AND c.status = 'active'
                WHERE t.status = 'active'
            """)
        )
        corretores = rows.fetchall()

    for c in corretores:
        fuso = ZoneInfo(c.fuso or settings.usage_timezone)
        agora = datetime.now(fuso)
        if not dentro_da_janela(agora, c.horario_inicio, c.horario_fim):
            continue
        inicio_dia = agora.replace(hour=0, minute=0, second=0, microsecond=0)
        try:
            async with get_session(c.tenant_id) as session:
                # Reserva o dia antes de montar: dois ciclos não mandam duplicado.
                reservado = await session.execute(
                    text("""
                        INSERT INTO crm_briefings (tenant_id, corretor_id, dia)
                        VALUES (:tid, :cid, :dia) ON CONFLICT DO NOTHING RETURNING dia
                    """),
                    {"tid": str(c.tenant_id), "cid": str(c.corretor_id), "dia": inicio_dia.date()},
                )
                if not reservado.first():
                    continue
                dados = await CrmService(session).dados_briefing(
                    c.tenant_id, c.corretor_id, inicio_dia, inicio_dia + timedelta(days=1)
                )
                texto = texto_briefing(c.nome, dados, fuso)
                if texto:
                    await _enviar_resposta(
                        tenant_id=c.tenant_id,
                        corretor=SimpleNamespace(id=c.corretor_id, telefone=c.telefone),
                        texto=texto,
                        session=session,
                    )
                    log.info("crm_briefing_enviado", tenant_id=str(c.tenant_id)[:8])
        except Exception as e:
            log.warning("crm_briefing_falhou", error=str(e)[:200])


async def job_despachar_analises():
    """Manda ao worker os atendimentos cuja análise venceu (debounce na ingestão)."""
    import time as _time

    from app.domain.atendimento.ingestao import FILA_ANALISE
    from app.shared.redis import get_redis_pool

    redis = get_redis_pool()
    vencidos = await redis.zrangebyscore(FILA_ANALISE, 0, _time.time(), start=0, num=100)
    for membro in vencidos:
        if not await redis.zrem(FILA_ANALISE, membro):
            continue  # outro ciclo já despachou
        tenant_id, corretor_id, atendimento_id = membro.split(":")
        fila = f"queue:conversa:{tenant_id}:{corretor_id}"
        await redis.rpush(fila, json.dumps({
            "tipo_job": "analisar_atendimento",
            "tenant_id": tenant_id,
            "corretor_id": corretor_id,
            "atendimento_id": atendimento_id,
        }))
        await redis.sadd("queue:active_conversations", fila)
    if vencidos:
        log.info("atendimentos_despachados", quantidade=len(vencidos))


async def job_importar_historico_atendimentos():
    """Traz da Evolution as conversas do WhatsApp pessoal que ainda não entraram (histórico recente e lacunas)."""
    from app.domain.atendimento.historico import importar_pendentes

    await importar_pendentes()


async def job_expurgo_lgpd():
    """Expurga mensagens antigas conforme política de retenção do tenant (executado às 03:00)."""
    log.info("job_expurgo_lgpd_iniciando")
    async with get_admin_session() as session:
        # Expurga mensagens com mais de N dias
        await session.execute(
            text("""
                DELETE FROM mensagens
                WHERE created_at < NOW() - INTERVAL '180 days'
            """)
        )
        # Conversas observadas no WhatsApp pessoal seguem a mesma retenção
        await session.execute(
            text("""
                DELETE FROM atendimento_mensagens
                WHERE created_at < NOW() - INTERVAL '180 days'
            """)
        )
        # Expurga confirmações antigas respondidas ou expiradas há mais de 7 dias
        await session.execute(
            text("""
                DELETE FROM confirmacoes_pendentes
                WHERE expirado_em < NOW() - INTERVAL '7 days'
            """)
        )
    log.info("job_expurgo_lgpd_concluido")


def main():
    structlog.configure(
        processors=[
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ]
    )
    log.info("acessorImobi scheduler iniciando")

    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        job_sync_imoveis,
        "interval",
        minutes=settings.imoview_sync_interval_minutes,
        # Executa no boot: senão o cache fica vazio até o primeiro intervalo.
        next_run_time=datetime.now(),
    )
    scheduler.add_job(job_sync_pedidos, "interval", seconds=10, max_instances=1, coalesce=True)
    from app.domain.crm.importacao_imoview import job_sync_leads, job_sync_leads_completo

    # Leads do Imoview: leitura incremental a cada 30 min (a primeira vez importa tudo) e completa aos domingos.
    scheduler.add_job(job_sync_leads, "interval", minutes=30, max_instances=1, coalesce=True, next_run_time=datetime.now() + timedelta(seconds=45))
    scheduler.add_job(job_sync_leads_completo, "cron", day_of_week="sun", hour=4, minute=30, max_instances=1, coalesce=True)
    scheduler.add_job(job_retry_pendencias, "interval", minutes=5)
    scheduler.add_job(job_health_check_whatsapp, "interval", minutes=2)
    scheduler.add_job(job_expurgo_lgpd, "cron", hour=3, minute=0)
    scheduler.add_job(job_lembretes_atividades, "interval", minutes=5)
    scheduler.add_job(job_briefing_diario, "interval", minutes=15)
    scheduler.add_job(job_despachar_analises, "interval", minutes=1)
    scheduler.add_job(job_importar_historico_atendimentos, "interval", minutes=2, next_run_time=datetime.now())
    scheduler.add_job(job_backfill_memoria, "interval", minutes=3, max_instances=1, coalesce=True)

    scheduler.start()

    loop = asyncio.get_event_loop()
    try:
        loop.run_forever()
    except (KeyboardInterrupt, SystemExit):
        scheduler.shutdown()


if __name__ == "__main__":
    main()
