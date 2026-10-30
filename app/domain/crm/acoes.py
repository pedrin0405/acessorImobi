"""
Ações de escrita do CRM pedidas ao agente pelo WhatsApp.

O mesmo código serve aos dois caminhos:
- aprovação ligada: o agente mostra `resumo_acao` e grava só depois do "sim"
  (via confirmacoes_pendentes, no pipeline);
- aprovação desligada: o agente chama `executar_acao` na hora.
"""
from datetime import date, datetime
from typing import Any, Dict, Optional
from uuid import UUID
from zoneinfo import ZoneInfo

import structlog

from app.domain.auditoria.service import AuditoriaService
from app.domain.crm.service import (
    ROTULO_TIPO,
    TIPOS_ATIVIDADE,
    CrmError,
    CrmService,
    normalizar_perfil,
    resumo_perfil,
)

log = structlog.get_logger()

TIPOS_ACAO = (
    "crm_registrar_lead",
    "crm_atualizar_lead",
    "crm_criar_negocio",
    "crm_mover_negocio",
    "crm_agendar",
)

_DIAS = ("seg", "ter", "qua", "qui", "sex", "sáb", "dom")


def _parse_inicio(payload: Dict[str, Any]) -> Optional[datetime]:
    """'data' (AAAA-MM-DD) + 'hora' (HH:MM) no fuso do tenant; sem data = atividade sem data."""
    data = (payload.get("data") or "").strip()
    if not data:
        return None
    try:
        dia = date.fromisoformat(data)
    except ValueError as e:
        raise CrmError("Não entendi a data. Pode me dizer o dia de novo?") from e
    hora = (payload.get("hora") or "09:00").strip()
    try:
        h, m = (int(x) for x in hora.split(":")[:2])
    except ValueError as e:
        raise CrmError("Não entendi o horário. Pode repetir?") from e
    fuso = ZoneInfo(payload.get("fuso") or "America/Sao_Paulo")
    return datetime(dia.year, dia.month, dia.day, h, m, tzinfo=fuso)


def _formatar_quando(inicio: Optional[datetime]) -> str:
    if not inicio:
        return "sem data"
    return f"{_DIAS[inicio.weekday()]} {inicio:%d/%m} às {inicio:%H:%M}"


def _formatar_valor(valor: Any) -> str:
    try:
        return "R$ " + f"{float(valor):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except (TypeError, ValueError):
        return "R$ 0,00"


def resumo_acao(tipo: str, payload: Dict[str, Any]) -> str:
    """Texto curto do que será gravado, para o corretor confirmar."""
    if tipo == "crm_registrar_lead":
        linhas = [f"• Cliente: *{payload.get('nome', '')}*"]
        if payload.get("telefone"):
            linhas.append(f"• Telefone: {payload['telefone']}")
        linhas.append(f"• Procura: {resumo_perfil(normalizar_perfil(payload.get('perfil')))}")
        if payload.get("observacoes"):
            linhas.append(f"• Obs.: {payload['observacoes']}")
        return "Anoto na sua carteira:\n" + "\n".join(linhas)
    if tipo == "crm_atualizar_lead":
        partes = []
        perfil = normalizar_perfil(payload.get("perfil"))
        if perfil:
            partes.append(f"perfil: {resumo_perfil(perfil)}")
        if payload.get("temperatura"):
            partes.append(f"temperatura: {payload['temperatura']}")
        if payload.get("observacoes"):
            partes.append(f"obs.: {payload['observacoes']}")
        return f"Atualizo *{payload.get('cliente', '')}* — " + ("; ".join(partes) or "sem mudanças")
    if tipo == "crm_criar_negocio":
        texto = f"Abro um negócio para *{payload.get('cliente', '')}* na etapa *{payload.get('etapa') or 'Lead'}*"
        if payload.get("valor"):
            texto += f", valor {_formatar_valor(payload['valor'])}"
        if payload.get("imovel_codigo"):
            texto += f", imóvel {payload['imovel_codigo']}"
        return texto + "."
    if tipo == "crm_mover_negocio":
        cliente = payload.get("cliente", "")
        if payload.get("status") == "ganho":
            return f"Marco o negócio de *{cliente}* como *ganho* 🎉"
        if payload.get("status") == "perdido":
            return f"Marco o negócio de *{cliente}* como *perdido* (motivo: {payload.get('motivo_perda') or '—'})."
        return f"Movo o negócio de *{cliente}* para *{payload.get('etapa', '')}*."
    if tipo == "crm_agendar":
        rotulo = ROTULO_TIPO.get(payload.get("tipo") or "tarefa", "Tarefa")
        try:
            quando = _formatar_quando(_parse_inicio(payload))
        except CrmError:
            quando = "data a confirmar"
        texto = f"Agendo *{rotulo}*"
        if payload.get("cliente"):
            texto += f" com *{payload['cliente']}*"
        texto += f" — {quando}"
        if payload.get("local"):
            texto += f", em {payload['local']}"
        if payload.get("imovel_codigo"):
            texto += f", imóvel {payload['imovel_codigo']}"
        return texto + "."
    return "Ação no CRM."


