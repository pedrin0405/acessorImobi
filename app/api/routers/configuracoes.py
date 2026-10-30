"""Configurações do portal da imobiliária (perfil, segurança, equipe, listas, localidades, agenda...)."""
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.api.middleware.auth import require_admin
from app.domain.auditoria.service import AuditoriaService
from app.domain.configuracoes.padroes import ConfigErro
from app.domain.configuracoes.service import ConfiguracoesService
from app.shared.database import get_session
from app.shared.security import create_access_token

router = APIRouter()


def _erro(e: ConfigErro) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))


async def _auditar(session, admin, acao: str, entidade: str, depois: Optional[Dict[str, Any]] = None) -> None:
    await AuditoriaService(session).registrar(
        tenant_id=admin.tenant_id, corretor_id=None, acao=acao, entidade=entidade, origem="portal", payload_depois=depois,
    )


class Livre(BaseModel):
    """Corpo validado pelo serviço (que devolve mensagens claras); aqui só o formato."""
    model_config = {"extra": "allow"}


class SenhaEntrada(BaseModel):
    atual: str = Field(max_length=200)
    nova: str = Field(max_length=200)
    confirmar: str = Field(max_length=200)


class ConfirmacaoEntrada(BaseModel):
    senha: str = Field(max_length=200)
    confirmacao: str = Field(max_length=200)


class NovoAdmin(BaseModel):
    nome: str = Field(max_length=255)
    email: str = Field(max_length=255)


class AtivoEntrada(BaseModel):
    ativo: bool


class CidadeEntrada(BaseModel):
    nome: str = Field(max_length=120)
    uf: Optional[str] = Field(default=None, max_length=2)


class CidadeAtualizar(BaseModel):
    nome: Optional[str] = Field(default=None, max_length=120)
    uf: Optional[str] = Field(default=None, max_length=2)
    arquivada: Optional[bool] = None


class BairroEntrada(BaseModel):
    nome: str = Field(max_length=120)


class BairroAtualizar(BaseModel):
    nome: Optional[str] = Field(default=None, max_length=120)
    arquivado: Optional[bool] = None


class ListaEntrada(BaseModel):
    itens: List[Dict[str, Any]]


# --- Menu -------------------------------------------------------------------

