"""
CRM do corretor: leads com perfil de busca, funil de negócios e agenda.

Os dados vivem no Acessor (não no Imoview). O Imoview continua fonte dos
imóveis (imoveis_cache) e do cadastro oficial de clientes; o lead guarda o
código do cliente no Imoview quando houver.
"""
import json
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import text

from app.domain.imovel.service import ImovelService

log = structlog.get_logger()

# (nome, probabilidade %, alerta em dias, cor)
ETAPAS_PADRAO = [
    ("Lead", 5, 14, "slate"),
    ("Contato feito", 15, 14, "sky"),
    ("Qualificado", 30, 14, "sky"),
    ("Visita agendada", 50, 14, "amber"),
    ("Visita realizada", 60, 14, "amber"),
    ("Proposta", 70, 14, "amber"),
    ("Negociação", 85, 14, "emerald"),
]

TIPOS_ATIVIDADE = (
    "visita", "reuniao", "ligacao", "follow_up", "whatsapp", "tarefa", "email", "documento",
)

ROTULO_TIPO = {
    "visita": "Visita", "reuniao": "Reunião", "ligacao": "Ligação", "follow_up": "Follow-up",
    "whatsapp": "WhatsApp", "tarefa": "Tarefa", "email": "E-mail", "documento": "Documento",
}

CAMPOS_PERFIL = (
    "interesse", "tipos", "bairros", "quartos_min", "vagas_min",
    "valor_max", "area_min", "prazo",
)


def _telefone_busca(telefone: Optional[str]) -> Optional[str]:
    """Últimos 11 dígitos, para achar o mesmo número escrito de formas diferentes."""
    digitos = re.sub(r"\D", "", telefone or "")
    return digitos[-11:] if len(digitos) >= 8 else None


class CrmError(ValueError):
    """Operação inválida no CRM (mensagem pronta para o usuário)."""


def _json(valor: Any) -> Any:
    """Converte tipos do banco em JSON simples."""
    if isinstance(valor, UUID):
        return str(valor)
    if isinstance(valor, Decimal):
        return float(valor)
    if isinstance(valor, (datetime, date)):
        return valor.isoformat()
    return valor


def _linha(row) -> Dict[str, Any]:
    return {k: _json(v) for k, v in row._mapping.items()}


