"""
Portal do Corretor.

Permissões:
- Consulta seus próprios clientes, imóveis e histórico de conversas
- NÃO vê dados de outro corretor
- NÃO vê lista de corretores
- NÃO acessa configuração do tenant
- Recursos fora do escopo retornam 404 (não 403), para não revelar existência
"""
import json
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.sql import text

from app.api.middleware.auth import require_corretor
from app.domain.imovel.service import ImovelService
from app.domain.cliente.service import ClienteService
from app.domain.conversa.service import ConversaService
from app.domain.atendimento.ingestao import agendar_analise
from app.domain.whatsapp.corretor import CorretorWhatsAppService, config_assistente
from app.domain.whatsapp.service import WhatsAppIntegrationError
from app.shared.database import get_session
from app.shared.security import mask_phone

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
    foto_url: Optional[str] = None
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
            tenant_id=corretor.tenant_id,
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
            tenant_id=corretor.tenant_id,
            limit=limit,
        )


# --- Assistente pessoal: WhatsApp do corretor e atendimentos ---------------
# O corretor conecta o próprio número para o assistente ler os atendimentos
# com clientes. Só o próprio corretor vê essas conversas (nem a imobiliária).

class AssistenteConfig(BaseModel):
    ativo: bool
    avisos: bool
    carteira_auto: bool


async def _whatsapp_service(session, corretor):
    row = await session.execute(
        text("SELECT telefone FROM corretores WHERE id = :cid"), {"cid": str(corretor.corretor_id)}
    )
    return CorretorWhatsAppService(session, corretor.tenant_id, corretor.corretor_id, row.scalar())


@router.get("/whatsapp", summary="Status do WhatsApp pessoal conectado ao assistente")
async def whatsapp_status(corretor=Depends(require_corretor)):
    async with get_session(corretor.tenant_id) as session:
        return await (await _whatsapp_service(session, corretor)).status()


@router.post("/whatsapp/conectar", summary="Gera QR code e código de pareamento do WhatsApp pessoal")
async def whatsapp_conectar(corretor=Depends(require_corretor)):
    async with get_session(corretor.tenant_id) as session:
        try:
            return await (await _whatsapp_service(session, corretor)).conectar()
        except WhatsAppIntegrationError as e:
            raise HTTPException(status_code=503, detail=str(e))


@router.post("/whatsapp/desconectar", summary="Desconecta o WhatsApp pessoal (o assistente para de ler)")
async def whatsapp_desconectar(corretor=Depends(require_corretor)):
    async with get_session(corretor.tenant_id) as session:
        try:
            return await (await _whatsapp_service(session, corretor)).desconectar()
        except WhatsAppIntegrationError as e:
            raise HTTPException(status_code=404, detail=str(e))


@router.get("/assistente", response_model=AssistenteConfig, summary="Preferências do assistente")
async def assistente_config(corretor=Depends(require_corretor)):
    async with get_session(corretor.tenant_id) as session:
        row = await session.execute(
            text("SELECT assistente_config FROM corretores WHERE id = :cid"), {"cid": str(corretor.corretor_id)}
        )
        return config_assistente(row.scalar())


@router.put("/assistente", response_model=AssistenteConfig, summary="Atualiza as preferências do assistente")
async def atualizar_assistente(body: AssistenteConfig, corretor=Depends(require_corretor)):
    async with get_session(corretor.tenant_id) as session:
        antes = config_assistente((await session.execute(
            text("SELECT assistente_config FROM corretores WHERE id = :cid"), {"cid": str(corretor.corretor_id)})).scalar())
        if body.ativo and not antes["ativo"]:
            # Ao religar, as conversas dos últimos dias são lidas de novo (enquanto desligado nada foi guardado).
            await session.execute(
                text("UPDATE whatsapp_sessions SET historico_importado_ate = NULL WHERE corretor_id = :cid AND tipo = 'corretor'"),
                {"cid": str(corretor.corretor_id)})
        await session.execute(
            text("UPDATE corretores SET assistente_config = CAST(:cfg AS jsonb) WHERE id = :cid"),
            {"cfg": json.dumps(body.model_dump()), "cid": str(corretor.corretor_id)},
        )
    return body