async def lead_por_nome(
    crm: CrmService, tenant_id: UUID, corretor_id: UUID, nome: Optional[str], criar: bool
) -> Optional[Dict[str, Any]]:
    """Acha o cliente na carteira; opcionalmente cria um lead só com o nome."""
    if not (nome or "").strip():
        return None
    lead = await crm.encontrar_lead(tenant_id, corretor_id, nome)
    if lead or not criar:
        return lead
    return await crm.criar_lead(tenant_id, corretor_id, nome=nome)


async def executar_acao(
    session, tenant_id: UUID, corretor_id: UUID, tipo: str, payload: Dict[str, Any]
) -> str:
    """Grava a ação e devolve a confirmação para o corretor. Erros de negócio viram texto."""
    crm = CrmService(session)
    try:
        if tipo == "crm_registrar_lead":
            lead = await crm.criar_lead(
                tenant_id, corretor_id,
                nome=payload.get("nome", ""),
                telefone=payload.get("telefone"),
                email=payload.get("email"),
                perfil=payload.get("perfil"),
                observacoes=payload.get("observacoes"),
                temperatura=payload.get("temperatura") or "morno",
            )
            entidade, entidade_id = "lead", lead["id"]
            texto = f"✅ *{lead['nome']}* anotada na sua carteira. Procura: {resumo_perfil(lead['perfil'])}."

        elif tipo == "crm_atualizar_lead":
            lead = await lead_por_nome(crm, tenant_id, corretor_id, payload.get("cliente"), criar=False)
            if not lead:
                return f"Não achei *{payload.get('cliente', '')}* na sua carteira. Quer que eu cadastre?"
            lead = await crm.atualizar_lead(
                tenant_id, UUID(lead["id"]),
                perfil=payload.get("perfil"),
                observacoes=payload.get("observacoes"),
                temperatura=payload.get("temperatura"),
                status=payload.get("status"),
            )
            entidade, entidade_id = "lead", lead["id"]
            texto = f"✅ Atualizei *{lead['nome']}*. Procura: {resumo_perfil(lead['perfil'])}."

        elif tipo == "crm_criar_negocio":
            lead = await lead_por_nome(crm, tenant_id, corretor_id, payload.get("cliente"), criar=True)
            if not lead:
                return "De qual cliente é o negócio?"
            fechamento = payload.get("fechamento_previsto")
            negocio = await crm.criar_negocio(
                tenant_id, corretor_id, UUID(lead["id"]),
                etapa=payload.get("etapa"),
                valor=payload.get("valor"),
                imovel_codigo=payload.get("imovel_codigo"),
                fechamento_previsto=date.fromisoformat(fechamento) if fechamento else None,
            )
            entidade, entidade_id = "negocio", negocio["id"]
            texto = f"✅ Negócio de *{lead['nome']}* aberto em *{negocio['etapa_nome']}*."

        elif tipo == "crm_mover_negocio":
            negocio = await crm.encontrar_negocio(tenant_id, corretor_id, payload.get("cliente", ""))
            if not negocio:
                return f"Não achei negócio aberto de *{payload.get('cliente', '')}*. Quer que eu abra um?"
            nome = negocio["lead_nome"]
            negocio = await crm.mover_negocio(
                tenant_id, UUID(negocio["id"]),
                etapa=payload.get("etapa"),
                status=payload.get("status"),
                motivo_perda=payload.get("motivo_perda"),
                valor=payload.get("valor"),
            )
            entidade, entidade_id = "negocio", negocio["id"]
            if negocio["status"] == "ganho":
                texto = f"🎉 Negócio de *{nome}* marcado como ganho. Parabéns!"
            elif negocio["status"] == "perdido":
                texto = f"Negócio de *{nome}* encerrado como perdido. Anotei o motivo."
            else:
                texto = f"✅ Negócio de *{nome}* agora em *{negocio['etapa_nome']}*."

        elif tipo == "crm_agendar":
            atividade_tipo = payload.get("tipo") or "tarefa"
            if atividade_tipo not in TIPOS_ATIVIDADE:
                atividade_tipo = "tarefa"
            lead = await lead_por_nome(crm, tenant_id, corretor_id, payload.get("cliente"), criar=True)
            inicio = _parse_inicio(payload)
            titulo = payload.get("titulo") or (
                f"{ROTULO_TIPO[atividade_tipo]} com {lead['nome']}" if lead else ROTULO_TIPO[atividade_tipo]
            )
            atividade = await crm.agendar(
                tenant_id, corretor_id,
                titulo=titulo,
                tipo=atividade_tipo,
                inicio=inicio,
                duracao_min=payload.get("duracao_min") or 60,
                lead_id=UUID(lead["id"]) if lead else None,
                local=payload.get("local"),
                imovel_codigo=payload.get("imovel_codigo"),
            )
            entidade, entidade_id = "atividade", atividade["id"]
            texto = f"📅 Agendado: *{titulo}* — {_formatar_quando(inicio)}. Te lembro antes."

        else:
            return "Não reconheci essa ação."

    except CrmError as e:
        return str(e)

    await AuditoriaService(session).registrar(
        tenant_id=tenant_id,
        corretor_id=corretor_id,
        acao=tipo,
        entidade=entidade,
        entidade_id=str(entidade_id),
        payload_depois=payload,
    )
    log.info("crm_acao_executada", tipo=tipo, tenant_id=str(tenant_id)[:8])
    return texto
