"""Ações rápidas do compositor de Conversas: monta a mensagem de imóveis ou a ficha de um lead para o corretor.

Funções puras (sem banco nem rede), para a prévia e o envio usarem exatamente o mesmo texto.
A ficha do lead nunca inclui CPF/CNPJ.
"""
import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from app.domain.crm.service import resumo_perfil
from app.domain.imovel.consulta import texto_compartilhar

MAX_IMOVEIS = 6
MAX_OBSERVACOES = 300

ORIGENS = {"whatsapp": "WhatsApp", "imoview": "Imoview", "manual": "Manual", "whatsapp_pessoal": "WhatsApp pessoal"}


def formatar_telefone(telefone: Optional[str]) -> str:
    digitos = re.sub(r"\D", "", telefone or "")
    local = digitos[2:] if digitos.startswith("55") and len(digitos) >= 12 else digitos
    if len(local) == 11:
        return f"({local[:2]}) {local[2:7]}-{local[7:]}"
    if len(local) == 10:
        return f"({local[:2]}) {local[2:6]}-{local[6:]}"
    return telefone or ""


def rotulo_origem(origem: Optional[str]) -> str:
    origem = origem or ""
    return ORIGENS.get(origem) or origem.replace("_", " ").capitalize()


def _data(valor: Any) -> str:
    if isinstance(valor, (datetime, date)):
        return valor.strftime("%d/%m/%Y")
    return ""


def ficha_do_lead(lead: Dict[str, Any]) -> Dict[str, Any]:
    """Só os campos que vão ao corretor (e ao cartão da conversa)."""
    perfil = lead.get("perfil") if isinstance(lead.get("perfil"), dict) else {}
    resumo = resumo_perfil(perfil)
    return {
        "id": str(lead["id"]) if lead.get("id") else None,
        "nome": (lead.get("nome") or "").strip(),
        "telefone": formatar_telefone(lead.get("telefone")) or None,
        "email": (lead.get("email") or "").strip() or None,
        "busca": None if resumo == "sem perfil de busca" else resumo,
        "origem": rotulo_origem(lead.get("origem")),
        "temperatura": lead.get("temperatura"),
        "responsavel": lead.get("corretor_nome") or None,
        "ultimo_contato": _data(lead.get("ultimo_contato")) or None,
        "observacoes": ((lead.get("observacoes") or "").strip()[:MAX_OBSERVACOES]) or None,
    }


def texto_lead(ficha: Dict[str, Any]) -> str:
    linhas = [f"📋 *Cliente: {ficha['nome']}*"]
    if ficha.get("telefone"):
        linhas.append(f"📞 {ficha['telefone']}")
    if ficha.get("email"):
        linhas.append(f"✉️ {ficha['email']}")
    if ficha.get("busca"):
        linhas.append(f"🔎 Procura: {ficha['busca']}")
    detalhes = [f"Origem: {ficha['origem']}"] if ficha.get("origem") else []
    if ficha.get("temperatura"):
        detalhes.append(f"Interesse: {ficha['temperatura']}")
    if detalhes:
        linhas.append(" · ".join(detalhes))
    linhas.append(f"Responsável: {ficha['responsavel']}" if ficha.get("responsavel") else "Responsável: ainda sem corretor")
    if ficha.get("ultimo_contato"):
        linhas.append(f"Último contato: {ficha['ultimo_contato']}")
    if ficha.get("observacoes"):
        linhas.append(f"Obs.: {ficha['observacoes']}")
    return "\n".join(linhas)


def texto_imovel(item: Dict[str, Any]) -> str:
    return texto_compartilhar(item, {})
