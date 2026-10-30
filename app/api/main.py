"""
API principal — FastAPI.
- Ingestão de webhooks do WhatsApp
- APIs do portal do corretor e da imobiliária
- APIs do painel do desenvolvedor

Regra estrutural: esta API NUNCA chama o modelo de IA diretamente.
A IA é processada exclusivamente pelo worker.
"""
import time
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routers import (
    assistente,
    auth,
    configuracoes,
    conversas_admin,
    visao_geral_admin,
    crm_admin,
    dev_panel,
    imoveis_admin,
    imoview_admin,
    imoview_leads_admin,
    tenant_admin,
    corretor_portal,
    whatsapp_webhook,
    health,
)
from app.shared.config import get_settings

settings = get_settings()
log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("acessorImobi API iniciando", environment=settings.environment)
    yield
    log.info("acessorImobi API encerrando")


app = FastAPI(
    title="acessorImobi API",
    version="1.0.0",
    docs_url="/docs" if settings.environment != "production" else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.environment != "production" else None,
    lifespan=lifespan,
)

# CORS — apenas origens dos portais conhecidos
import re

ALLOWED_ORIGINS = []
if settings.environment == "development":
    ALLOWED_ORIGINS += [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
    ]

ALLOWED_ORIGIN_REGEX = rf"https://([a-z0-9-]+\.)?{re.escape(settings.base_domain)}"

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


# --- Middleware: logging de requisições (sem PII) ---
@app.middleware("http")
async def request_logging(request: Request, call_next):
    start = time.perf_counter()
    response: Response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    log.info(
        "request",
        method=request.method,
        path=request.url.path,
        status=response.status_code,
        duration_ms=round(duration_ms, 1),
    )
    return response


# --- Routers ---
app.include_router(health.router, prefix="/health", tags=["Health"])
app.include_router(auth.router, prefix="/auth", tags=["Autenticação"])
app.include_router(whatsapp_webhook.router, prefix="/webhook", tags=["WhatsApp"])
app.include_router(dev_panel.router, prefix="/dev", tags=["Painel Dev"])
app.include_router(tenant_admin.router, prefix="/admin", tags=["Admin Imobiliária"])
app.include_router(crm_admin.router, prefix="/admin/crm", tags=["CRM"])
app.include_router(imoview_leads_admin.router, prefix="/admin/integracoes/imoview/leads", tags=["Imoview"])
app.include_router(imoview_admin.router, prefix="/admin/integracoes/imoview", tags=["Integração Imoview"])
app.include_router(imoveis_admin.router, prefix="/admin/imoveis", tags=["Imóveis"])
app.include_router(visao_geral_admin.router, prefix="/admin/visao-geral", tags=["Visão Geral"])
app.include_router(conversas_admin.router, prefix="/admin", tags=["Conversas"])
app.include_router(configuracoes.router, prefix="/admin/configuracoes", tags=["Configurações"])
app.include_router(assistente.router, prefix="/admin/assistente", tags=["Assistente"])
app.include_router(corretor_portal.router, prefix="/corretor", tags=["Corretor"])


# --- Tratamento global de erros ---
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    log.error("unhandled_exception", path=request.url.path, error=str(exc), exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Erro interno. Tente novamente em alguns instantes."},
    )
