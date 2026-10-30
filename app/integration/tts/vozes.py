"""
Catálogo de vozes do TTS local (Qwen3-TTS CustomVoice).

O tenant escolhe uma voz no portal; o `id` fica em `agent_config.voz`.
As amostras estáticas (web/public/vozes/<id>.wav) saem de
scripts/gerar_amostras_voz.py.
"""
import re
from typing import Dict, List, Optional

# Frase usada nas amostras: curta, coloquial e com números, como no WhatsApp.
FRASE_AMOSTRA = (
    "Beleza! Anotei a Ana na sua carteira e já marquei a visita pra amanhã, às dez horas."
)

# id -> (rótulo, descrição). O id é o nome do falante no modelo.
_VOZES: Dict[str, Dict[str, str]] = {
    "serena": {"rotulo": "Serena", "descricao": "Feminina, suave e calorosa"},
    "vivian": {"rotulo": "Vivian", "descricao": "Feminina, clara e animada"},
    "ono_anna": {"rotulo": "Anna", "descricao": "Feminina, leve e delicada"},
    "sohee": {"rotulo": "Sohee", "descricao": "Feminina, doce e expressiva"},
    "ryan": {"rotulo": "Ryan", "descricao": "Masculina, dinâmica e firme"},
    "aiden": {"rotulo": "Aiden", "descricao": "Masculina, jovem e descontraída"},
    "eric": {"rotulo": "Eric", "descricao": "Masculina, serena e profissional"},
    "dylan": {"rotulo": "Dylan", "descricao": "Masculina, natural e próxima"},
    "uncle_fu": {"rotulo": "Fu", "descricao": "Masculina, grave e madura"},
}

VOZ_PADRAO = "serena"

# Estilo enviado ao modelo (`instruct`): sem ele a fala sai com tom de locutor.
INSTRUCT_PADRAO = (
    "Speak in a relaxed, warm, conversational tone, like a friendly Brazilian real "
    "estate agent chatting on WhatsApp. Natural, varied pace; not like an announcer."
)


def listar_vozes() -> List[Dict[str, str]]:
    return [{"id": k, **v} for k, v in _VOZES.items()]


# Voz clonada do tenant: "clone:<uuid>" (linha de vozes_clonadas).
_RE_CLONE = re.compile(
    r"^clone:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$"
)


def id_clone(voz_id: Optional[str]) -> Optional[str]:
    """UUID da voz clonada, ou None se `voz_id` não for um id de clone."""
    achado = _RE_CLONE.match(voz_id or "")
    return achado.group(1) if achado else None


def voz_valida(voz_id: Optional[str]) -> bool:
    """Voz do catálogo ou id de clone bem formado (a existência do clone é checada no banco)."""
    return bool(voz_id) and (voz_id in _VOZES or id_clone(voz_id) is not None)


def resolver_voz(voz_id: Optional[str]) -> str:
    """Id aceito pelo catálogo (ou de clone), ou a voz padrão se vazio/desconhecido."""
    return voz_id if voz_valida(voz_id) else VOZ_PADRAO


def falante_catalogo(voz_id: Optional[str]) -> str:
    """Falante do modelo para o id; clones e desconhecidos caem na voz padrão."""
    return voz_id if voz_id in _VOZES else VOZ_PADRAO
