"""
Utilitário de normalização de telefone.
Converte qualquer formato para E.164 (+55...).
"""
from typing import Optional

import phonenumbers
from phonenumbers import PhoneNumberFormat


def _corrigir_movel_brasileiro_legado(raw: str) -> Optional[str]:
    """
    Converte números móveis brasileiros no formato antigo (8 dígitos) para o
    formato atual (9 dígitos).

    O WhatsApp ainda expõe JIDs antigos, por exemplo ``556392185349`` para o
    número atual ``+5563992185349``. O ``phonenumbers`` rejeita o formato
    antigo, então o nono dígito é inserido após o DDD apenas quando o número
    aparenta ser móvel (assinante começando em 6, 7, 8 ou 9).
    """
    digitos = "".join(ch for ch in raw if ch.isdigit())

    if len(digitos) == 12 and digitos.startswith("55"):
        ddd, assinante = digitos[2:4], digitos[4:]
    elif len(digitos) == 10:
        ddd, assinante = digitos[:2], digitos[2:]
    else:
        return None

    if len(assinante) != 8 or assinante[0] not in "6789":
        return None

    return f"55{ddd}9{assinante}"


def normalize_phone(raw: str, default_region: str = "BR") -> str:
    """
    Normaliza o número de telefone para o formato E.164.
    Aceita também o formato móvel brasileiro legado, sem o nono dígito.
    Lança ValueError se o número for inválido.
    """
    candidatos = [raw]
    corrigido = _corrigir_movel_brasileiro_legado(raw)
    if corrigido and corrigido != raw:
        candidatos.append(corrigido)

    ultimo_erro: Optional[Exception] = None
    for candidato in candidatos:
        try:
            parsed = phonenumbers.parse(candidato, default_region)
        except phonenumbers.NumberParseException as e:
            ultimo_erro = e
            continue

        if phonenumbers.is_valid_number(parsed):
            return phonenumbers.format_number(parsed, PhoneNumberFormat.E164)

    if isinstance(ultimo_erro, phonenumbers.NumberParseException):
        raise ValueError(
            f"Não foi possível interpretar o telefone: {raw!r}"
        ) from ultimo_erro
    raise ValueError(f"Número de telefone inválido: {raw!r}")
