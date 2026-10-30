"""
Adaptador REST para a API do Imoview (Universal Software).
Opera por tenant, com chave de API e URL base próprias.
Trata limites de requisição, circuit-breaker e degradação suave.
"""
import asyncio
import json
import time
from typing import Any, Dict, List, Optional
import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)
import structlog

log = structlog.get_logger()


class ImoviewError(Exception):
    """Erro base para integrações com o Imoview."""
    pass


class ImoviewAuthError(ImoviewError):
    """401 — Chave ou código de acesso inválido."""
    pass


class ImoviewRateLimitError(ImoviewError):
    """429 — Limite de requisições excedido."""
    def __init__(self, retry_after: int = 60):
        super().__init__(f"Limite de requisições excedido. Retry-After: {retry_after}s")
        self.retry_after = retry_after


class ImoviewUnavailableError(ImoviewError):
    """500, timeout ou circuit breaker aberto."""
    pass


class CircuitBreakerOpen(ImoviewUnavailableError):
    pass


class ImoviewClient:
    """
    Cliente HTTP assíncrono para Imoview.
    Implementa circuit-breaker de 5 falhas consecutivas com recuperação de 60 segundos.
    """
    _consecutive_failures: int = 0
    _circuit_opened_at: Optional[float] = None
    CIRCUIT_THRESHOLD = 5
    CIRCUIT_RESET_SECONDS = 60

    def __init__(
        self,
        base_url: str,
        chave: str,
        codigo_acesso: Optional[str] = None,
        timeout: float = 15.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.chave = chave
        self.codigo_acesso = codigo_acesso
        self.timeout = timeout

    def _headers(self, require_app_auth: bool = False) -> Dict[str, str]:
        headers = {
            "chave": self.chave,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if require_app_auth and self.codigo_acesso:
            headers["codigoacesso"] = self.codigo_acesso
        return headers

    def _check_circuit(self) -> None:
        if self._circuit_opened_at:
            if time.time() - self._circuit_opened_at > self.CIRCUIT_RESET_SECONDS:
                # Half-open
                self._circuit_opened_at = None
                self._consecutive_failures = 0
                log.info("imoview_circuit_breaker_half_open")
            else:
                raise CircuitBreakerOpen("Imoview circuit breaker aberto temporariamente.")

    def _record_success(self) -> None:
        self._consecutive_failures = 0
        self._circuit_opened_at = None

    def _record_failure(self) -> None:
        self._consecutive_failures += 1
        if self._consecutive_failures >= self.CIRCUIT_THRESHOLD:
            self._circuit_opened_at = time.time()
            log.error(
                "imoview_circuit_breaker_opened",
                consecutive_failures=self._consecutive_failures,
            )

    @retry(
        retry=retry_if_exception_type((httpx.RequestError, httpx.TimeoutException)),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=4),
        reraise=True,
    )
    async def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        json_data: Optional[Dict[str, Any]] = None,
        require_app_auth: bool = False,
    ) -> Any:
        self._check_circuit()
        url = f"{self.base_url}{path}"
        headers = self._headers(require_app_auth=require_app_auth)

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.request(
                    method=method,
                    url=url,
                    headers=headers,
                    params=params,
                    json=json_data,
                )

                if response.status_code == 200:
                    self._record_success()
                    return response.json() if response.content else {}

                if response.status_code == 401:
                    raise ImoviewAuthError("Chave de acesso inválida ou sem permissão.")

                if response.status_code == 429:
                    retry_after = int(response.headers.get("Retry-After", 60))
                    raise ImoviewRateLimitError(retry_after)

                if response.status_code == 404:
                    # Imoview retorna 404 para dados não encontrados ou parâmetros inválidos
                    log.warning(
                        "imoview_404",
                        path=path,
                        parametros=str(params or json_data)[:200],
                        resposta=response.text[:200],
                    )
                    return {}

                self._record_failure()
                msg = response.text
                try:
                    data = response.json()
                    msg = data.get("mensagem", msg)
                except Exception:
                    pass
                raise ImoviewError(f"HTTP {response.status_code}: {msg}")

        except (httpx.RequestError, httpx.TimeoutException) as exc:
            self._record_failure()
            raise ImoviewUnavailableError(f"Imoview indisponível ou timeout: {exc}") from exc

    # --- Imóveis ---

    async def buscar_imoveis(
        self,
        finalidade: int,  # 1=aluguel, 2=venda
        pagina: int = 1,
        registros: int = 20,
        extra_filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        POST /Imovel/RetornarImoveisDisponiveis
        Busca paginada de imóveis disponíveis.
        """
        payload: Dict[str, Any] = {
            "finalidade": finalidade,
            "numeroPagina": pagina,
            "numeroRegistros": registros,
        }
        if extra_filters:
            payload.update(extra_filters)

        return await self._request("POST", "/Imovel/RetornarImoveisDisponiveis", json_data=payload)

    async def detalhes_imovel(self, codigo_imovel: int) -> Dict[str, Any]:
        """
        GET /Imovel/RetornarDetalhesImovelDisponivel?codigoImovel=X
        """
        return await self._request(
            "GET",
            "/Imovel/RetornarDetalhesImovelDisponivel",
            params={"codigoImovel": codigo_imovel},
        )

    # --- Clientes e Leads ---

    async def retornar_clientes(
        self,
        pagina: int = 1,
        registros: int = 20,
        tipo_relacionamento: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        GET /Cliente/RetornarClientes
        Lista clientes cadastrados (máx 20 por página).
        """
        params: Dict[str, Any] = {
            "numeroPagina": pagina,
            "numeroRegistros": min(registros, 20),
        }
        if tipo_relacionamento:
            params["tipoRelacionamento"] = tipo_relacionamento

        return await self._request("GET", "/Cliente/RetornarClientes", params=params)

    async def pesquisar_cliente_app(
        self,
        codigo_usuario: int,
        texto_pesquisa: str,
    ) -> Dict[str, Any]:
        """
        GET /Cliente/App_PesquisarCliente?codigoUsuario=X&textoPesquisa=X
        Requer header codigoacesso.
        """
        return await self._request(
            "GET",
            "/Cliente/App_PesquisarCliente",
            params={
                "codigoUsuario": codigo_usuario,
                "textoPesquisa": texto_pesquisa,
            },
            require_app_auth=True,
        )

    async def verificar_cliente(self, email_ou_telefone: str) -> Dict[str, Any]:
        """
        GET /Cliente/RetornarDadosCliente?emailOuTelefone=X
        Verifica se cliente já existe pelo email ou telefone.
        """
        return await self._request(
            "GET",
            "/Cliente/RetornarDadosCliente",
            params={"emailOuTelefone": email_ou_telefone},
        )

    async def incluir_lead(
        self,
        nome: str,
        telefone: Optional[str] = None,
        email: Optional[str] = None,
        midia: str = "acessorImobi WhatsApp",
        finalidade: Optional[str] = None,
        codigo_imovel: Optional[str] = None,
        anotacoes: Optional[str] = None,
        email_corretor: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        POST /Lead/IncluirLead
        Cria novo lead no Imoview.
        """
        if not telefone and not email:
            raise ValueError("É necessário informar ao menos telefone ou e-mail.")

        payload = {
            "nome": nome,
            "midia": midia,
        }
        if telefone:
            payload["telefone"] = telefone
        if email:
            payload["email"] = email
        if finalidade:
            payload["finalidade"] = str(finalidade)
        if codigo_imovel:
            payload["codigoimovel"] = str(codigo_imovel)
        if anotacoes:
            payload["anotacoes"] = anotacoes
        if email_corretor:
            payload["emailcorretor"] = email_corretor

        return await self._request("POST", "/Lead/IncluirLead", json_data=payload)