@router.get("/resumo", summary="Estado resumido de cada seção, para o menu das Configurações")
async def resumo(admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        return await ConfiguracoesService(s, admin.tenant_id).resumo()


# --- Perfil e segurança --------------------------------------------------------

@router.get("/perfil")
async def perfil(admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        try:
            return await ConfiguracoesService(s, admin.tenant_id).perfil(admin.admin_id, admin.sub)
        except ConfigErro as e:
            raise _erro(e)


@router.put("/perfil")
async def salvar_perfil(body: Livre, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        try:
            r = await ConfiguracoesService(s, admin.tenant_id).salvar_perfil(admin.admin_id, admin.sub, body.model_dump())
        except ConfigErro as e:
            raise _erro(e)
        await _auditar(s, admin, "config_perfil", "tenant_admin")
        # O e-mail é o "sub" do token; se mudou, devolve um token novo para a sessão continuar válida.
        return {**r, "token": create_access_token(r["email"], tenant_id=admin.tenant_id, role="admin", admin_id=UUID(r["id"]))}


@router.post("/senha", summary="Troca a senha e encerra as outras sessões")
async def alterar_senha(body: SenhaEntrada, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        svc = ConfiguracoesService(s, admin.tenant_id)
        try:
            perfil = await svc.perfil(admin.admin_id, admin.sub)
            await svc.alterar_senha(admin.admin_id, admin.sub, body.atual, body.nova, body.confirmar)
        except ConfigErro as e:
            raise _erro(e)
        await _auditar(s, admin, "config_senha_alterada", "tenant_admin")
    # Token novo: as sessões anteriores deixam de valer (tokens_validos_apos), esta continua.
    return {"token": create_access_token(perfil["email"], tenant_id=admin.tenant_id, role="admin", admin_id=UUID(perfil["id"]))}


@router.post("/resetar", summary="Apaga os dados do CRM (leads, negócios, agenda e conversas do assistente)")
async def resetar(body: ConfirmacaoEntrada, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        svc = ConfiguracoesService(s, admin.tenant_id)
        try:
            await svc.confirmar_senha(admin.admin_id, admin.sub, body.senha)
            if body.confirmacao.strip().upper() != "RESETAR":
                raise ConfigErro("Digite RESETAR para confirmar.")
            apagados = await svc.resetar_crm()
        except ConfigErro as e:
            raise _erro(e)
        await _auditar(s, admin, "config_resetar_crm", "tenant", apagados)
        return {"apagados": apagados}


@router.post("/excluir", summary="Solicita a exclusão da conta (a conta é suspensa na hora)")
async def excluir(body: ConfirmacaoEntrada, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        svc = ConfiguracoesService(s, admin.tenant_id)
        try:
            await svc.confirmar_senha(admin.admin_id, admin.sub, body.senha)
            await svc.solicitar_exclusao(body.confirmacao)
        except ConfigErro as e:
            raise _erro(e)
        await _auditar(s, admin, "config_exclusao_solicitada", "tenant")
        return {"status": "suspended"}


# --- Dados da imobiliária ---------------------------------------------------------

@router.get("/imobiliaria")
async def imobiliaria(admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        return await ConfiguracoesService(s, admin.tenant_id).imobiliaria()


@router.put("/imobiliaria")
async def salvar_imobiliaria(body: Livre, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        try:
            r = await ConfiguracoesService(s, admin.tenant_id).salvar_imobiliaria(body.model_dump())
        except ConfigErro as e:
            raise _erro(e)
        await _auditar(s, admin, "config_imobiliaria", "tenant")
        return r


# --- Equipe ---------------------------------------------------------------------------

@router.get("/equipe")
async def equipe(admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        return await ConfiguracoesService(s, admin.tenant_id).equipe(admin.admin_id, admin.sub)


@router.post("/equipe/admins", status_code=status.HTTP_201_CREATED, summary="Convida um administrador (senha temporária mostrada uma vez)")
async def criar_admin(body: NovoAdmin, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        try:
            r = await ConfiguracoesService(s, admin.tenant_id).criar_admin(body.nome, body.email)
        except ConfigErro as e:
            raise _erro(e)
        await _auditar(s, admin, "config_admin_criado", "tenant_admin", {"email": body.email})
        return r


@router.patch("/equipe/admins/{admin_id}")
async def atualizar_admin(admin_id: UUID, body: AtivoEntrada, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        try:
            await ConfiguracoesService(s, admin.tenant_id).atualizar_admin(admin_id, body.ativo, admin.admin_id)
        except ConfigErro as e:
            raise _erro(e)
        await _auditar(s, admin, "config_admin_atualizado", "tenant_admin", {"id": str(admin_id), "ativo": body.ativo})
        return {"status": "ok"}


# --- Roleta de leads ------------------------------------------------------------------------

@router.get("/roleta")
async def roleta(admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        return await ConfiguracoesService(s, admin.tenant_id).roleta()


@router.put("/roleta")
async def salvar_roleta(body: Livre, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        try:
            r = await ConfiguracoesService(s, admin.tenant_id).salvar_roleta(body.model_dump())
        except ConfigErro as e:
            raise _erro(e)
        await _auditar(s, admin, "config_roleta", "tenant", {"ativa": r["ativa"]})
        return r


# --- Campos & Opções ----------------------------------------------------------------------------

@router.get("/listas")
async def listas(admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        return await ConfiguracoesService(s, admin.tenant_id).listas()


@router.put("/listas/{chave}")
async def salvar_lista(chave: str, body: ListaEntrada, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        try:
            itens = await ConfiguracoesService(s, admin.tenant_id).salvar_lista(chave, body.itens)
        except ConfigErro as e:
            raise _erro(e)
        await _auditar(s, admin, "config_lista", "tenant", {"lista": chave, "itens": len(itens)})
        return {"itens": itens}


# --- Localidades -------------------------------------------------------------------------------------

@router.get("/localidades/cidades")
async def cidades(q: Optional[str] = Query(None, max_length=100), arquivadas: bool = False, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        return await ConfiguracoesService(s, admin.tenant_id).cidades(q, arquivadas)


@router.post("/localidades/cidades", status_code=status.HTTP_201_CREATED)
async def criar_cidade(body: CidadeEntrada, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        try:
            return await ConfiguracoesService(s, admin.tenant_id).criar_cidade(body.nome, body.uf)
        except ConfigErro as e:
            raise _erro(e)


@router.patch("/localidades/cidades/{cidade_id}")
async def atualizar_cidade(cidade_id: UUID, body: CidadeAtualizar, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        try:
            await ConfiguracoesService(s, admin.tenant_id).atualizar_cidade(cidade_id, body.nome, body.uf, body.arquivada)
        except ConfigErro as e:
            raise _erro(e)
        return {"status": "ok"}


@router.delete("/localidades/cidades/{cidade_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir_cidade(cidade_id: UUID, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        await ConfiguracoesService(s, admin.tenant_id).excluir_cidade(cidade_id)


@router.get("/localidades/cidades/{cidade_id}/bairros")
async def bairros(cidade_id: UUID, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        return await ConfiguracoesService(s, admin.tenant_id).bairros(cidade_id)


@router.post("/localidades/cidades/{cidade_id}/bairros", status_code=status.HTTP_201_CREATED)
async def criar_bairro(cidade_id: UUID, body: BairroEntrada, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        try:
            return await ConfiguracoesService(s, admin.tenant_id).criar_bairro(cidade_id, body.nome)
        except ConfigErro as e:
            raise _erro(e)


@router.patch("/localidades/bairros/{bairro_id}")
async def atualizar_bairro(bairro_id: UUID, body: BairroAtualizar, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        try:
            await ConfiguracoesService(s, admin.tenant_id).atualizar_bairro(bairro_id, body.nome, body.arquivado)
        except ConfigErro as e:
            raise _erro(e)
        return {"status": "ok"}


@router.delete("/localidades/bairros/{bairro_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir_bairro(bairro_id: UUID, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        await ConfiguracoesService(s, admin.tenant_id).excluir_bairro(bairro_id)


@router.post("/localidades/importar", summary="Cria cidades e bairros a partir dos imóveis do Imoview em cache")
async def importar_localidades(admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        r = await ConfiguracoesService(s, admin.tenant_id).importar_localidades()
        await _auditar(s, admin, "config_localidades_importadas", "tenant", r)
        return r


# --- Tipos de atividade e lembretes ----------------------------------------------------------------------------

@router.get("/tipos-atividade")
async def tipos_atividade(admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        svc = ConfiguracoesService(s, admin.tenant_id)
        usos = await svc.usos_de_tipos()
        return [{**t, "atividades": usos.get(t["chave"], 0)} for t in await svc.tipos_atividade()]


@router.put("/tipos-atividade")
async def salvar_tipos(body: ListaEntrada, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        svc = ConfiguracoesService(s, admin.tenant_id)
        try:
            tipos = await svc.salvar_tipos_atividade(body.itens)
        except ConfigErro as e:
            raise _erro(e)
        await _auditar(s, admin, "config_tipos_atividade", "tenant", {"tipos": len(tipos)})
        usos = await svc.usos_de_tipos()
        return [{**t, "atividades": usos.get(t["chave"], 0)} for t in tipos]


@router.get("/lembretes")
async def lembretes(admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        return await ConfiguracoesService(s, admin.tenant_id).lembretes()


@router.put("/lembretes")
async def salvar_lembretes(body: ListaEntrada, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as s:
        try:
            regras = await ConfiguracoesService(s, admin.tenant_id).salvar_lembretes(body.itens)
        except ConfigErro as e:
            raise _erro(e)
        await _auditar(s, admin, "config_lembretes", "tenant", {"regras": len(regras)})
        return regras