@router.get("/atendimentos/diagnostico", summary="Por que a lista de atendimentos está vazia: WhatsApp, assistente e última leitura")
async def diagnostico_atendimentos(corretor=Depends(require_corretor)):
    async with get_session(corretor.tenant_id) as session:
        cfg = config_assistente((await session.execute(
            text("SELECT assistente_config FROM corretores WHERE id = :cid"), {"cid": str(corretor.corretor_id)})).scalar())
        ws = (await session.execute(
            text("SELECT status, numero, last_seen, historico_importado_ate FROM whatsapp_sessions WHERE corretor_id = :cid AND tipo = 'corretor'"),
            {"cid": str(corretor.corretor_id)})).first()
        total = (await session.execute(
            text("SELECT COUNT(*) FROM atendimentos WHERE corretor_id = :cid"), {"cid": str(corretor.corretor_id)})).scalar() or 0
    iso = lambda v: v.isoformat() if v else None  # noqa: E731
    return {
        "whatsapp": ws.status if ws else "disconnected", "numero": ws.numero if ws else None,
        "assistente_ativo": cfg["ativo"], "ultima_leitura_em": iso(ws.historico_importado_ate) if ws else None,
        "atendimentos": int(total), "dias_lidos": 3,
    }


@router.post("/atendimentos/sincronizar", summary="Lê agora as conversas recentes do WhatsApp pessoal")
async def sincronizar_atendimentos(corretor=Depends(require_corretor)):
    from datetime import datetime, timedelta, timezone

    from app.domain.atendimento.historico import DIAS_HISTORICO, importar_historico

    async with get_session(corretor.tenant_id) as session:
        cfg = config_assistente((await session.execute(
            text("SELECT assistente_config FROM corretores WHERE id = :cid"), {"cid": str(corretor.corretor_id)})).scalar())
        ws = (await session.execute(
            text("SELECT instance_id, status FROM whatsapp_sessions WHERE corretor_id = :cid AND tipo = 'corretor'"),
            {"cid": str(corretor.corretor_id)})).first()
    if not cfg["ativo"]:
        raise HTTPException(status_code=409, detail="O assistente está desligado. Ligue-o em Configurações para ele ler suas conversas.")
    if not ws or ws.status != "connected":
        raise HTTPException(status_code=409, detail="Seu WhatsApp não está conectado.")
    inicio = datetime.now(timezone.utc)
    try:
        importadas = await importar_historico(corretor.tenant_id, corretor.corretor_id, ws.instance_id, inicio - timedelta(days=DIAS_HISTORICO))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail="Não consegui falar com o WhatsApp agora. Tente de novo em instantes.") from e
    async with get_session(corretor.tenant_id) as session:
        await session.execute(
            text("UPDATE whatsapp_sessions SET historico_importado_ate = :ate WHERE corretor_id = :cid AND tipo = 'corretor'"),
            {"ate": inicio, "cid": str(corretor.corretor_id)})
    return {"importadas": importadas}


