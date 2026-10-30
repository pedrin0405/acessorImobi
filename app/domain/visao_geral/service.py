"""Indicadores da Visão Geral: uso do assistente, clientes, agenda, carteira de imóveis e integrações.

Tudo é agregado no servidor sobre dados reais; períodos sem dados voltam zerados, nunca inventados.
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

PERIODOS = {7: "day", 30: "day", 90: "week", 365: "month"}


def _fator(dias: int) -> str:
    return PERIODOS.get(dias, "day")


def _num(v: Any) -> float:
    return float(v) if v is not None else 0.0


class VisaoGeralService:
    def __init__(self, session: AsyncSession, tenant_id: UUID):
        self._s = session
        self._tid = str(tenant_id)

    async def _um(self, sql: str, **p: Any):
        return (await self._s.execute(text(sql), {"tid": self._tid, **p})).first()

    async def _todos(self, sql: str, **p: Any):
        return (await self._s.execute(text(sql), {"tid": self._tid, **p})).fetchall()

    async def gerar(self, dias: int) -> Dict[str, Any]:
        dias = dias if dias in PERIODOS else 30
        agora = datetime.now(timezone.utc)
        desde = agora - timedelta(days=dias)
        ant = desde - timedelta(days=dias)
        ten = await self._um("SELECT nome, fuso, imoview_creds IS NOT NULL AS tem_imoview FROM tenants WHERE id = :tid")
        fuso = (ten.fuso if ten and ten.fuso else "America/Sao_Paulo")

        # --- assistente -------------------------------------------------------------
        uso = await self._um(
            """SELECT COUNT(*) FILTER (WHERE direcao = 'inbound') AS recebidas,
                      COUNT(*) FILTER (WHERE direcao = 'outbound') AS respondidas,
                      COUNT(*) FILTER (WHERE tipo = 'audio') AS audios,
                      COUNT(DISTINCT corretor_id) AS corretores_usando,
                      AVG(CASE WHEN direcao = 'outbound' AND trace ? 'ia_fim' AND trace ? 'inicio'
                               THEN (trace->>'ia_fim')::float - (trace->>'inicio')::float END) AS resposta_s
               FROM mensagens WHERE tenant_id = :tid AND created_at >= :desde""",
            desde=desde,
        )
        anterior = await self._um(
            "SELECT COUNT(*) AS n FROM mensagens WHERE tenant_id = :tid AND direcao = 'inbound' AND created_at >= :a AND created_at < :b",
            a=ant, b=desde,
        )
        ativos = (await self._um("SELECT COUNT(*) AS n FROM corretores WHERE tenant_id = :tid AND status = 'active'")).n
        pendentes = (await self._um("SELECT COUNT(*) AS n FROM corretores WHERE tenant_id = :tid AND status = 'pending'")).n

        # --- clientes ----------------------------------------------------------------
        cli = await self._um(
            """SELECT COUNT(*) FILTER (WHERE status <> 'arquivado') AS total,
                      COUNT(*) FILTER (WHERE status <> 'arquivado' AND corretor_id IS NULL) AS sem_responsavel,
                      COUNT(*) FILTER (WHERE status <> 'arquivado' AND created_at >= :desde) AS novos,
                      COUNT(*) FILTER (WHERE status <> 'arquivado' AND created_at >= :a AND created_at < :desde) AS novos_antes,
                      COUNT(*) FILTER (WHERE status = 'cliente') AS viraram_cliente
               FROM crm_leads WHERE tenant_id = :tid""",
            desde=desde, a=ant,
        )
        origens = await self._todos(
            """SELECT origem, COUNT(*) AS n FROM crm_leads
               WHERE tenant_id = :tid AND status <> 'arquivado' AND created_at >= :desde GROUP BY origem ORDER BY n DESC""",
            desde=desde,
        )
        temperaturas = await self._todos(
            "SELECT temperatura, COUNT(*) AS n FROM crm_leads WHERE tenant_id = :tid AND status <> 'arquivado' GROUP BY temperatura",
        )
        funil = await self._todos(
            """SELECT e.nome, e.cor, COUNT(n.id) AS n
               FROM crm_etapas e LEFT JOIN crm_negocios n ON n.etapa_id = e.id AND n.status = 'aberto'
               WHERE e.tenant_id = :tid GROUP BY e.id, e.nome, e.cor, e.ordem ORDER BY e.ordem""",
        )
        ganhos = (await self._um(
            "SELECT COUNT(*) AS n FROM crm_negocios WHERE tenant_id = :tid AND status = 'ganho' AND fechado_em >= :desde", desde=desde,
        )).n

        # --- conversas esperando resposta ---------------------------------------------
        espera = await self._todos(
            """SELECT a.id, a.nome_contato, a.telefone_cliente, a.ultima_do_cliente_em, c.nome AS corretor_nome
               FROM atendimentos a LEFT JOIN corretores c ON c.id = a.corretor_id
               WHERE a.tenant_id = :tid AND a.aguardando_corretor ORDER BY a.ultima_do_cliente_em DESC NULLS LAST LIMIT 6""",
        )
        espera_total = (await self._um(
            "SELECT COUNT(*) AS n FROM atendimentos WHERE tenant_id = :tid AND aguardando_corretor",
        )).n

        # --- agenda ---------------------------------------------------------------------
        ag = await self._um(
            """SELECT COUNT(*) FILTER (WHERE status = 'aberta' AND inicio < NOW()) AS atrasadas,
                      COUNT(*) FILTER (WHERE status = 'aberta' AND inicio >= NOW() AND inicio < NOW() + INTERVAL '7 days') AS proximas,
                      COUNT(*) FILTER (WHERE status = 'concluida' AND inicio >= :desde) AS concluidas,
                      COUNT(*) FILTER (WHERE tipo = 'visita' AND status = 'concluida' AND inicio >= :desde) AS visitas_feitas,
                      COUNT(*) FILTER (WHERE tipo = 'visita' AND status = 'aberta' AND inicio >= NOW()) AS visitas_marcadas
               FROM crm_atividades WHERE tenant_id = :tid""",
            desde=desde,
        )

        # --- imóveis ---------------------------------------------------------------------
        im = await self._um(
            """SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE ativo) AS ativos,
                      COUNT(*) FILTER (WHERE ativo AND finalidade = 'venda') AS venda,
                      COUNT(*) FILTER (WHERE ativo AND finalidade = 'aluguel') AS aluguel,
                      COUNT(*) FILTER (WHERE ativo AND destaque) AS destaques
               FROM imoveis_cache WHERE tenant_id = :tid""",
        )
        indicados = await self._todos(
            """SELECT m.imovel_codigo AS codigo, COUNT(*) AS n, MAX(i.tipo) AS tipo, MAX(i.bairro) AS bairro, MAX(i.valor) AS valor
               FROM crm_matches m LEFT JOIN imoveis_cache i ON i.tenant_id = m.tenant_id AND i.codigo_imoview = m.imovel_codigo
               WHERE m.tenant_id = :tid AND m.notificado_em >= :desde GROUP BY m.imovel_codigo ORDER BY n DESC LIMIT 5""",
            desde=desde,
        )
        sync = await self._um("SELECT estado, ultimo_sucesso_em, erro FROM imoview_sync_status WHERE tenant_id = :tid")

        # --- série temporal ---------------------------------------------------------------
        b = _fator(dias)
        serie = await self._todos(
            f"""WITH passos AS (
                    SELECT generate_series(date_trunc('{b}', CAST(:desde AS timestamptz) AT TIME ZONE :fuso),
                                           date_trunc('{b}', NOW() AT TIME ZONE :fuso), INTERVAL '1 {b}') AS d)
                SELECT p.d AS dia,
                  (SELECT COUNT(*) FROM mensagens m WHERE m.tenant_id = :tid AND m.direcao = 'inbound' AND m.created_at >= :desde
                     AND date_trunc('{b}', m.created_at AT TIME ZONE :fuso) = p.d) AS mensagens,
                  (SELECT COUNT(*) FROM crm_leads l WHERE l.tenant_id = :tid AND l.status <> 'arquivado' AND l.created_at >= :desde
                     AND date_trunc('{b}', l.created_at AT TIME ZONE :fuso) = p.d) AS clientes
                FROM passos p ORDER BY p.d""",
            desde=desde, fuso=fuso,
        )

        # --- ranking de corretores ---------------------------------------------------------
        ranking = await self._todos(
            """SELECT c.id, c.nome, c.status, c.foto_atualizada_em,
                      (c.foto_ref IS NOT NULL) AS tem_foto,
                      (SELECT COUNT(*) FROM mensagens m WHERE m.corretor_id = c.id AND m.direcao = 'inbound' AND m.created_at >= :desde) AS mensagens,
                      (SELECT COUNT(*) FROM crm_atividades a WHERE a.corretor_id = c.id AND a.status = 'concluida' AND a.inicio >= :desde) AS atividades,
                      (SELECT COUNT(*) FROM crm_leads l WHERE l.corretor_id = c.id AND l.status <> 'arquivado') AS clientes
               FROM corretores c WHERE c.tenant_id = :tid AND c.status = 'active' ORDER BY 6 DESC, 7 DESC, c.nome LIMIT 8""",
            desde=desde,
        )

        # --- integrações -------------------------------------------------------------------
        sessoes = await self._todos("SELECT tipo, status FROM whatsapp_sessions WHERE tenant_id = :tid")
        agente_ok = any(s.tipo == "agente" and s.status == "connected" for s in sessoes)
        pessoais = sum(1 for s in sessoes if s.tipo == "corretor" and s.status == "connected")
        pendencias = (await self._um("SELECT COUNT(*) AS n FROM pendencias_crm WHERE tenant_id = :tid AND NOT resolvido")).n

        iso = lambda v: v.isoformat() if v else None  # noqa: E731
        return {
            "periodo": {"dias": dias, "desde": desde.isoformat(), "bucket": b},
            "imobiliaria": ten.nome if ten else "",
            "assistente": {
                "corretores_ativos": ativos, "corretores_pendentes": pendentes, "corretores_usando": uso.corretores_usando,
                "mensagens": uso.recebidas, "mensagens_antes": anterior.n, "respostas": uso.respondidas, "audios": uso.audios,
                "resposta_media_s": round(_num(uso.resposta_s), 1) if uso.resposta_s is not None else None,
            },
            "clientes": {
                "total": cli.total, "sem_responsavel": cli.sem_responsavel, "novos": cli.novos, "novos_antes": cli.novos_antes,
                "viraram_cliente": cli.viraram_cliente, "negocios_ganhos": ganhos,
                "origens": [{"origem": o.origem, "n": o.n} for o in origens],
                "temperaturas": {t.temperatura: t.n for t in temperaturas},
                "funil": [{"etapa": f.nome, "cor": f.cor, "n": f.n} for f in funil],
            },
            "espera": {
                "total": espera_total,
                "itens": [{"id": str(e.id), "nome": e.nome_contato or e.telefone_cliente, "corretor": e.corretor_nome, "desde": iso(e.ultima_do_cliente_em)} for e in espera],
            },
            "agenda": {"atrasadas": ag.atrasadas, "proximas": ag.proximas, "concluidas": ag.concluidas, "visitas_feitas": ag.visitas_feitas, "visitas_marcadas": ag.visitas_marcadas},
            "imoveis": {
                "total": im.total, "ativos": im.ativos, "venda": im.venda, "aluguel": im.aluguel, "destaques": im.destaques,
                "indicados": [{"codigo": i.codigo, "vezes": i.n, "tipo": i.tipo, "bairro": i.bairro, "valor": _num(i.valor) or None} for i in indicados],
            },
            "serie": [{"dia": s.dia.date().isoformat(), "mensagens": s.mensagens, "clientes": s.clientes} for s in serie],
            "ranking": [
                {"id": str(r.id), "nome": r.nome, "mensagens": r.mensagens, "atividades": r.atividades, "clientes": r.clientes,
                 "foto_url": f"/admin/corretores/{r.id}/foto?v={int(r.foto_atualizada_em.timestamp())}" if r.tem_foto and r.foto_atualizada_em else None}
                for r in ranking
            ],
            "integracoes": {
                "whatsapp_agente": agente_ok, "whatsapp_pessoais": pessoais,
                "imoview_configurado": bool(ten.tem_imoview) if ten else False,
                "imoview_ultima_sync": iso(sync.ultimo_sucesso_em) if sync else None,
                "imoview_erro": sync.erro if sync and sync.estado == "erro" else None,
                "pendencias_crm": pendencias,
            },
        }
