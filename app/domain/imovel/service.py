"""
Serviço de Domínio para Imóveis.
Consulta cache local sincronizado do Imoview e formata para encaminhamento ao cliente.
"""
from typing import Any, Dict, List, Optional
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import text

log = structlog.get_logger()


class Imovel:
    def __init__(self, row):
        self.id = row.id
        self.tenant_id = row.tenant_id
        self.codigo_imoview = row.codigo_imoview
        self.finalidade = row.finalidade
        self.tipo = row.tipo
        self.bairro = row.bairro
        self.cidade = row.cidade
        self.area_m2 = float(row.area_m2) if row.area_m2 is not None else None
        self.quartos = row.quartos
        self.vagas = row.vagas
        self.valor = float(row.valor) if row.valor is not None else None
        self.situacao = row.situacao
        self.link_anuncio = row.link_anuncio
        self.dados_extras = row.dados_extras


class ImovelService:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def buscar(
        self,
        tenant_id: UUID,
        finalidade: str,
        bairro: Optional[str] = None,
        tipo: Optional[str] = None,
        quartos_min: Optional[int] = None,
        vagas_min: Optional[int] = None,
        valor_min: Optional[float] = None,
        valor_max: Optional[float] = None,
        codigo: Optional[int] = None,
        limit: int = 5,
    ) -> List[Dict[str, Any]]:
        """
        Busca imóveis no cache local com filtros combinados.
        Retorna no máximo `limit` registros (padrão 5, teto 10).
        """
        where_clauses = ["tenant_id = :tid", "finalidade = :finalidade"]
        params: Dict[str, Any] = {
            "tid": str(tenant_id),
            "finalidade": finalidade.lower(),
            "limit": max(1, min(limit, 10)),
        }

        if codigo:
            where_clauses.append("codigo_imoview = :codigo")
            params["codigo"] = codigo

        if bairro:
            where_clauses.append("bairro ILIKE :bairro")
            params["bairro"] = f"%{bairro.strip()}%"

        if tipo:
            where_clauses.append("tipo ILIKE :tipo")
            params["tipo"] = f"%{tipo.strip()}%"

        if quartos_min:
            where_clauses.append("quartos >= :quartos_min")
            params["quartos_min"] = quartos_min

        if vagas_min:
            where_clauses.append("vagas >= :vagas_min")
            params["vagas_min"] = vagas_min

        if valor_min:
            where_clauses.append("valor >= :valor_min")
            params["valor_min"] = valor_min

        if valor_max:
            where_clauses.append("valor <= :valor_max")
            params["valor_max"] = valor_max

        where_sql = " AND ".join(where_clauses)

        query = text(f"""
            SELECT * FROM imoveis_cache
            WHERE {where_sql}
            ORDER BY valor ASC NULLS LAST
            LIMIT :limit
        """)

        rows = await self._session.execute(query, params)
        imoveis = [Imovel(r) for r in rows.fetchall()]

        resultados = []
        for im in imoveis:
            resumo = self._formatar_resumo_texto(im)
            resultados.append({
                "codigo": im.codigo_imoview,
                "tipo": im.tipo,
                "bairro": im.bairro,
                "cidade": im.cidade,
                "area_m2": im.area_m2,
                "quartos": im.quartos,
                "vagas": im.vagas,
                "valor": im.valor,
                "situacao": im.situacao,
                "link_anuncio": im.link_anuncio,
                "foto_url": (im.dados_extras or {}).get("foto_url") if isinstance(im.dados_extras, dict) else None,
                "resumo_texto": resumo,
            })

        return resultados

    def _formatar_resumo_texto(self, im: Imovel) -> str:
        """
        Formata o imóvel como texto pronto para o corretor copiar e encaminhar ao cliente.
        """
        partes = [f"🏠 *{im.tipo or 'Imóvel'}* no bairro *{im.bairro or 'não informado'}*"]
        if im.cidade:
            partes[0] += f" - {im.cidade}"

        detalhes = []
        if im.quartos:
            detalhes.append(f"{im.quartos} quarto(s)")
        if im.vagas:
            detalhes.append(f"{im.vagas} vaga(s)")
        if im.area_m2:
            detalhes.append(f"{im.area_m2:.0f}m²")

        if detalhes:
            partes.append("📐 " + " • ".join(detalhes))

        if im.valor:
            if im.finalidade == "aluguel":
                partes.append(f"💰 Aluguel: *R$ {im.valor:,.2f}/mês*".replace(",", "X").replace(".", ",").replace("X", "."))
            else:
                partes.append(f"💰 Valor: *R$ {im.valor:,.2f}*".replace(",", "X").replace(".", ",").replace("X", "."))

        partes.append(f"🔖 Código: {im.codigo_imoview}")

        if im.link_anuncio:
            partes.append(f"🔗 Mais fotos e detalhes: {im.link_anuncio}")

        return "\n".join(partes)
