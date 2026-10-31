"""
Linha do tempo de um cliente: tudo que aconteceu com ele, de todas as fontes, da mais recente para a mais antiga.

Fontes: cadastro, funil (movimentos do negócio), agenda, conversa do corretor no WhatsApp pessoal, ações registradas
(auditoria) e o CRM do Imoview (interações, visitas, propostas e negócios). Cada evento diz quem fez (corretor, cliente,
equipe do portal, Imoview ou sistema) e de onde veio.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import text

LIMITE_MENSAGENS = 80
ROTULO_ATIVIDADE = {"visita": "visita", "reuniao": "reunião", "ligacao": "ligação", "follow_up": "follow-up", "whatsapp": "mensagem",
                    "tarefa": "tarefa", "email": "e-mail", "documento": "documento"}
ACOES_AUDITORIA = {
    "crm_registrar_lead": "Registrou o cliente na carteira", "crm_atualizar_lead": "Atualizou os dados do cliente",
    "crm_criar_negocio": "Abriu um negócio", "crm_mover_negocio": "Moveu o negócio", "crm_agendar": "Agendou um compromisso",
    "crm_concluir_atividade": "Concluiu um compromisso", "atribuir_cliente": "Atribuiu o cliente a um corretor",
    "enviar_imoveis_portal": "Enviou imóveis ao corretor", "enviar_book_portal": "Enviou um book em PDF ao corretor",
    "enviar_lead_portal": "Enviou a ficha do cliente ao corretor",
}
AUTOR_EVENTO = {
    "agent": ("corretor", "Corretor (pelo agente)"), "portal": ("equipe", "Equipe do portal"),
    "imoview": ("imoview", "Imoview"), "scheduler": ("sistema", "Sistema"),
}


def _iso(v: Any) -> Optional[str]:
    return v.isoformat() if isinstance(v, datetime) else (v or None)


def _evento(id_: str, em: Any, categoria: str, tipo: str, titulo: str, detalhe: Optional[str] = None, autor_tipo: str = "sistema",
            autor: Optional[str] = None, origem: str = "crm", **meta: Any) -> Optional[Dict[str, Any]]:
    em = _iso(em)
    if not em:
        return None
    return {"id": id_, "em": em, "categoria": categoria, "tipo": tipo, "titulo": titulo, "detalhe": detalhe or None,
            "autor_tipo": autor_tipo, "autor": autor, "origem": origem, "meta": {k: v for k, v in meta.items() if v not in (None, "")}}


def _reais(v: Any) -> str:
    try:
        return "R$ " + f"{float(v):,.0f}".replace(",", ".") if float(v) else ""
    except (TypeError, ValueError):
        return ""


async def montar(session, tenant_id: UUID, lead_id: UUID, limite: int = 400) -> Dict[str, Any]:
    tid, lid = str(tenant_id), str(lead_id)
    lead = (await session.execute(
        text("""SELECT l.*, c.nome AS corretor_nome FROM crm_leads l LEFT JOIN corretores c ON c.id = l.corretor_id
                WHERE l.tenant_id = :tid AND l.id = :lid"""), {"tid": tid, "lid": lid})).first()
    if not lead:
        return {"eventos": [], "resumo": {}}
    corretor = lead.corretor_nome or "Corretor"
    ev: List[Optional[Dict[str, Any]]] = []

    # Cadastro
    origem_txt = {"imoview": "Imoview", "whatsapp": "WhatsApp", "manual": "cadastro manual", "portal": "portal", "whatsapp_pessoal": "WhatsApp pessoal"}.get(lead.origem or "", lead.origem or "")
    ev.append(_evento("lead-criado", lead.created_at, "cadastro", "cliente_criado", "Cliente entrou na carteira", f"Origem: {origem_txt}" if origem_txt else None, "sistema", None, "crm"))
    if lead.imoview_incluido_em:
        ev.append(_evento("lead-imoview", lead.imoview_incluido_em, "cadastro", "entrada_imoview", "Cadastrado no CRM do Imoview", None, "imoview", None, "imoview"))
    if lead.ultimo_contato:
        ev.append(_evento("lead-contato", lead.ultimo_contato, "contato", "ultimo_contato", "Último contato registrado", None, "corretor", corretor, "crm"))

    # Funil
    for r in (await session.execute(
        text("""SELECT ev.id, ev.tipo, ev.de, ev.para, ev.autor, ev.created_at, n.titulo FROM crm_negocio_eventos ev
                JOIN crm_negocios n ON n.id = ev.negocio_id WHERE ev.tenant_id = :tid AND n.lead_id = :lid
                ORDER BY ev.created_at DESC LIMIT 200"""), {"tid": tid, "lid": lid})).fetchall():
        a_tipo, a_nome = AUTOR_EVENTO.get(r.autor, ("sistema", "Sistema"))
        if a_tipo == "corretor":
            a_nome = corretor
        titulo, detalhe = {
            "criado": ("Negócio aberto no Fluxo", f"Etapa: {r.para}" if r.para else None),
            "etapa": (f"Moveu para {r.para}", f"Saiu de {r.de}" if r.de else None),
            "ganho": ("Negócio ganho", None), "perdido": ("Negócio perdido", r.para or None),
            "reaberto": ("Negócio reaberto", None),
        }.get(r.tipo, (r.tipo, None))
        ev.append(_evento(f"neg-{r.id}", r.created_at, "funil", f"negocio_{r.tipo}", titulo, detalhe, a_tipo, a_nome, "crm"))

    # Agenda
    for r in (await session.execute(
        text("""SELECT a.id, a.tipo, a.titulo, a.inicio, a.local, a.status, a.created_at, a.updated_at, c.nome AS corretor
                FROM crm_atividades a LEFT JOIN corretores c ON c.id = a.corretor_id
                WHERE a.tenant_id = :tid AND a.lead_id = :lid ORDER BY a.created_at DESC LIMIT 100"""), {"tid": tid, "lid": lid})).fetchall():
        rot = ROTULO_ATIVIDADE.get(r.tipo, r.tipo)
        quando = r.inicio.strftime("%d/%m/%Y às %H:%M") if r.inicio else "sem data"
        ev.append(_evento(f"ati-{r.id}", r.created_at, "agenda", "atividade_criada", f"Agendou {rot}: {r.titulo}", f"Para {quando}" + (f" · {r.local}" if r.local else ""), "corretor", r.corretor, "agenda", status=r.status))
        if r.status in ("concluida", "cancelada"):
            ev.append(_evento(f"ati-{r.id}-fim", r.updated_at, "agenda", f"atividade_{r.status}", f"{'Concluiu' if r.status == 'concluida' else 'Cancelou'} {rot}: {r.titulo}", None, "corretor", r.corretor, "agenda"))

    # Conversa do corretor com o cliente no WhatsApp pessoal
    atend = (await session.execute(
        text("""SELECT id, analise, analisado_em, ultima_mensagem_em, aguardando_corretor FROM atendimentos
                WHERE tenant_id = :tid AND lead_id = :lid"""), {"tid": tid, "lid": lid})).fetchall()
    whatsapp = {"corretor": 0, "cliente": 0}
    for a in atend:
        resumo = (a.analise or {}).get("resumo") if isinstance(a.analise, dict) else None
        if resumo:
            ev.append(_evento(f"ana-{a.id}", a.analisado_em, "analise", "analise_ia", "A IA analisou a conversa", resumo, "sistema", "Acessor", "whatsapp",
                              temperatura=(a.analise or {}).get("temperatura")))
        for m in (await session.execute(
            text("""SELECT id, autor, tipo, conteudo, transcricao, created_at FROM atendimento_mensagens
                    WHERE tenant_id = :tid AND atendimento_id = :aid ORDER BY created_at DESC LIMIT :lim"""),
            {"tid": tid, "aid": str(a.id), "lim": LIMITE_MENSAGENS})).fetchall():
            whatsapp[m.autor if m.autor in whatsapp else "cliente"] += 1
            doc = {"text": None, "audio": "Áudio", "image": "Imagem", "document": "Documento"}.get(m.tipo, m.tipo)
            texto = (m.transcricao if m.tipo == "audio" and m.transcricao else m.conteudo) or ""
            sou_corretor = m.autor == "corretor"
            ev.append(_evento(
                f"msg-{m.id}", m.created_at, "conversa", f"mensagem_{m.autor}",
                (f"Enviou {'um ' + doc.lower() if doc else 'uma mensagem'} ao cliente" if sou_corretor else f"Cliente enviou {'um ' + doc.lower() if doc else 'uma mensagem'}"),
                texto[:400] or None, "corretor" if sou_corretor else "cliente", corretor if sou_corretor else None, "whatsapp", midia=m.tipo))

    # Ações registradas (auditoria) sobre o cliente
    for r in (await session.execute(
        text("""SELECT id, acao, origem, payload_depois, created_at FROM auditoria
                WHERE tenant_id = :tid AND entidade = 'lead' AND entidade_id = :lid ORDER BY created_at DESC LIMIT 60"""), {"tid": tid, "lid": lid})).fetchall():
        rot = ACOES_AUDITORIA.get(r.acao)
        if rot:
            ev.append(_evento(f"aud-{r.id}", r.created_at, "acao", r.acao, rot, None, "equipe" if r.origem == "portal" else "corretor",
                              "Equipe do portal" if r.origem == "portal" else corretor, "auditoria"))

    # CRM do Imoview
    metricas = {"interacoes": 0, "visitas": 0, "propostas": 0, "negocios": 0, "primeira_resposta_min": None, "valor_potencial": None, "comissao": None}
    if lead.codigo_imoview:
        for a in (await session.execute(
            text("""SELECT * FROM imoview_atendimentos WHERE tenant_id = :tid AND lead_codigo = :cod
                    ORDER BY (situacao_tipo = 'em_atendimento') DESC, alterado_em DESC NULLS LAST LIMIT 10"""), {"tid": tid, "cod": lead.codigo_imoview})).fetchall():
            d = a.detalhes or {}
            tag = f"#{a.codigo}"
            nome_corretor = a.corretor_nome or corretor
            ev.append(_evento(f"im-{a.codigo}-in", a.entrada_em or a.incluido_em, "imoview", "atendimento_aberto", f"Atendimento {tag} aberto no Imoview",
                              " · ".join(p for p in (a.funil, a.midia, a.campanha) if p), "imoview", None, "imoview"))
            if a.primeira_resposta_em:
                base = a.entrada_em or a.incluido_em
                minutos = int((a.primeira_resposta_em - base).total_seconds() // 60) if base else None
                ev.append(_evento(f"im-{a.codigo}-resp", a.primeira_resposta_em, "contato", "primeira_resposta", "Primeira resposta ao cliente",
                                  f"{minutos} min após a entrada" if minutos is not None and minutos >= 0 else None, "corretor", nome_corretor, "imoview"))
                if metricas["primeira_resposta_min"] is None and minutos is not None and minutos >= 0:
                    metricas["primeira_resposta_min"] = minutos
            if a.fechamento_em:
                ev.append(_evento(f"im-{a.codigo}-fim", a.fechamento_em, "funil", "atendimento_fechado", f"Atendimento {tag} {a.situacao or 'fechado'}", None, "imoview", None, "imoview"))
            for i, it in enumerate(d.get("interacoes") or []):
                robo = "robô" in (it.get("usuario") or "").lower()
                ev.append(_evento(f"im-{a.codigo}-i{i}", it.get("em"), "interacao", "interacao_imoview", "Interação registrada no CRM", it.get("descricao"),
                                  "imoview" if robo else "corretor", it.get("usuario"), "imoview"))
                metricas["interacoes"] += 1
            for v in d.get("visitas") or []:
                im = v.get("imovel") or {}
                ev.append(_evento(f"im-v{v.get('codigo')}", v.get("em"), "imovel", "visita", f"Visita {str(v.get('situacao') or '').lower()}: imóvel {im.get('codigo')}",
                                  " · ".join(p for p in (im.get("titulo"), v.get("parecer"), v.get("motivo"), v.get("complemento")) if p), "corretor", nome_corretor, "imoview", imovel=im.get("codigo")))
                metricas["visitas"] += 1
            for p in d.get("propostas") or []:
                im = p.get("imovel") or {}
                ev.append(_evento(f"im-p{p.get('codigo')}", p.get("em"), "imovel", "proposta", f"Proposta {_reais(p.get('valor'))} · imóvel {im.get('codigo')}".replace("  ", " "),
                                  " · ".join(x for x in (p.get("situacao"), im.get("titulo")) if x), "corretor", nome_corretor, "imoview", imovel=im.get("codigo")))
                metricas["propostas"] += 1
            for n in d.get("negocios") or []:
                im = n.get("imovel") or {}
                ev.append(_evento(f"im-n{n.get('codigo')}", n.get("em"), "imovel", "negocio", f"Negócio {str(n.get('situacao') or '').lower()}: {_reais(n.get('valor'))}".strip(": "),
                                  f"Imóvel {im.get('codigo')} · comissão {_reais(n.get('comissao'))}" if n.get("comissao") else f"Imóvel {im.get('codigo')}", "corretor", nome_corretor, "imoview", imovel=im.get("codigo")))
                metricas["negocios"] += 1
            if metricas["valor_potencial"] is None and a.valor_crm is not None:
                metricas["valor_potencial"], metricas["comissao"] = float(a.valor_crm), float(a.comissao) if a.comissao else None

    eventos = sorted((e for e in ev if e), key=lambda e: e["em"], reverse=True)[:limite]
    por_categoria: Dict[str, int] = {}
    for e in eventos:
        por_categoria[e["categoria"]] = por_categoria.get(e["categoria"], 0) + 1
    primeiro = eventos[-1]["em"] if eventos else None
    resumo = {
        "total": len(eventos), "por_categoria": por_categoria, "primeiro_evento": primeiro, "ultimo_evento": eventos[0]["em"] if eventos else None,
        "acoes_do_corretor": sum(1 for e in eventos if e["autor_tipo"] == "corretor"), "mensagens_corretor": whatsapp["corretor"], "mensagens_cliente": whatsapp["cliente"],
        **metricas,
    }
    return {"eventos": eventos, "resumo": resumo}