@router.get("/atendimentos", summary="Atendimentos recentes observados no WhatsApp pessoal")
async def listar_atendimentos(
    dias: int = Query(30, ge=1, le=180),
    todos: bool = Query(False, description="Inclui conversas não imobiliárias"),
    corretor=Depends(require_corretor),
):
    async with get_session(corretor.tenant_id) as session:
        rows = await session.execute(
            text(f"""
                SELECT a.id, COALESCE(l.nome, a.nome_contato) AS nome, a.telefone_cliente,
                       a.lead_id, a.imobiliario, a.aguardando_corretor, a.ultima_mensagem_em,
                       a.ultima_do_cliente_em, a.analisado_em,
                       a.analise->>'resumo' AS resumo, a.analise->>'temperatura' AS temperatura,
                       um.autor AS ultima_autor, um.tipo AS ultima_tipo,
                       COALESCE(NULLIF(um.transcricao, ''), um.conteudo) AS ultima_texto,
                       (SELECT COUNT(*) FROM atendimento_mensagens m WHERE m.atendimento_id = a.id AND m.autor = 'cliente'
                          AND m.created_at > COALESCE((SELECT MAX(c.created_at) FROM atendimento_mensagens c WHERE c.atendimento_id = a.id AND c.autor = 'corretor'), 'epoch'::timestamptz)) AS nao_respondidas
                FROM atendimentos a
                LEFT JOIN crm_leads l ON l.id = a.lead_id
                LEFT JOIN LATERAL (SELECT autor, tipo, conteudo, transcricao FROM atendimento_mensagens m WHERE m.atendimento_id = a.id
                                   ORDER BY m.created_at DESC LIMIT 1) um ON TRUE
                WHERE a.tenant_id = :tid AND a.corretor_id = :cid
                  AND a.ultima_mensagem_em > NOW() - make_interval(days => :dias)
                  {'' if todos else 'AND a.imobiliario IS NOT FALSE'}
                ORDER BY a.aguardando_corretor DESC, a.ultima_mensagem_em DESC
                LIMIT 200
            """),
            {"tid": str(corretor.tenant_id), "cid": str(corretor.corretor_id), "dias": dias},
        )
        return [
            {**dict(r._mapping), "telefone_cliente": mask_phone(r.telefone_cliente)}
            for r in rows.fetchall()
        ]


@router.get("/atendimentos/{atendimento_id}", summary="Análise e mensagens de um atendimento")
async def detalhe_atendimento(atendimento_id: UUID, corretor=Depends(require_corretor)):
    async with get_session(corretor.tenant_id) as session:
        row = await session.execute(
            text("""
                SELECT a.id, COALESCE(l.nome, a.nome_contato) AS nome, a.telefone_cliente, a.lead_id,
                       a.imobiliario, a.aguardando_corretor, a.analise, a.analisado_em, a.ultima_mensagem_em
                FROM atendimentos a
                LEFT JOIN crm_leads l ON l.id = a.lead_id
                WHERE a.id = :aid AND a.tenant_id = :tid AND a.corretor_id = :cid
            """),
            {"aid": str(atendimento_id), "tid": str(corretor.tenant_id), "cid": str(corretor.corretor_id)},
        )
        at = row.first()
        if not at:
            raise HTTPException(status_code=404, detail="Atendimento não encontrado.")
        msgs = await session.execute(
            text("""
                SELECT id, autor, tipo, conteudo, transcricao, created_at FROM (
                    SELECT * FROM atendimento_mensagens WHERE atendimento_id = :aid
                    ORDER BY created_at DESC LIMIT 200
                ) m ORDER BY created_at
            """),
            {"aid": str(atendimento_id)},
        )
        return {**dict(at._mapping), "mensagens": [dict(m._mapping) for m in msgs.fetchall()]}


@router.post(
    "/atendimentos/{atendimento_id}/analisar",
    status_code=202,
    summary="Pede uma nova análise do atendimento (em segundos)",
)
async def reanalisar_atendimento(atendimento_id: UUID, corretor=Depends(require_corretor)):
    async with get_session(corretor.tenant_id) as session:
        row = await session.execute(
            text("SELECT 1 FROM atendimentos WHERE id = :aid AND corretor_id = :cid"),
            {"aid": str(atendimento_id), "cid": str(corretor.corretor_id)},
        )
        if not row.first():
            raise HTTPException(status_code=404, detail="Atendimento não encontrado.")
        # Força nova análise mesmo sem mensagem nova.
        await session.execute(
            text("UPDATE atendimentos SET analisado_em = NULL WHERE id = :aid"), {"aid": str(atendimento_id)}
        )
    await agendar_analise(corretor.tenant_id, corretor.corretor_id, str(atendimento_id), 0)
    return {"status": "agendada"}
