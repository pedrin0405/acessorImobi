"""
Portal do Corretor — somente leitura.

Permissões:
- Consulta seus próprios clientes, imóveis e histórico de conversas
- NÃO vê dados de outro corretor
- NÃO vê lista de corretores
- NÃO acessa configuração do tenant
- Recursos fora do escopo retornam 404 (não 403), para não revelar existência
"""
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.api.middleware.auth import require_corretor
from app.domain.imovel.service import ImovelService
from app.domain.cliente.service import ClienteService
from app.domain.conversa.service import ConversaService
from app.shared.database import get_session

router = APIRouter()


class ImovelResponse(BaseModel):
    codigo: int
    tipo: Optional[str]
    bairro: Optional[str]
    cidade: Optional[str]
    area_m2: Optional[float]
    quartos: Optional[int]
    vagas: Optional[int]
    valor: Optional[float]
    situacao: Optional[str]
    link_anuncio: Optional[str]
    # Formato pronto para encaminhar ao cliente pelo WhatsApp
    resumo_texto: str


class ClienteResponse(BaseModel):
    codigo: int
    nome: str
    email: Optional[str]
    telefone_mascarado: str
    tipo: Optional[str]


# --- Endpoints ---

@router.get(
    "/imoveis",
    response_model=List[ImovelResponse],
    summary="Busca imóveis (máx. 5 resultados)",
)
async def buscar_imoveis(
    finalidade: str = Query(..., description="aluguel | venda"),
    bairro: Optional[str] = None,
    tipo: Optional[str] = None,
    quartos_min: Optional[int] = None,
    valor_max: Optional[float] = None,
    codigo: Optional[int] = None,
    corretor=Depends(require_corretor),
):
    """
    Busca no cache local de imóveis. Máx. 5 resultados.
    Retorna dados formatados para o corretor encaminhar ao cliente.
    """
    async with get_session(corretor.tenant_id) as session:
        service = ImovelService(session)
        return await service.buscar(
            finalidade=finalidade,
            bairro=bairro,
            tipo=tipo,
            quartos_min=quartos_min,
            valor_max=valor_max,
            codigo=codigo,
            limit=5,
        )


@router.get(
    "/clientes",
    response_model=List[ClienteResponse],
    summary="Busca clientes no Imoview",
)
async def buscar_clientes(
    q: str = Query(..., description="Nome, telefone, e-mail ou código"),
    corretor=Depends(require_corretor),
):
    """
    Consulta clientes no Imoview sob demanda (com cache de 15 min).
    """
    async with get_session(corretor.tenant_id) as session:
        service = ClienteService(session)
        return await service.buscar(q=q, tenant_id=corretor.tenant_id)


@router.get(
    "/historico",
    summary="Histórico das últimas conversas do corretor",
)
async def historico_conversa(
    limit: int = 20,
    corretor=Depends(require_corretor),
):
    async with get_session(corretor.tenant_id) as session:
        service = ConversaService(session)
        return await service.historico(
            corretor_id=corretor.corretor_id,
            limit=limit,
        )