def normalizar_perfil(perfil: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Mantém só os campos conhecidos, com listas em minúsculas e números válidos."""
    perfil = perfil or {}
    saida: Dict[str, Any] = {}
    for campo in ("interesse", "tipos", "bairros"):
        valor = perfil.get(campo)
        if isinstance(valor, str):
            valor = [valor]
        if isinstance(valor, list):
            itens = [str(v).strip() for v in valor if str(v).strip()]
            if campo != "bairros":
                itens = [i.lower() for i in itens]
            if itens:
                saida[campo] = list(dict.fromkeys(itens))
    for campo in ("quartos_min", "vagas_min"):
        try:
            if perfil.get(campo) not in (None, ""):
                saida[campo] = max(0, int(perfil[campo]))
        except (TypeError, ValueError):
            pass
    for campo in ("valor_max", "area_min"):
        try:
            if perfil.get(campo) not in (None, ""):
                saida[campo] = max(0.0, float(perfil[campo]))
        except (TypeError, ValueError):
            pass
    if perfil.get("prazo") in ("imediato", "3_meses", "6_meses", "sem_pressa"):
        saida["prazo"] = perfil["prazo"]
    return saida


def resumo_perfil(perfil: Dict[str, Any]) -> str:
    """Perfil de busca em uma linha legível ('aluga apartamento · 2+ quartos · Orla · até R$ 3.000')."""
    partes = []
    verbos = {"comprar": "compra", "alugar": "aluga", "vender": "vende"}
    if perfil.get("interesse"):
        partes.append("/".join(verbos.get(i, i) for i in perfil["interesse"]))
    if perfil.get("tipos"):
        partes.append("/".join(perfil["tipos"]))
    if perfil.get("quartos_min"):
        partes.append(f"{perfil['quartos_min']}+ quartos")
    if perfil.get("vagas_min"):
        partes.append(f"{perfil['vagas_min']}+ vagas")
    if perfil.get("bairros"):
        partes.append(", ".join(perfil["bairros"]))
    if perfil.get("valor_max"):
        valor = f"{perfil['valor_max']:,.0f}".replace(",", ".")
        partes.append(f"até R$ {valor}")
    return " · ".join(partes) or "sem perfil de busca"


class CrmService:
    def __init__(self, session: AsyncSession):
        self._session = session

    # --- Etapas -----------------------------------------------------------

    async def etapas(self, tenant_id: UUID) -> List[Dict[str, Any]]:
        """Etapas do funil em ordem; cria as padrão na primeira consulta."""
        rows = await self._session.execute(
            text("SELECT * FROM crm_etapas WHERE tenant_id = :tid ORDER BY ordem"),
            {"tid": str(tenant_id)},
        )
        etapas = [_linha(r) for r in rows.fetchall()]
        if etapas:
            return etapas

        for ordem, (nome, prob, alerta, cor) in enumerate(ETAPAS_PADRAO):
            await self._session.execute(
                text("""
                    INSERT INTO crm_etapas (tenant_id, nome, ordem, probabilidade, alerta_dias, cor)
                    VALUES (:tid, :nome, :ordem, :prob, :alerta, :cor)
                    ON CONFLICT (tenant_id, nome) DO NOTHING
                """),
                {"tid": str(tenant_id), "nome": nome, "ordem": ordem,
                 "prob": prob, "alerta": alerta, "cor": cor},
            )
        return await self.etapas(tenant_id)

    async def atualizar_etapas(self, tenant_id: UUID, itens: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Atualiza probabilidade e alerta de dias (vazio = nunca alertar)."""
        for item in itens:
            prob = int(item["probabilidade"])
            if not 0 <= prob <= 100:
                raise CrmError("A probabilidade deve ficar entre 0 e 100%.")
            alerta = item.get("alerta_dias")
            alerta = int(alerta) if alerta not in (None, "") else None
            if alerta is not None and alerta <= 0:
                raise CrmError("O alerta deve ter pelo menos 1 dia, ou ficar vazio.")
            await self._session.execute(
                text("""
                    UPDATE crm_etapas SET probabilidade = :prob, alerta_dias = :alerta
                    WHERE id = :id AND tenant_id = :tid
                """),
                {"prob": prob, "alerta": alerta, "id": str(item["id"]), "tid": str(tenant_id)},
            )
        return await self.etapas(tenant_id)

    async def _etapa_por_nome(self, tenant_id: UUID, nome: Optional[str]) -> Dict[str, Any]:
        etapas = await self.etapas(tenant_id)
        if not nome:
            return etapas[0]
        alvo = nome.strip().lower()
        for etapa in etapas:
            if etapa["nome"].lower() == alvo:
                return etapa
        for etapa in etapas:
            if alvo in etapa["nome"].lower():
                return etapa
        nomes = ", ".join(e["nome"] for e in etapas)
        raise CrmError(f"Não conheço a etapa '{nome}'. As etapas são: {nomes}.")

    # --- Leads ------------------------------------------------------------

    async def criar_lead(
        self,
        tenant_id: UUID,
        corretor_id: UUID,
        nome: str,
        telefone: Optional[str] = None,
        email: Optional[str] = None,
        perfil: Optional[Dict[str, Any]] = None,
        observacoes: Optional[str] = None,
        origem: str = "whatsapp",
        temperatura: str = "morno",
    ) -> Dict[str, Any]:
        nome = (nome or "").strip()
        if len(nome) < 2:
            raise CrmError("Preciso do nome do cliente para cadastrar.")
        if temperatura not in ("quente", "morno", "frio"):
            temperatura = "morno"
        row = await self._session.execute(
            text("""
                INSERT INTO crm_leads (
                    tenant_id, corretor_id, nome, telefone, telefone_busca, email, origem,
                    temperatura, perfil, observacoes, ultimo_contato
                ) VALUES (
                    :tid, :cid, :nome, :tel, :busca, :email, :origem,
                    :temp, CAST(:perfil AS jsonb), :obs, NOW()
                )
                RETURNING *
            """),
            {
                "tid": str(tenant_id), "cid": str(corretor_id), "nome": nome[:255],
                "tel": (telefone or None), "busca": _telefone_busca(telefone), "email": (email or None), "origem": origem[:40],
                "temp": temperatura, "perfil": json.dumps(normalizar_perfil(perfil)),
                "obs": observacoes,
            },
        )
        lead = _linha(row.first())
        await self.garantir_negocios(tenant_id, lead_ids=[lead["id"]])
        return lead

    async def atualizar_lead(
        self,
        tenant_id: UUID,
        lead_id: UUID,
        perfil: Optional[Dict[str, Any]] = None,
        observacoes: Optional[str] = None,
        temperatura: Optional[str] = None,
        status: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Mescla o perfil (campos novos sobrescrevem) e atualiza os demais campos."""
        lead = await self.get_lead(tenant_id, lead_id)
        if not lead:
            raise CrmError("Não encontrei esse cliente.")
        novo_perfil = {**(lead.get("perfil") or {}), **normalizar_perfil(perfil)}
        if temperatura not in (None, "quente", "morno", "frio"):
            raise CrmError("Temperatura deve ser quente, morno ou frio.")
        if status not in (None, "lead", "cliente", "arquivado"):
            raise CrmError("Status inválido.")
        row = await self._session.execute(
            text("""
                UPDATE crm_leads SET
                    perfil = CAST(:perfil AS jsonb),
                    observacoes = COALESCE(:obs, observacoes),
                    temperatura = COALESCE(:temp, temperatura),
                    status = COALESCE(:status, status),
                    ultimo_contato = NOW()
                WHERE id = :id AND tenant_id = :tid
                RETURNING *
            """),
            {"perfil": json.dumps(novo_perfil), "obs": observacoes, "temp": temperatura,
             "status": status, "id": str(lead_id), "tid": str(tenant_id)},
        )
        return _linha(row.first())

    async def get_lead(self, tenant_id: UUID, lead_id: UUID) -> Optional[Dict[str, Any]]:
        row = await self._session.execute(
            text("SELECT * FROM crm_leads WHERE id = :id AND tenant_id = :tid"),
            {"id": str(lead_id), "tid": str(tenant_id)},
        )
        r = row.first()
        return _linha(r) if r else None

    async def listar_leads(
        self,
        tenant_id: UUID,
        corretor_id: Optional[UUID] = None,
        termo: Optional[str] = None,
        limit: int = 50,
        incluir_sem_responsavel: bool = False,
    ) -> List[Dict[str, Any]]:
        where = ["l.tenant_id = :tid", "l.status <> 'arquivado'"]
        params: Dict[str, Any] = {"tid": str(tenant_id), "limit": max(1, min(limit, 500))}
        if corretor_id:
            where.append("l.corretor_id = :cid")
            params["cid"] = str(corretor_id)
        if termo:
            where.append("(l.nome ILIKE :termo OR l.telefone ILIKE :termo)")
            params["termo"] = f"%{termo.strip()}%"
        rows = await self._session.execute(
            text(f"""
                SELECT l.*, c.nome AS corretor_nome,
                       (SELECT COUNT(*) FROM crm_negocios n
                        WHERE n.lead_id = l.id AND n.status = 'aberto') AS negocios_abertos
                FROM crm_leads l
                {'LEFT ' if incluir_sem_responsavel else ''}JOIN corretores c ON c.id = l.corretor_id
                WHERE {' AND '.join(where)}
                ORDER BY l.updated_at DESC
                LIMIT :limit
            """),
            params,
        )
        return [_linha(r) for r in rows.fetchall()]

    # --- Clientes do portal (paginado; inclui leads sem responsável) ----------------

    @staticmethod
    def _filtro_clientes(
        tenant_id: UUID, termo: Optional[str], responsavel: Optional[str], origem: Optional[str], temperatura: Optional[str],
    ) -> "tuple[str, Dict[str, Any]]":
        where = ["l.tenant_id = :tid", "l.status <> 'arquivado'"]
        params: Dict[str, Any] = {"tid": str(tenant_id)}
        termo = (termo or "").strip()
        if termo:
            digitos = re.sub(r"\D", "", termo)
            condicoes = ["l.nome ILIKE :termo", "l.email ILIKE :termo"]
            params["termo"] = f"%{termo}%"
            if len(digitos) >= 4:
                condicoes.append("l.telefone_busca LIKE :fone")
                params["fone"] = f"%{digitos[-11:]}%"
            where.append("(" + " OR ".join(condicoes) + ")")
        if responsavel == "sem":
            where.append("l.corretor_id IS NULL")
        elif responsavel:
            where.append("l.corretor_id = :resp")
            params["resp"] = str(UUID(responsavel))
        if origem:
            where.append("l.origem = :origem")
            params["origem"] = origem
        if temperatura in ("quente", "morno", "frio"):
            where.append("l.temperatura = :temp")
            params["temp"] = temperatura
        return " AND ".join(where), params

    async def listar_clientes(
        self,
        tenant_id: UUID,
        termo: Optional[str] = None,
        responsavel: Optional[str] = None,
        origem: Optional[str] = None,
        temperatura: Optional[str] = None,
        ordem: str = "recentes",
        pagina: int = 1,
        por_pagina: int = 25,
    ) -> Dict[str, Any]:
        """Carteira inteira da imobiliária, paginada. `responsavel`: 'sem' ou o id de um corretor."""
        onde, params = self._filtro_clientes(tenant_id, termo, responsavel, origem, temperatura)
        por_pagina = max(5, min(por_pagina, 100))
        pagina = max(1, pagina)
        ordenacao = {
            "recentes": "l.created_at DESC, l.id", "atualizados": "l.updated_at DESC, l.id",
            "nome": "lower(l.nome), l.id",
        }.get(ordem, "l.created_at DESC, l.id")
        total = (await self._session.execute(text(f"SELECT COUNT(*) FROM crm_leads l WHERE {onde}"), params)).scalar() or 0
        rows = await self._session.execute(
            text(f"""
                SELECT l.*, c.nome AS corretor_nome,
                       (SELECT COUNT(*) FROM crm_negocios n WHERE n.lead_id = l.id AND n.status = 'aberto') AS negocios_abertos
                FROM crm_leads l LEFT JOIN corretores c ON c.id = l.corretor_id
                WHERE {onde} ORDER BY {ordenacao} LIMIT :limite OFFSET :desloca
            """),
            {**params, "limite": por_pagina, "desloca": (pagina - 1) * por_pagina},
        )
        resumo = (await self._session.execute(
            text("""SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE corretor_id IS NULL) AS sem_responsavel,
                           COUNT(*) FILTER (WHERE origem = 'imoview') AS imoview
                    FROM crm_leads WHERE tenant_id = :tid AND status <> 'arquivado'"""),
            {"tid": str(tenant_id)},
        )).first()
        return {
            "itens": [_linha(r) for r in rows.fetchall()],
            "total": total, "pagina": pagina, "por_pagina": por_pagina, "paginas": max(1, -(-total // por_pagina)),
            "resumo": {"total": resumo.total, "sem_responsavel": resumo.sem_responsavel, "imoview": resumo.imoview},
        }

    async def atribuir_clientes(
        self,
        tenant_id: UUID,
        corretores: List[UUID],
        ids: Optional[List[UUID]] = None,
        filtro: Optional[Dict[str, Any]] = None,
        limite: int = 5000,
    ) -> int:
        """
        Atribui clientes a um corretor (lista de um) ou os distribui em rodízio entre vários.
        Seleciona por `ids` ou pelo mesmo `filtro` da listagem (até `limite`). Devolve quantos mudaram.
        """
        if not corretores:
            raise CrmError("Escolha o corretor responsável.")
        if ids:
            alvo = [str(i) for i in ids[:limite]]
        else:
            f = filtro or {}
            onde, params = self._filtro_clientes(tenant_id, f.get("termo"), f.get("responsavel"), f.get("origem"), f.get("temperatura"))
            linhas = await self._session.execute(
                text(f"SELECT l.id FROM crm_leads l WHERE {onde} ORDER BY l.created_at DESC, l.id LIMIT :limite"),
                {**params, "limite": limite},
            )
            alvo = [str(r.id) for r in linhas.fetchall()]
        if not alvo:
            return 0
        donos = [str(corretores[i % len(corretores)]) for i in range(len(alvo))]
        r = await self._session.execute(
            text("""
                UPDATE crm_leads l SET corretor_id = v.dono, updated_at = NOW()
                FROM (SELECT unnest(CAST(:ids AS uuid[])) AS id, unnest(CAST(:donos AS uuid[])) AS dono) v
                WHERE l.id = v.id AND l.tenant_id = :tid
            """),
            {"ids": alvo, "donos": donos, "tid": str(tenant_id)},
        )
        # Os negócios abertos que ainda não tinham dono (ou criados pelo sistema) seguem o novo responsável.
        await self._session.execute(
            text("""
                UPDATE crm_negocios n SET corretor_id = l.corretor_id, updated_at = NOW()
                FROM crm_leads l
                WHERE n.lead_id = l.id AND n.tenant_id = :tid AND l.id = ANY(CAST(:ids AS uuid[]))
                  AND n.status = 'aberto' AND (n.corretor_id IS NULL OR n.automatico)
            """),
            {"ids": alvo, "tid": str(tenant_id)},
        )
        return r.rowcount or 0

    async def encontrar_lead(
        self, tenant_id: UUID, corretor_id: UUID, nome: str
    ) -> Optional[Dict[str, Any]]:
        """Lead do corretor pelo nome (exato primeiro, depois parcial; o mais recente)."""
        nome = (nome or "").strip()
        if not nome:
            return None
        for padrao in (nome, f"%{nome}%"):
            row = await self._session.execute(
                text("""
                    SELECT * FROM crm_leads
                    WHERE tenant_id = :tid AND corretor_id = :cid
                      AND status <> 'arquivado' AND nome ILIKE :padrao
                    ORDER BY updated_at DESC LIMIT 1
                """),
                {"tid": str(tenant_id), "cid": str(corretor_id), "padrao": padrao},
            )
            r = row.first()
            if r:
                return _linha(r)
        return None

    async def match(self, tenant_id: UUID, lead: Dict[str, Any], limit: int = 5) -> List[Dict[str, Any]]:
        """Imóveis do cache que atendem ao perfil de busca do lead."""
        perfil = lead.get("perfil") or {}
        interesse = perfil.get("interesse") or []
        if "alugar" in interesse and "comprar" not in interesse:
            finalidades = ["aluguel"]
        elif "comprar" in interesse and "alugar" not in interesse:
            finalidades = ["venda"]
        elif interesse:
            finalidades = ["venda", "aluguel"]
        else:
            # Sem interesse explícito o valor decide, como na busca do agente.
            valor = perfil.get("valor_max") or 0
            finalidades = ["venda"] if valor >= 50_000 else ["aluguel"] if valor else ["venda", "aluguel"]

        bairros = perfil.get("bairros") or [None]
        tipos = perfil.get("tipos") or [None]
        imovel_service = ImovelService(self._session)
        encontrados: Dict[int, Dict[str, Any]] = {}
        for finalidade in finalidades:
            for bairro in bairros:
                for tipo in tipos:
                    for im in await imovel_service.buscar(
                        tenant_id=tenant_id,
                        finalidade=finalidade,
                        bairro=bairro,
                        tipo=tipo,
                        quartos_min=perfil.get("quartos_min"),
                        vagas_min=perfil.get("vagas_min"),
                        valor_max=perfil.get("valor_max"),
                        limit=limit,
                    ):
                        if perfil.get("area_min") and (im.get("area_m2") or 0) < perfil["area_min"]:
                            continue
                        encontrados.setdefault(im["codigo"], im)
                    if len(encontrados) >= limit:
                        return list(encontrados.values())[:limit]
        return list(encontrados.values())[:limit]

    async def matches_novos(self, tenant_id: UUID, lead: Dict[str, Any], limit: int = 3) -> List[Dict[str, Any]]:
        """Matches ainda não avisados; marca como avisados os devolvidos."""
        if not normalizar_perfil(lead.get("perfil")):
            return []
        candidatos = await self.match(tenant_id, lead, limit=10)
        if not candidatos:
            return []
        rows = await self._session.execute(
            text("SELECT imovel_codigo FROM crm_matches WHERE lead_id = :lid"),
            {"lid": lead["id"]},
        )
        avisados = {r.imovel_codigo for r in rows.fetchall()}
        novos = [im for im in candidatos if im["codigo"] not in avisados][:limit]
        for im in novos:
            await self._session.execute(
                text("""
                    INSERT INTO crm_matches (tenant_id, lead_id, imovel_codigo)
                    VALUES (:tid, :lid, :cod) ON CONFLICT DO NOTHING
                """),
                {"tid": str(tenant_id), "lid": lead["id"], "cod": im["codigo"]},
            )
        return novos

    # --- Negócios ---------------------------------------------------------

    async def criar_negocio(
        self,
        tenant_id: UUID,
        corretor_id: UUID,
        lead_id: UUID,
        etapa: Optional[str] = None,
        valor: Optional[float] = None,
        imovel_codigo: Optional[int] = None,
        fechamento_previsto: Optional[date] = None,
        titulo: Optional[str] = None,
        autor: str = "agent",
    ) -> Dict[str, Any]:
        lead = await self.get_lead(tenant_id, lead_id)
        if not lead:
            raise CrmError("Não encontrei esse cliente.")
        etapa_row = await self._etapa_por_nome(tenant_id, etapa)
        # O cliente já tem um negócio criado pelo sistema: quem abre um negócio "assume" esse, sem duplicar.
        auto = (await self._session.execute(
            text("""SELECT id FROM crm_negocios WHERE tenant_id = :tid AND lead_id = :lid
                    AND automatico AND status = 'aberto' ORDER BY created_at LIMIT 1"""),
            {"tid": str(tenant_id), "lid": str(lead_id)},
        )).first()
        if auto:
            atual = await self.get_negocio(tenant_id, auto.id)
            row = await self._session.execute(
                text("""
                    UPDATE crm_negocios SET corretor_id = :cid, etapa_id = :eid, valor = :valor, imovel_codigo = :imovel,
                        fechamento_previsto = :fechamento, automatico = FALSE,
                        etapa_desde = CASE WHEN etapa_id <> :eid THEN NOW() ELSE etapa_desde END
                    WHERE id = :id RETURNING *
                """),
                {"cid": str(corretor_id), "eid": etapa_row["id"], "valor": max(0.0, float(valor or 0)), "imovel": imovel_codigo,
                 "fechamento": fechamento_previsto, "id": str(auto.id)},
            )
            if atual and atual["etapa_nome"] != etapa_row["nome"]:
                await self._evento(tenant_id, str(auto.id), "etapa", atual["etapa_nome"], etapa_row["nome"], autor)
            return {**_linha(row.first()), "etapa_nome": etapa_row["nome"]}
        row = await self._session.execute(
            text("""
                INSERT INTO crm_negocios (
                    tenant_id, corretor_id, lead_id, etapa_id, titulo, valor,
                    imovel_codigo, fechamento_previsto
                ) VALUES (
                    :tid, :cid, :lid, :eid, :titulo, :valor, :imovel, :fechamento
                )
                RETURNING *
            """),
            {
                "tid": str(tenant_id), "cid": str(corretor_id), "lid": str(lead_id),
                "eid": etapa_row["id"], "titulo": (titulo or lead["nome"])[:255],
                "valor": max(0.0, float(valor or 0)), "imovel": imovel_codigo,
                "fechamento": fechamento_previsto,
            },
        )
        negocio = _linha(row.first())
        await self._evento(tenant_id, negocio["id"], "criado", None, etapa_row["nome"], autor)
        return {**negocio, "etapa_nome": etapa_row["nome"]}

    async def mover_negocio(
        self,
        tenant_id: UUID,
        negocio_id: UUID,
        etapa: Optional[str] = None,
        status: Optional[str] = None,
        motivo_perda: Optional[str] = None,
        valor: Optional[float] = None,
        autor: str = "agent",
    ) -> Dict[str, Any]:
        """Muda a etapa, ou fecha como ganho/perdido (perda exige motivo)."""
        atual = await self.get_negocio(tenant_id, negocio_id)
        if not atual:
            raise CrmError("Não encontrei esse negócio.")

        if status in ("ganho", "perdido"):
            if status == "perdido" and not (motivo_perda or "").strip():
                raise CrmError("Para marcar como perdido, me diga o motivo da perda.")
            row = await self._session.execute(
                text("""
                    UPDATE crm_negocios SET status = :st, motivo_perda = :motivo,
                        valor = COALESCE(:valor, valor), fechado_em = NOW()
                    WHERE id = :id AND tenant_id = :tid RETURNING *
                """),
                {"st": status, "motivo": (motivo_perda or None), "valor": valor,
                 "id": str(negocio_id), "tid": str(tenant_id)},
            )
            await self._evento(tenant_id, str(negocio_id), status, atual["etapa_nome"], motivo_perda, autor)
            await self._pendencia_imoview(tenant_id, negocio_id, autor, status=status, motivo=motivo_perda)
            return {**_linha(row.first()), "etapa_nome": atual["etapa_nome"]}

        if status == "aberto":
            row = await self._session.execute(
                text("""
                    UPDATE crm_negocios SET status = 'aberto', motivo_perda = NULL, fechado_em = NULL
                    WHERE id = :id AND tenant_id = :tid RETURNING *
                """),
                {"id": str(negocio_id), "tid": str(tenant_id)},
            )
            await self._evento(tenant_id, str(negocio_id), "reaberto", atual["status"], "aberto", autor)
            return {**_linha(row.first()), "etapa_nome": atual["etapa_nome"]}

        etapa_row = await self._etapa_por_nome(tenant_id, etapa)
        mudou = etapa_row["id"] != atual["etapa_id"]
        row = await self._session.execute(
            text(f"""
                UPDATE crm_negocios SET etapa_id = :eid, valor = COALESCE(:valor, valor)
                    {', etapa_desde = NOW()' if mudou else ''}
                WHERE id = :id AND tenant_id = :tid RETURNING *
            """),
            {"eid": etapa_row["id"], "valor": valor, "id": str(negocio_id), "tid": str(tenant_id)},
        )
        if mudou:
            await self._evento(tenant_id, str(negocio_id), "etapa", atual["etapa_nome"], etapa_row["nome"], autor)
            await self._pendencia_imoview(tenant_id, negocio_id, autor, etapa_id=str(etapa_row["id"]))
        return {**_linha(row.first()), "etapa_nome": etapa_row["nome"]}

    async def _pendencia_imoview(self, tenant_id, negocio_id, autor, **mudanca) -> None:
        """Mudança feita no portal/agente em negócio ligado ao Imoview entra na fila de envio (o sync não passa por aqui)."""
        if autor == "imoview":
            return
        from app.domain.crm.atendimentos_imoview import registrar_pendencia

        await registrar_pendencia(self._session, tenant_id, negocio_id, **mudanca)

    async def _evento(self, tenant_id, negocio_id, tipo, de, para, autor) -> None:
        await self._session.execute(
            text("""
                INSERT INTO crm_negocio_eventos (tenant_id, negocio_id, tipo, de, para, autor)
                VALUES (:tid, :nid, :tipo, :de, :para, :autor)
            """),
            {"tid": str(tenant_id), "nid": str(negocio_id), "tipo": tipo,
             "de": (de or None) and str(de)[:80], "para": (para or None) and str(para)[:80],
             "autor": autor if autor in ("agent", "portal", "scheduler", "imoview") else "agent"},
        )

    _SELECT_NEGOCIO = """
        SELECT n.*, e.nome AS etapa_nome, e.ordem AS etapa_ordem,
               e.probabilidade, e.alerta_dias, e.cor AS etapa_cor,
               l.nome AS lead_nome, l.telefone AS lead_telefone, l.email AS lead_email,
               l.origem AS lead_origem, l.temperatura AS lead_temperatura,
               c.nome AS corretor_nome,
               ia.funil AS im_funil, ia.midia AS im_midia, ia.campanha AS im_campanha, ia.termometro AS im_termometro,
               ia.corretor_nome AS im_corretor_nome, ia.ultima_interacao_em AS im_ultima_interacao,
               ia.n_interacoes AS im_n_interacoes, ia.n_visitas AS im_n_visitas, ia.n_propostas AS im_n_propostas,
               ia.qualificado AS im_qualificado, ia.previsao_fechamento_em AS im_previsao_fechamento,
               EXTRACT(DAY FROM NOW() - n.etapa_desde)::int AS dias_na_etapa,
               (n.status = 'aberto' AND NOT n.automatico AND e.alerta_dias IS NOT NULL
                AND n.etapa_desde < NOW() - make_interval(days => e.alerta_dias)) AS travado
        FROM crm_negocios n
        JOIN crm_etapas e ON e.id = n.etapa_id
        JOIN crm_leads l ON l.id = n.lead_id
        LEFT JOIN corretores c ON c.id = n.corretor_id
        LEFT JOIN imoview_atendimentos ia ON ia.tenant_id = n.tenant_id AND ia.codigo = n.imoview_atendimento
    """

    async def get_negocio(self, tenant_id: UUID, negocio_id: UUID) -> Optional[Dict[str, Any]]:
        row = await self._session.execute(
            text(self._SELECT_NEGOCIO + " WHERE n.id = :id AND n.tenant_id = :tid"),
            {"id": str(negocio_id), "tid": str(tenant_id)},
        )
        r = row.first()
        return _linha(r) if r else None

    async def listar_negocios(
        self,
        tenant_id: UUID,
        corretor_id: Optional[UUID] = None,
        status: Optional[str] = "aberto",
        lead_id: Optional[UUID] = None,
        termo: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        where = ["n.tenant_id = :tid"]
        params: Dict[str, Any] = {"tid": str(tenant_id)}
        if status:
            where.append("n.status = :status")
            params["status"] = status
        if corretor_id:
            where.append("n.corretor_id = :cid")
            params["cid"] = str(corretor_id)
        if lead_id:
            where.append("n.lead_id = :lid")
            params["lid"] = str(lead_id)
        if termo:
            where.append("(l.nome ILIKE :termo OR n.titulo ILIKE :termo)")
            params["termo"] = f"%{termo.strip()}%"
        rows = await self._session.execute(
            text(self._SELECT_NEGOCIO + f" WHERE {' AND '.join(where)} ORDER BY e.ordem, n.updated_at DESC"),
            params,
        )
        negocios = []
        for r in rows.fetchall():
            n = _linha(r)
            n["esperado"] = round(n["valor"] * n["probabilidade"] / 100, 2)
            negocios.append(n)
        return negocios

    async def encontrar_negocio(
        self, tenant_id: UUID, corretor_id: UUID, nome_lead: str
    ) -> Optional[Dict[str, Any]]:
        """Negócio aberto mais recente do corretor para o cliente citado."""
        candidatos = await self.listar_negocios(tenant_id, corretor_id, status="aberto", termo=nome_lead)
        if not candidatos:
            return None
        return max(candidatos, key=lambda n: n["updated_at"])

    async def eventos(self, tenant_id: UUID, negocio_id: UUID) -> List[Dict[str, Any]]:
        rows = await self._session.execute(
            text("""
                SELECT tipo, de, para, autor, created_at FROM crm_negocio_eventos
                WHERE tenant_id = :tid AND negocio_id = :nid ORDER BY created_at
            """),
            {"tid": str(tenant_id), "nid": str(negocio_id)},
        )
        return [_linha(r) for r in rows.fetchall()]

    @staticmethod
    def _filtro_negocios(
        tenant_id: UUID, status: Optional[str], corretor: Optional[str], termo: Optional[str], etapa_id: Optional[str] = None,
    ) -> "tuple[str, Dict[str, Any]]":
        where = ["n.tenant_id = :tid"]
        params: Dict[str, Any] = {"tid": str(tenant_id)}
        if status in ("aberto", "ganho", "perdido"):
            where.append("n.status = :status")
            params["status"] = status
        if corretor == "sem":
            where.append("n.corretor_id IS NULL")
        elif corretor:
            where.append("n.corretor_id = :cid")
            params["cid"] = str(UUID(corretor))
        if etapa_id:
            where.append("n.etapa_id = :eid")
            params["eid"] = str(UUID(etapa_id))
        termo = (termo or "").strip()
        if termo:
            digitos = re.sub(r"\D", "", termo)
            condicoes = ["l.nome ILIKE :termo", "n.titulo ILIKE :termo"]
            params["termo"] = f"%{termo}%"
            if len(digitos) >= 4:
                condicoes.append("l.telefone_busca LIKE :fone")
                params["fone"] = f"%{digitos[-11:]}%"
            where.append("(" + " OR ".join(condicoes) + ")")
        return " AND ".join(where), params

    async def _agregado_etapas(self, tenant_id: UUID, status, corretor, termo) -> List[Dict[str, Any]]:
        """Contagem, valor e esperado por etapa, calculados no banco (o funil pode ter dezenas de milhares)."""
        etapas = await self.etapas(tenant_id)
        onde, params = self._filtro_negocios(tenant_id, status, corretor, termo)
        rows = await self._session.execute(
            text(f"""
                SELECT n.etapa_id, COUNT(*) AS quantidade, COALESCE(SUM(n.valor), 0) AS total,
                       COUNT(*) FILTER (WHERE n.status = 'aberto' AND NOT n.automatico AND e.alerta_dias IS NOT NULL
                                        AND n.etapa_desde < NOW() - make_interval(days => e.alerta_dias)) AS travados
                FROM crm_negocios n JOIN crm_etapas e ON e.id = n.etapa_id JOIN crm_leads l ON l.id = n.lead_id
                WHERE {onde} GROUP BY n.etapa_id
            """),
            params,
        )
        por_etapa = {str(r.etapa_id): r for r in rows.fetchall()}
        linhas = []
        for etapa in etapas:
            r = por_etapa.get(etapa["id"])
            bruto = round(float(r.total), 2) if r else 0.0
            linhas.append({
                "etapa_id": etapa["id"], "etapa": etapa["nome"], "cor": etapa["cor"], "probabilidade": etapa["probabilidade"],
                "quantidade": int(r.quantidade) if r else 0, "travados": int(r.travados) if r else 0,
                "total": bruto, "esperado": round(bruto * etapa["probabilidade"] / 100, 2),
            })
        return linhas

    async def forecast(self, tenant_id: UUID, corretor_id: Optional[UUID] = None) -> Dict[str, Any]:
        """Receita esperada por etapa: soma de valor × probabilidade dos negócios abertos."""
        linhas = await self._agregado_etapas(tenant_id, "aberto", str(corretor_id) if corretor_id else None, None)
        return {
            "etapas": linhas,
            "total": round(sum(l["total"] for l in linhas), 2),
            "esperado": round(sum(l["esperado"] for l in linhas), 2),
            "quantidade": sum(l["quantidade"] for l in linhas),
        }

    async def negocios_pagina(
        self, tenant_id: UUID, status: Optional[str] = "aberto", corretor: Optional[str] = None, termo: Optional[str] = None,
        etapa_id: Optional[str] = None, ordem: str = "recentes", deslocamento: int = 0, limite: int = 30,
    ) -> Dict[str, Any]:
        onde, params = self._filtro_negocios(tenant_id, status, corretor, termo, etapa_id)
        ordenacao = "n.valor DESC, n.updated_at DESC, n.id" if ordem == "valor" else "n.updated_at DESC, n.id"
        total = (await self._session.execute(
            text(f"SELECT COUNT(*) FROM crm_negocios n JOIN crm_leads l ON l.id = n.lead_id WHERE {onde}"), params,
        )).scalar() or 0
        rows = await self._session.execute(
            text(self._SELECT_NEGOCIO + f" WHERE {onde} ORDER BY {ordenacao} LIMIT :limite OFFSET :desloca"),
            {**params, "limite": max(1, min(limite, 200)), "desloca": max(0, deslocamento)},
        )
        itens = []
        for r in rows.fetchall():
            n = _linha(r)
            n["esperado"] = round(n["valor"] * n["probabilidade"] / 100, 2)
            itens.append(n)
        return {"itens": itens, "total": total}

    async def funil(
        self, tenant_id: UUID, status: Optional[str] = "aberto", corretor: Optional[str] = None, termo: Optional[str] = None,
        ordem: str = "recentes", por_coluna: int = 30,
    ) -> Dict[str, Any]:
        """Quadro do funil: agregados por etapa + a primeira página de cada coluna."""
        etapas = await self._agregado_etapas(tenant_id, status, corretor, termo)
        for etapa in etapas:
            pagina = await self.negocios_pagina(
                tenant_id, status, corretor, termo, etapa["etapa_id"], ordem, 0, por_coluna,
            ) if etapa["quantidade"] else {"itens": [], "total": 0}
            etapa["negocios"] = pagina["itens"]
        return {
            "etapas": etapas,
            "totais": {
                "quantidade": sum(e["quantidade"] for e in etapas), "total": round(sum(e["total"] for e in etapas), 2),
                "esperado": round(sum(e["esperado"] for e in etapas), 2), "travados": sum(e["travados"] for e in etapas),
            },
        }

    async def garantir_negocios(
        self, tenant_id: UUID, lead_ids: Optional[List[str]] = None, codigos_imoview: Optional[List[int]] = None,
    ) -> int:
        """Abre um negócio na primeira etapa para cada cliente que ainda não tem nenhum. Idempotente."""
        etapas = await self.etapas(tenant_id)
        if not etapas:
            return 0
        filtro, params = "", {"tid": str(tenant_id), "eid": etapas[0]["id"], "enome": etapas[0]["nome"]}
        if lead_ids is not None:
            filtro, params["ids"] = "AND l.id = ANY(CAST(:ids AS uuid[]))", [str(i) for i in lead_ids]
        elif codigos_imoview is not None:
            filtro, params["cods"] = "AND l.codigo_imoview = ANY(:cods)", list(codigos_imoview)
        r = await self._session.execute(
            text(f"""
                WITH novos AS (
                    INSERT INTO crm_negocios (tenant_id, corretor_id, lead_id, etapa_id, titulo, valor, automatico, created_at)
                    SELECT l.tenant_id, l.corretor_id, l.id, :eid, LEFT(l.nome, 255), 0, TRUE, l.created_at
                    FROM crm_leads l
                    WHERE l.tenant_id = :tid AND l.status <> 'arquivado' {filtro}
                      AND NOT EXISTS (SELECT 1 FROM crm_negocios n WHERE n.lead_id = l.id)
                    RETURNING id
                )
                INSERT INTO crm_negocio_eventos (tenant_id, negocio_id, tipo, para, autor)
                SELECT :tid, id, 'criado', :enome, 'scheduler' FROM novos
            """),
            params,
        )
        return r.rowcount or 0

    async def ficha_cliente(self, tenant_id: UUID, lead_id: UUID) -> Optional[Dict[str, Any]]:
        """Tudo sobre o cliente: cadastro, Imoview, perfil, negócios, atividades e histórico."""
        row = await self._session.execute(
            text("""SELECT l.*, c.nome AS corretor_nome FROM crm_leads l LEFT JOIN corretores c ON c.id = l.corretor_id
                    WHERE l.id = :id AND l.tenant_id = :tid"""),
            {"id": str(lead_id), "tid": str(tenant_id)},
        )
        r = row.first()
        if not r:
            return None
        ficha = _linha(r)
        ficha["negocios"] = await self._negocios_do_lead(tenant_id, lead_id)
        ficha["atividades"] = [_linha(a) for a in (await self._session.execute(
            text("""SELECT a.id, a.tipo, a.titulo, a.inicio, a.local, a.status, a.imovel_codigo, c.nome AS corretor_nome,
                           (a.status = 'aberta' AND a.inicio IS NOT NULL AND a.inicio < NOW()) AS atrasada
                    FROM crm_atividades a LEFT JOIN corretores c ON c.id = a.corretor_id
                    WHERE a.tenant_id = :tid AND a.lead_id = :lid
                    ORDER BY a.inicio DESC NULLS FIRST LIMIT 30"""),
            {"tid": str(tenant_id), "lid": str(lead_id)},
        )).fetchall()]
        ficha["atendimentos"] = await self._atendimentos_do_lead(tenant_id, r.codigo_imoview)
        ficha["historico"] = [_linha(e) for e in (await self._session.execute(
            text("""SELECT ev.tipo, ev.de, ev.para, ev.autor, ev.created_at, n.titulo
                    FROM crm_negocio_eventos ev JOIN crm_negocios n ON n.id = ev.negocio_id
                    WHERE ev.tenant_id = :tid AND n.lead_id = :lid ORDER BY ev.created_at DESC LIMIT 30"""),
            {"tid": str(tenant_id), "lid": str(lead_id)},
        )).fetchall()]
        return ficha

    async def _atendimentos_do_lead(self, tenant_id: UUID, codigo_imoview: Optional[int]) -> List[Dict[str, Any]]:
        """Atendimentos do cliente no Imoview (o que está em andamento primeiro) com interações, interesses e imóveis."""
        if not codigo_imoview:
            return []
        rows = await self._session.execute(
            text("""
                SELECT * FROM imoview_atendimentos WHERE tenant_id = :tid AND lead_codigo = :cod
                ORDER BY (situacao_tipo = 'em_atendimento') DESC, alterado_em DESC NULLS LAST, codigo DESC LIMIT 10
            """),
            {"tid": str(tenant_id), "cod": codigo_imoview},
        )
        lista = []
        for a in rows.fetchall():
            d = a.detalhes or {}
            lista.append({k: _json(v) for k, v in {
                "codigo": a.codigo, "finalidade": "Venda" if a.finalidade == 2 else "Aluguel", "funil": a.funil,
                "situacao": a.situacao, "situacao_tipo": a.situacao_tipo, "estagio": a.estagio, "fase": a.fase,
                "midia": a.midia, "campanha": a.campanha, "termometro": a.termometro, "unidade": a.unidade,
                "corretor_nome": a.corretor_nome, "mql_nome": a.mql_nome, "qualificado": a.qualificado,
                "entrada_em": a.entrada_em, "primeira_resposta_em": a.primeira_resposta_em,
                "ultima_interacao_em": a.ultima_interacao_em, "previsao_fechamento_em": a.previsao_fechamento_em,
                "fechamento_em": a.fechamento_em,
                "perfil": d.get("perfil") or {}, "carrinho": d.get("carrinho") or [], "visitas": d.get("visitas") or [],
                "propostas": d.get("propostas") or [], "negocios": d.get("negocios") or [], "interacoes": d.get("interacoes") or [],
            }.items()})
        return lista

    async def _negocios_do_lead(self, tenant_id: UUID, lead_id: UUID) -> List[Dict[str, Any]]:
        rows = await self._session.execute(
            text(self._SELECT_NEGOCIO + " WHERE n.tenant_id = :tid AND n.lead_id = :lid ORDER BY n.created_at DESC"),
            {"tid": str(tenant_id), "lid": str(lead_id)},
        )
        lista = []
        for r in rows.fetchall():
            n = _linha(r)
            n["esperado"] = round(n["valor"] * n["probabilidade"] / 100, 2)
            lista.append(n)
        return lista

    # --- Agenda -----------------------------------------------------------

    async def _config_agenda(self, tenant_id: UUID) -> Dict[str, Any]:
        """Tipos personalizados e regras de lembrete da imobiliária (Configurações)."""
        from app.domain.configuracoes.padroes import lembretes_padrao

        row = await self._session.execute(text("SELECT dados FROM tenants WHERE id = :tid"), {"tid": str(tenant_id)})
        dados = (row.scalar() or {}) if row else {}
        regras = dados.get("lembretes")
        return {
            "tipos": [t for t in (dados.get("tipos_atividade") or []) if not t.get("sistema")],
            "regras": regras if isinstance(regras, list) else lembretes_padrao(),
        }

    @staticmethod
    def _lembrete_pelas_regras(regras: List[Dict[str, Any]], tipo: str, inicio: Optional[datetime]) -> int:
        """Maior antecedência das regras ligadas que ainda cabe antes do compromisso (0 = sem lembrete)."""
        from app.domain.configuracoes.padroes import antecedencias_para

        if not inicio:
            return 0
        if inicio.tzinfo is None:
            inicio = inicio.replace(tzinfo=timezone.utc)
        faltam = (inicio - datetime.now(timezone.utc)).total_seconds() / 60
        cabem = [m for m in antecedencias_para(regras, tipo) if m <= faltam]
        return cabem[0] if cabem else 0

    async def agendar(
        self,
        tenant_id: UUID,
        corretor_id: UUID,
        titulo: str,
        tipo: str = "tarefa",
        inicio: Optional[datetime] = None,
        duracao_min: int = 60,
        lead_id: Optional[UUID] = None,
        negocio_id: Optional[UUID] = None,
        local: Optional[str] = None,
        imovel_codigo: Optional[int] = None,
        lembrete_min: Optional[int] = None,
    ) -> Dict[str, Any]:
        config = await self._config_agenda(tenant_id)
        rotulo = ROTULO_TIPO.get(tipo)
        if tipo not in TIPOS_ATIVIDADE:
            personalizado = next((t for t in config["tipos"] if t.get("chave") == tipo), None)
            if not personalizado:
                raise CrmError(f"Tipo de atividade inválido: {tipo}.")
            rotulo = personalizado["nome"]
        titulo = (titulo or "").strip() or rotulo or "Atividade"
        if lembrete_min is None:
            lembrete_min = self._lembrete_pelas_regras(config["regras"], tipo, inicio)
        row = await self._session.execute(
            text("""
                INSERT INTO crm_atividades (
                    tenant_id, corretor_id, lead_id, negocio_id, tipo, titulo,
                    inicio, duracao_min, local, imovel_codigo, lembrete_min
                ) VALUES (
                    :tid, :cid, :lid, :nid, :tipo, :titulo,
                    :inicio, :dur, :local, :imovel, :lembrete
                )
                RETURNING *
            """),
            {
                "tid": str(tenant_id), "cid": str(corretor_id),
                "lid": str(lead_id) if lead_id else None,
                "nid": str(negocio_id) if negocio_id else None,
                "tipo": tipo, "titulo": titulo[:255], "inicio": inicio,
                "dur": max(5, int(duracao_min or 60)), "local": local,
                "imovel": imovel_codigo, "lembrete": max(0, int(lembrete_min)),
            },
        )
        return _linha(row.first())

    async def atualizar_atividade(
        self,
        tenant_id: UUID,
        atividade_id: UUID,
        status: Optional[str] = None,
        inicio: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        if status not in (None, "aberta", "concluida", "cancelada"):
            raise CrmError("Status de atividade inválido.")
        row = await self._session.execute(
            text("""
                UPDATE crm_atividades SET
                    status = COALESCE(:status, status),
                    inicio = COALESCE(:inicio, inicio),
                    -- Remarcar volta a permitir o lembrete.
                    lembrete_enviado_em = CASE WHEN :inicio IS NULL THEN lembrete_enviado_em ELSE NULL END
                WHERE id = :id AND tenant_id = :tid RETURNING *
            """),
            {"status": status, "inicio": inicio, "id": str(atividade_id), "tid": str(tenant_id)},
        )
        r = row.first()
        if not r:
            raise CrmError("Não encontrei essa atividade.")
        return _linha(r)

    async def agenda(
        self,
        tenant_id: UUID,
        corretor_id: Optional[UUID] = None,
        de: Optional[datetime] = None,
        ate: Optional[datetime] = None,
        incluir_atrasadas: bool = True,
        incluir_sem_data: bool = True,
    ) -> List[Dict[str, Any]]:
        """Atividades abertas no período, mais as atrasadas e as sem data."""
        agora = datetime.now(timezone.utc)
        de = de or agora
        ate = ate or (de + timedelta(days=30))
        condicoes = ["(a.inicio >= :de AND a.inicio < :ate)"]
        if incluir_atrasadas:
            condicoes.append("(a.inicio < :agora)")
        if incluir_sem_data:
            condicoes.append("(a.inicio IS NULL)")
        where = ["a.tenant_id = :tid", "a.status = 'aberta'", f"({' OR '.join(condicoes)})"]
        params: Dict[str, Any] = {"tid": str(tenant_id), "de": de, "ate": ate, "agora": agora}
        if corretor_id:
            where.append("a.corretor_id = :cid")
            params["cid"] = str(corretor_id)
        rows = await self._session.execute(
            text(f"""
                SELECT a.*, l.nome AS lead_nome, c.nome AS corretor_nome,
                       (a.inicio IS NOT NULL AND a.inicio < :agora) AS atrasada
                FROM crm_atividades a
                LEFT JOIN crm_leads l ON l.id = a.lead_id
                JOIN corretores c ON c.id = a.corretor_id
                WHERE {' AND '.join(where)}
                ORDER BY a.inicio NULLS FIRST
            """),
            params,
        )
        return [_linha(r) for r in rows.fetchall()]

    # --- Briefing ---------------------------------------------------------

    async def dados_briefing(
        self, tenant_id: UUID, corretor_id: UUID, inicio_dia: datetime, fim_dia: datetime
    ) -> Dict[str, Any]:
        """Agenda do dia, atrasadas, negócios travados e imóveis novos para os leads."""
        agenda = await self.agenda(
            tenant_id, corretor_id, de=inicio_dia, ate=fim_dia,
            incluir_atrasadas=True, incluir_sem_data=False,
        )
        def _antes_de_hoje(atividade: Dict[str, Any]) -> bool:
            return datetime.fromisoformat(atividade["inicio"]) < inicio_dia

        hoje = [a for a in agenda if not _antes_de_hoje(a)]
        atrasadas = [a for a in agenda if _antes_de_hoje(a)]
        travados = [
            n for n in await self.listar_negocios(tenant_id, corretor_id, status="aberto")
            if n["travado"]
        ]
        matches = []
        for lead in await self.listar_leads(tenant_id, corretor_id, limit=100):
            novos = await self.matches_novos(tenant_id, lead, limit=3)
            if novos:
                matches.append({"lead": lead, "imoveis": novos})
            if len(matches) >= 3:
                break
        return {"hoje": hoje, "atrasadas": atrasadas, "travados": travados, "matches": matches}
