"""
Validação da URL base do Imoview informada pela imobiliária.

A URL vem do usuário e o servidor faz requisições a ela, então é um vetor de SSRF:
só HTTPS, nome de domínio (nada de IP literal nem hosts internos) e o DNS precisa
resolver apenas para endereços públicos.
"""
import asyncio
import ipaddress
import socket
from typing import List
from urllib.parse import urlsplit


class UrlInvalida(ValueError):
    """A URL não pode ser usada como endereço do Imoview (a mensagem é segura para o usuário)."""


_SUFIXOS_INTERNOS = (".local", ".localhost", ".internal", ".lan", ".home", ".intranet", ".corp")


def normalizar_base_url(url: str) -> str:
    """Valida a forma da URL (sem consultar DNS) e devolve 'https://host'."""
    bruta = (url or "").strip()
    if not bruta or len(bruta) > 255:
        raise UrlInvalida("Informe o endereço da API do Imoview, por exemplo https://api.imoview.com.br.")
    if "://" not in bruta:
        bruta = "https://" + bruta
    partes = urlsplit(bruta)
    if partes.scheme.lower() != "https":
        raise UrlInvalida("O endereço precisa usar HTTPS.")
    if partes.username or partes.password:
        raise UrlInvalida("O endereço não pode ter usuário ou senha.")
    host = (partes.hostname or "").lower().rstrip(".")
    if not host or "." not in host or host == "localhost" or host.endswith(_SUFIXOS_INTERNOS):
        raise UrlInvalida("Informe um domínio público, por exemplo api.imoview.com.br.")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise UrlInvalida("Use o nome de domínio do Imoview, não um endereço IP.")
    try:
        porta = partes.port
    except ValueError:
        raise UrlInvalida("A porta do endereço é inválida.")
    if porta not in (None, 443):
        raise UrlInvalida("Só a porta padrão (443) é aceita.")
    if partes.path not in ("", "/") or partes.query or partes.fragment:
        raise UrlInvalida("Informe só o endereço, sem caminho. Exemplo: https://api.imoview.com.br.")
    return f"https://{host}"


async def _resolver(host: str) -> List[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    return sorted({i[4][0] for i in infos})


async def validar_base_url(url: str) -> str:
    """Normaliza e confere que o domínio resolve só para endereços públicos."""
    base = normalizar_base_url(url)
    host = base.removeprefix("https://")
    try:
        enderecos = await _resolver(host)
    except OSError:
        raise UrlInvalida("Não consegui resolver esse endereço. Confira o domínio.")
    if not enderecos:
        raise UrlInvalida("Não consegui resolver esse endereço. Confira o domínio.")
    for endereco in enderecos:
        try:
            ip = ipaddress.ip_address(endereco.split("%")[0])
        except ValueError:
            raise UrlInvalida("O domínio resolveu para um endereço inválido.")
        if not ip.is_global or ip.is_multicast:
            raise UrlInvalida("Esse endereço aponta para uma rede interna e não pode ser usado.")
    return base


def mascarar_chave(chave: str) -> str:
    """Mostra só o final da chave, para a pessoa reconhecer qual está salva."""
    chave = (chave or "").strip()
    if not chave:
        return ""
    if len(chave) <= 8:
        return "••••"
    return f"••••••••{chave[-4:]}"
