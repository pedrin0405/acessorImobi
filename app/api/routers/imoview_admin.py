"""
Integração com o Imoview configurada pela própria imobiliária (portal): credenciais,
teste de conexão, sincronização do cache de imóveis e desconexão.

A chave nunca volta nas respostas (só uma máscara com o final). A URL base vem do
usuário, então passa pela validação anti-SSRF antes de qualquer chamada.
"""
import json
from typing import Any, Dict, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.api.middleware.auth import require_admin
from app.domain.auditoria.service import AuditoriaService
from app.domain.imovel.sync import carregar_credenciais, inteiro, mensagem_de_erro, obter_status, solicitar_sync
from app.integration.imoview.client import ImoviewClient, ImoviewError
from app.integration.imoview.seguranca import UrlInvalida, mascarar_chave, validar_base_url
from app.shared.database import get_session
from app.shared.redis import get_redis_pool
from app.shared.security import encrypt_credentials

router = APIRouter()
log = structlog.get_logger()

TESTES_POR_JANELA = 10
JANELA_TESTES_S = 600


class CredenciaisEntrada(BaseModel):
    base_url: str = Field(default="", max_length=255)
    # Vazia = manter a chave já salva (editar só o endereço).
    chave: str = Field(default="", max_length=512)


async def _montar_status(session, tenant_id) -> Dict[str, Any]:
    creds = await carregar_credenciais(tenant_id)
    sync = await obter_status(session, tenant_id)
    return {
        "configurado": bool(creds and creds.get("chave")),
        "base_url": (creds or {}).get("base_url") or "",
        "chave_mascarada": mascarar_chave((creds or {}).get("chave") or ""),
        "sincronizacao": sync,
    }


async def _testar_conexao(base_url: str, chave: str) -> Dict[str, Any]:
    """Confere a URL, a chave e a leitura de imóveis. Nunca lança: devolve {ok, mensagem, ...}."""
    try:
        base = await validar_base_url(base_url)
        cliente = ImoviewClient(base_url=base, chave=chave, timeout=10.0)
        venda = await cliente.buscar_imoveis(finalidade=2, pagina=1, registros=1)
        aluguel = await cliente.buscar_imoveis(finalidade=1, pagina=1, registros=1)
    except (UrlInvalida, ImoviewError) as e:
        return {"ok": False, "mensagem": mensagem_de_erro(e)}
    except Exception as e:  # noqa: BLE001
        log.warning("imoview_teste_erro", error=str(e)[:200])
        return {"ok": False, "mensagem": "Não consegui falar com o Imoview. Confira o endereço e tente de novo."}

    if not isinstance(venda, dict) or "quantidade" not in venda:
        return {"ok": False, "mensagem": "O Imoview respondeu algo inesperado. Confira o endereço e a chave."}
    return {
        "ok": True,
        "mensagem": "Conexão confirmada.",
        "base_url": base,
        "imoveis_venda": inteiro(venda.get("quantidade")) or 0,
        "imoveis_aluguel": inteiro((aluguel or {}).get("quantidade")) if isinstance(aluguel, dict) else 0,
    }


async def _limitar_testes(tenant_id) -> None:
    redis = get_redis_pool()
    chave = f"imoview:teste:{tenant_id}"
    n = await redis.incr(chave)
    if n == 1:
        await redis.expire(chave, JANELA_TESTES_S)
    if n > TESTES_POR_JANELA:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Muitos testes seguidos. Aguarde alguns minutos.")


@router.get("", summary="Estado da integração com o Imoview")
async def estado(admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as session:
        return await _montar_status(session, admin.tenant_id)


@router.post("/testar", summary="Testa a conexão (com os dados informados ou os salvos), sem salvar")
async def testar(body: CredenciaisEntrada, admin=Depends(require_admin)):
    await _limitar_testes(admin.tenant_id)
    salvas = await carregar_credenciais(admin.tenant_id) or {}
    base_url = body.base_url.strip() or salvas.get("base_url") or ""
    chave = body.chave.strip() or salvas.get("chave") or ""
    if not base_url or not chave:
        return {"ok": False, "mensagem": "Informe o endereço e a chave do Imoview para testar."}
    return await _testar_conexao(base_url, chave)


@router.put("", summary="Salva as credenciais depois de validar a conexão")
async def salvar(body: CredenciaisEntrada, admin=Depends(require_admin)):
    await _limitar_testes(admin.tenant_id)
    salvas = await carregar_credenciais(admin.tenant_id) or {}
    base_url = body.base_url.strip() or salvas.get("base_url") or ""
    chave = body.chave.strip() or salvas.get("chave") or ""
    if not base_url or not chave:
        raise HTTPException(status_code=422, detail="Informe o endereço e a chave do Imoview.")

    teste = await _testar_conexao(base_url, chave)
    if not teste["ok"]:
        raise HTTPException(status_code=422, detail=teste["mensagem"])

    novas = {**salvas, "base_url": teste["base_url"], "chave": chave}
    async with get_session(admin.tenant_id) as session:
        await session.execute(
            text("UPDATE tenants SET imoview_creds = :creds, updated_at = NOW() WHERE id = :tid"),
            {"creds": encrypt_credentials(json.dumps(novas)), "tid": str(admin.tenant_id)},
        )
        await AuditoriaService(session).registrar(
            tenant_id=admin.tenant_id, corretor_id=None, acao="imoview_credenciais_atualizadas",
            entidade="integracao", entidade_id="imoview", origem="portal",
            payload_depois={"base_url": teste["base_url"], "chave_alterada": bool(body.chave.strip())},
        )
    await solicitar_sync(admin.tenant_id)
    async with get_session(admin.tenant_id) as session:
        return {**await _montar_status(session, admin.tenant_id), "teste": teste}


@router.post("/sincronizar", summary="Pede uma sincronização agora (o agendador a atende em segundos)")
async def sincronizar(admin=Depends(require_admin)):
    creds = await carregar_credenciais(admin.tenant_id)
    if not creds or not creds.get("chave"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Configure a integração com o Imoview antes de sincronizar.")
    await solicitar_sync(admin.tenant_id)
    async with get_session(admin.tenant_id) as session:
        await AuditoriaService(session).registrar(
            tenant_id=admin.tenant_id, corretor_id=None, acao="imoview_sync_solicitada",
            entidade="integracao", entidade_id="imoview", origem="portal",
        )
        return await _montar_status(session, admin.tenant_id)


@router.delete("", summary="Desconecta o Imoview (apaga as credenciais)")
async def desconectar(
    limpar_cache: bool = Query(False, description="Também apaga os imóveis em cache"),
    admin=Depends(require_admin),
):
    async with get_session(admin.tenant_id) as session:
        await session.execute(
            text("UPDATE tenants SET imoview_creds = NULL, updated_at = NOW() WHERE id = :tid"),
            {"tid": str(admin.tenant_id)},
        )
        await session.execute(text("DELETE FROM imoview_sync_status WHERE tenant_id = :tid"), {"tid": str(admin.tenant_id)})
        if limpar_cache:
            await session.execute(text("DELETE FROM imoveis_cache WHERE tenant_id = :tid"), {"tid": str(admin.tenant_id)})
        await AuditoriaService(session).registrar(
            tenant_id=admin.tenant_id, corretor_id=None, acao="imoview_desconectado",
            entidade="integracao", entidade_id="imoview", origem="portal",
            payload_depois={"cache_apagado": limpar_cache},
        )
        return await _montar_status(session, admin.tenant_id)
