"""
Textos proativos do CRM enviados ao corretor pelo WhatsApp: briefing diário
e lembrete de compromisso. Funções puras para facilitar teste.
"""
from datetime import datetime, time
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo

from app.domain.crm.service import ROTULO_TIPO

_DIAS = ("seg", "ter", "qua", "qui", "sex", "sáb", "dom")


def _hora(iso: str, fuso: ZoneInfo, com_dia: bool = False) -> str:
    quando = datetime.fromisoformat(iso).astimezone(fuso)
    return f"{_DIAS[quando.weekday()]} {quando:%d/%m %H:%M}" if com_dia else f"{quando:%H:%M}"


def _atividade(a: Dict[str, Any], fuso: ZoneInfo, com_dia: bool = False) -> str:
    texto = f"• {_hora(a['inicio'], fuso, com_dia)} — {a['titulo']}"
    if a.get("local"):
        texto += f" ({a['local']})"
    return texto


def texto_briefing(nome: Optional[str], dados: Dict[str, Any], fuso: ZoneInfo) -> Optional[str]:
    """Monta o briefing; None quando não há nada que valha uma mensagem."""
    if not any(dados.get(k) for k in ("hoje", "atrasadas", "travados", "matches")):
        return None

    primeiro = (nome or "").split()[0] if nome else ""
    blocos = [f"☀️ Bom dia{', ' + primeiro if primeiro else ''}! Seu dia em resumo:"]

    if dados.get("hoje"):
        blocos.append("📅 *Hoje*\n" + "\n".join(_atividade(a, fuso) for a in dados["hoje"][:8]))
    if dados.get("atrasadas"):
        atrasadas = dados["atrasadas"]
        linhas = "\n".join(_atividade(a, fuso, com_dia=True) for a in atrasadas[:5])
        extra = f"\n…e mais {len(atrasadas) - 5}" if len(atrasadas) > 5 else ""
        blocos.append(f"⚠️ *Atrasadas ({len(atrasadas)})*\n{linhas}{extra}")
    if dados.get("travados"):
        linhas = [
            f"• {n['lead_nome']} — {n['etapa_nome']} há {n['dias_na_etapa']} dias"
            for n in dados["travados"][:5]
        ]
        blocos.append("⏳ *Negócios parados*\n" + "\n".join(linhas))
    if dados.get("matches"):
        linhas = []
        for m in dados["matches"]:
            codigos = ", ".join(str(im["codigo"]) for im in m["imoveis"])
            rotulo = "imóvel novo" if len(m["imoveis"]) == 1 else "imóveis novos"
            linhas.append(f"• {m['lead']['nome']}: {len(m['imoveis'])} {rotulo} (cód. {codigos})")
        blocos.append(
            "🏠 *Combina com seus clientes*\n" + "\n".join(linhas)
            + "\nÉ só me pedir \"o que combina com [cliente]\" para ver as fotos."
        )
    return "\n\n".join(blocos)


def texto_lembrete(atividade: Dict[str, Any], fuso: ZoneInfo) -> str:
    rotulo = ROTULO_TIPO.get(atividade.get("tipo") or "tarefa", "Compromisso")
    texto = f"⏰ Lembrete: *{atividade['titulo']}* às {_hora(atividade['inicio'], fuso)}"
    if atividade.get("local"):
        texto += f", em {atividade['local']}"
    if atividade.get("imovel_codigo"):
        texto += f" (imóvel {atividade['imovel_codigo']})"
    texto += "."
    if rotulo == "Visita":
        texto += " Quer que eu te mande os dados do imóvel?"
    return texto


def dentro_da_janela(agora_local: datetime, inicio: time, fim: time) -> bool:
    """Horário comercial do tenant (ex.: 08:00–20:00)."""
    return inicio <= agora_local.time() < fim
