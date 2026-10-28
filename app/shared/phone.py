"""
Utilitário de normalização de telefone.
Converte qualquer formato para E.164 (+55...).
"""
import phonenumbers
from phonenumbers import PhoneNumberFormat


def normalize_phone(raw: str, default_region: str = "BR") -> str:
    """
    Normaliza o número de telefone para o formato E.164.
    Lança ValueError se o número for inválido.
    """
    try:
        parsed = phonenumbers.parse(raw, default_region)
        if not phonenumbers.is_valid_number(parsed):
            raise ValueError(f"Número de telefone inválido: {raw!r}")
        return phonenumbers.format_number(parsed, PhoneNumberFormat.E164)
    except phonenumbers.NumberParseException as e:
        raise ValueError(f"Não foi possível interpretar o telefone: {raw!r}") from e
