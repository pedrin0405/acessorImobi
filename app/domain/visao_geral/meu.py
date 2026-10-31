"""Painel pessoal do corretor: o mesmo espírito da Visão Geral da gestão, só com a carteira dele."""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def _n(v: Any) -> float:
    return float(v or 0)


class MeuPainel:
    def __init__(self, session: AsyncSession, tenant_id: UUID, corretor_id: UUID):
        self._s, self._tid, self._cid = session, str(tenant_id), str(corretor_id)

    async def _um(self, sql: str, **p: Any):
        return (await self._s.execute(text(sql), {"tid": self._tid, "cid": self._cid, **p})).first()

    async def _todos(self, sql: str, **p: Any):
        return (await self._s.execute(text(sql), {"tid": self._tid, "cid": self._cid, **p})).fetchall()

    async def gerar(self, dias: int) -> Dict[str, Any]:
        t = await self._um("SELECT nome, fuso FROM tenants WHERE id = :tid")
        fuso = ZoneInfo(t.fuso or "America/Sao_Paulo")
        agora = datetime.now(timezone.utc)
        desde = agora - timedelta(days=dias)
        hoje0 = datetime.now(fuso).replace(hour=0, minute=0, second=0, microsecond=0)
        c = await self._um("SELECT nome FROM corretores WHERE id = :cid AND tenant_id = :tid")

        carteira = await self._um(
            """SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE temperatura = 'quente') AS quentes,
                      COUNT(*) FILTER (WHERE temperatura = 'morno') AS mornos, COUNT(*) FILTER (WHERE temperatura = 'frio') AS frios,
                      COUNT(*) FILTER (WHERE created_at >= :desde) AS novos
               FROM crm_leads WHERE tenant_id = :tid AND corretor_id = :cid AND status <> 'arquivado'""", desde=desde)
        funil = await self._todos(
            """SELECT e.nome, e.cor, e.ordem, COUNT(n.id) AS quantidade, COALESCE(SUM(n.valor), 0) AS total, e.probabilidade
               FROM crm_etapas e LEFT JOIN crm_negocios n ON n.etapa_id = e.id AND n.status = 'aberto' AND n.corretor_id = :cid
               WHERE e.tenant_id = :tid GROUP BY e.id, e.nome, e.cor, e.ordem, e.probabilidade ORDER BY e.ordem""")
        fechados = await self._um(
            """SELECT COUNT(*) FILTER (WHERE status = 'ganho' AND fechado_em >= :desde) AS ganhos,
                      COALESCE(SUM(valor) FILTER (WHERE status = 'ganho' AND fechado_em >= :desde), 0) AS valor_ganho,
                      COUNT(*) FILTER (WHERE status = 'perdido' AND fechado_em >= :desde) AS perdidos
               FROM crm_negocios WHERE tenant_id = :tid AND corretor_id = :cid""", desde=desde)
        agenda = await self._um(
            """SELECT COUNT(*) FILTER (WHERE status = 'aberta' AND inicio >= :hoje AND inicio < :amanha) AS hoje,
                      COUNT(*) FILTER (WHERE status = 'aberta' AND inicio < :agora) AS atrasadas,
                      COUNT(*) FILTER (WHERE status = 'aberta' AND inicio >= :agora AND inicio < :semana) AS semana,
                      COUNT(*) FILTER (WHERE status = 'concluida' AND inicio >= :desde) AS concluidas
               FROM crm_atividades WHERE tenant_id = :tid AND corretor_id = :cid""",
            hoje=hoje0, amanha=hoje0 + timedelta(days=1), agora=agora, semana=agora + timedelta(days=7), desde=desde)
        proximas = await self._todos(
            """SELECT a.id, a.tipo, a.titulo, a.inicio, l.nome AS cliente FROM crm_atividades a LEFT JOIN crm_leads l ON l.id = a.lead_id
               WHERE a.tenant_id = :tid AND a.corretor_id = :cid AND a.status = 'aberta' AND a.inicio IS NOT NULL
               ORDER BY a.inicio LIMIT 6""")
        esperando = await self._todos(
            """SELECT a.id, COALESCE(l.nome, a.nome_contato) AS nome, a.ultima_do_cliente_em FROM atendimentos a LEFT JOIN crm_leads l ON l.id = a.lead_id
               WHERE a.tenant_id = :tid AND a.corretor_id = :cid AND a.aguardando_corretor ORDER BY a.ultima_do_cliente_em DESC NULLS LAST LIMIT 6""")
        msgs = await self._um(
            """SELECT COUNT(*) FILTER (WHERE direcao = 'inbound') AS enviadas_ao_agente, COUNT(*) FILTER (WHERE direcao = 'outbound') AS respostas
               FROM mensagens WHERE tenant_id = :tid AND corretor_id = :cid AND created_at >= :desde""", desde=desde)
        quentes = await self._todos(
            """SELECT l.id, l.nome, l.telefone, l.ultimo_contato FROM crm_leads l
               WHERE l.tenant_id = :tid AND l.corretor_id = :cid AND l.status <> 'arquivado' AND l.temperatura = 'quente'
               ORDER BY l.ultimo_contato DESC NULLS LAST, l.updated_at DESC LIMIT 6""")
        travados = await self._todos(
            """SELECT n.id, l.nome, e.nome AS etapa, n.valor, EXTRACT(DAY FROM NOW() - n.etapa_desde)::int AS dias
               FROM crm_negocios n JOIN crm_etapas e ON e.id = n.etapa_id JOIN crm_leads l ON l.id = n.lead_id
               WHERE n.tenant_id = :tid AND n.corretor_id = :cid AND n.status = 'aberto' AND NOT n.automatico AND e.alerta_dias IS NOT NULL
                 AND n.etapa_desde < NOW() - make_interval(days => e.alerta_dias) ORDER BY n.etapa_desde LIMIT 6""")

        iso = lambda v: v.isoformat() if v else None  # noqa: E731
        abertos = sum(int(f.quantidade) for f in funil)
        total = sum(_n(f.total) for f in funil)
        return {
            "periodo_dias": dias, "corretor": c.nome if c else None, "imobiliaria": t.nome,
            "carteira": {k: int(v or 0) for k, v in carteira._mapping.items()},
            "funil": [{"etapa": f.nome, "cor": f.cor, "quantidade": int(f.quantidade), "total": _n(f.total),
                       "esperado": round(_n(f.total) * f.probabilidade / 100, 2)} for f in funil],
            "negocios": {"abertos": abertos, "valor_aberto": round(total, 2), "valor_esperado": round(sum(_n(f.total) * f.probabilidade / 100 for f in funil), 2),
                         "ganhos": int(fechados.ganhos or 0), "valor_ganho": _n(fechados.valor_ganho), "perdidos": int(fechados.perdidos or 0)},
            "agenda": {k: int(v or 0) for k, v in agenda._mapping.items()},
            "proximas_atividades": [{"id": str(a.id), "tipo": a.tipo, "titulo": a.titulo, "inicio": iso(a.inicio), "cliente": a.cliente} for a in proximas],
            "aguardando_resposta": [{"id": str(a.id), "nome": a.nome, "desde": iso(a.ultima_do_cliente_em)} for a in esperando],
            "mensagens": {k: int(v or 0) for k, v in msgs._mapping.items()},
            "clientes_quentes": [{"id": str(l.id), "nome": l.nome, "telefone": l.telefone, "ultimo_contato": iso(l.ultimo_contato)} for l in quentes],
            "negocios_travados": [{"id": str(n.id), "nome": n.nome, "etapa": n.etapa, "valor": _n(n.valor), "dias": n.dias} for n in travados],
        }
