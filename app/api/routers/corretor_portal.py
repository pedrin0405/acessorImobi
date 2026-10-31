"""
Portal do Corretor.

Permissões:
- Consulta seus próprios clientes, imóveis e histórico de conversas
- NÃO vê dados de outro corretor
- NÃO vê lista de corretores
- NÃO acessa configuração do tenant
- Recursos fora do escopo retornam 404 (não 403), para não revelar existência
"""
import asyncio
import json
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from types import SimpleNamespace
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.sql import text

from app.api.middleware.auth import require_corretor
from app.domain.imovel.service import ImovelService
from app.domain.cliente.service import ClienteService
from app.domain.conversa.service import ConversaService
from app.domain.atendimento import foto_contato
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


_tarefas_foto: set = set()


def _buscar_fotos_em_segundo_plano(corretor, linhas) -> None:
    """Puxa foto e nome dos contatos sem atrasar a lista; falhas só vão para o log."""
    if not linhas:
        return

    async def rodar():
        for r in linhas:
            await foto_contato.sincronizar(corretor.tenant_id, corretor.corretor_id, r.id)

    tarefa = asyncio.create_task(rodar())
    _tarefas_foto.add(tarefa)
    tarefa.add_done_callback(_tarefas_foto.discard)


@router.get("/atendimentos/{atendimento_id}/foto", summary="Foto de perfil do contato (a do WhatsApp)")
async def foto_do_contato(atendimento_id: UUID, corretor=Depends(require_corretor)):
    from fastapi import Response

    from app.shared.storage import ler_midia

    async with get_session(corretor.tenant_id) as session:
        ref = (await session.execute(
            text("SELECT foto_ref FROM atendimentos WHERE id = :aid AND tenant_id = :tid AND corretor_id = :cid"),
            {"aid": str(atendimento_id), "tid": str(corretor.tenant_id), "cid": str(corretor.corretor_id)})).scalar()
    lido = await ler_midia(ref) if ref else None
    if not lido:
        raise HTTPException(status_code=404, detail="Este contato não tem foto.")
    return Response(content=lido[0], media_type=lido[1], headers={"Cache-Control": "private, max-age=86400"})


@router.post("/atendimentos/{atendimento_id}/foto/atualizar", summary="Busca de novo a foto e o nome do contato no WhatsApp")
async def atualizar_foto_do_contato(atendimento_id: UUID, corretor=Depends(require_corretor)):
    await _atendimento_do_corretor(corretor, atendimento_id)
    resultado = await foto_contato.sincronizar(corretor.tenant_id, corretor.corretor_id, atendimento_id, forcar=True)
    mensagens = {
        "atualizada": "Foto atualizada a partir do WhatsApp.",
        "sem_foto": "O contato não tem foto visível (ou ela está oculta por privacidade).",
        "sem_sessao": "Conecte seu WhatsApp para buscar a foto.",
        "erro": "Não foi possível buscar agora. Tente de novo em instantes.",
        "recente": "A foto foi buscada há pouco.",
    }
    async with get_session(corretor.tenant_id) as session:
        r = (await session.execute(
            text("SELECT COALESCE(l.nome, a.nome_contato) AS nome, a.foto_ref, a.foto_atualizada_em FROM atendimentos a LEFT JOIN crm_leads l ON l.id = a.lead_id WHERE a.id = :aid"),
            {"aid": str(atendimento_id)})).first()
    return {"resultado": resultado, "mensagem": mensagens[resultado], "nome": r.nome, "foto_url": foto_contato.url_da_foto(atendimento_id, r.foto_ref, r.foto_atualizada_em)}


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
                       a.tipo_contato, a.tipo_manual, a.foto_ref, a.foto_atualizada_em, a.foto_tentada_em, um.autor AS ultima_autor, um.tipo AS ultima_tipo,
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
        linhas = rows.fetchall()
    _buscar_fotos_em_segundo_plano(corretor, [r for r in linhas if not r.foto_ref and (not r.foto_tentada_em or datetime.now(timezone.utc) - r.foto_tentada_em > foto_contato.REVISAR_APOS)][:5])
    saida = []
    for r in linhas:
        d = {k: v for k, v in dict(r._mapping).items() if k not in ("foto_ref", "foto_atualizada_em", "foto_tentada_em")}
        saida.append({**d, "telefone_cliente": mask_phone(r.telefone_cliente), "foto_url": foto_contato.url_da_foto(r.id, r.foto_ref, r.foto_atualizada_em)})
    return saida


@router.get("/atendimentos/{atendimento_id}", summary="Análise e mensagens de um atendimento")
async def detalhe_atendimento(atendimento_id: UUID, corretor=Depends(require_corretor)):
    async with get_session(corretor.tenant_id) as session:
        row = await session.execute(
            text("""
                SELECT a.id, COALESCE(l.nome, a.nome_contato) AS nome, a.telefone_cliente, a.lead_id,
                       a.imobiliario, a.tipo_contato, a.tipo_manual, a.foto_ref, a.foto_atualizada_em, a.aguardando_corretor, a.analise, a.analisado_em, a.ultima_mensagem_em
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
        base = {k: v for k, v in dict(at._mapping).items() if k not in ("foto_ref", "foto_atualizada_em")}
        return {**base, "foto_url": foto_contato.url_da_foto(at.id, at.foto_ref, at.foto_atualizada_em), "mensagens": [dict(m._mapping) for m in msgs.fetchall()]}


class TipoContato(BaseModel):
    # None volta ao automático (a IA decide); os demais fixam o tipo escolhido pelo corretor.
    tipo: Optional[Literal["imobiliario", "pessoal", "outro"]] = None


@router.patch("/atendimentos/{atendimento_id}/tipo", summary="Define se o contato é imobiliário, pessoal ou outro (ou volta ao automático)")
async def definir_tipo_do_contato(atendimento_id: UUID, body: TipoContato, corretor=Depends(require_corretor)):
    async with get_session(corretor.tenant_id) as session:
        existe = (await session.execute(
            text("SELECT 1 FROM atendimentos WHERE id = :aid AND tenant_id = :tid AND corretor_id = :cid"),
            {"aid": str(atendimento_id), "tid": str(corretor.tenant_id), "cid": str(corretor.corretor_id)})).first()
        if not existe:
            raise HTTPException(status_code=404, detail="Atendimento não encontrado.")
        if body.tipo is None:
            # Automático: a próxima análise classifica de novo.
            await session.execute(
                text("UPDATE atendimentos SET tipo_contato = NULL, tipo_manual = FALSE, imobiliario = NULL, analisado_em = NULL WHERE id = :aid"),
                {"aid": str(atendimento_id)})
        else:
            await session.execute(
                text("UPDATE atendimentos SET tipo_contato = :t, tipo_manual = TRUE, imobiliario = :imob WHERE id = :aid"),
                {"t": body.tipo, "imob": body.tipo == "imobiliario", "aid": str(atendimento_id)})
    return {"tipo_contato": body.tipo, "tipo_manual": body.tipo is not None, "imobiliario": (body.tipo == "imobiliario") if body.tipo else None}


@router.post("/atendimentos/{atendimento_id}/analisar", summary="Analisa o atendimento agora e devolve o resultado")
async def reanalisar_atendimento(atendimento_id: UUID, corretor=Depends(require_corretor)):
    """Roda a análise na hora (não depende da fila nem do worker) e diz o motivo quando não dá."""
    from app.domain.atendimento.analise import analisar
    from app.integration.llm.gemini import GeminiError

    async with get_session(corretor.tenant_id) as session:
        existe = (await session.execute(
            text("SELECT 1 FROM atendimentos WHERE id = :aid AND corretor_id = :cid"),
            {"aid": str(atendimento_id), "cid": str(corretor.corretor_id)})).first()
        if not existe:
            raise HTTPException(status_code=404, detail="Atendimento não encontrado.")
        cfg = config_assistente((await session.execute(
            text("SELECT assistente_config FROM corretores WHERE id = :cid"), {"cid": str(corretor.corretor_id)})).scalar())
        if not cfg["ativo"]:
            raise HTTPException(status_code=409, detail="O assistente está desligado. Ligue-o em Configurações para analisar suas conversas.")
        try:
            analise = await analisar(session, corretor.tenant_id, corretor.corretor_id, str(atendimento_id), avisar=False, levantar_erro_da_ia=True)
        except GeminiError as e:
            raise HTTPException(status_code=503, detail="A IA não respondeu agora (confira a chave do Gemini no servidor ou tente em instantes).") from e
    if analise is None:
        raise HTTPException(status_code=422, detail="Ainda não há mensagens para analisar neste atendimento.")
    return {"analise": analise}


class PedidoSugestao(BaseModel):
    instrucao: Optional[str] = Field(default=None, max_length=300)


@router.post("/atendimentos/{atendimento_id}/sugerir-resposta", summary="Escreve na hora uma sugestão de mensagem para o cliente")
async def sugerir_resposta_ao_cliente(atendimento_id: UUID, body: PedidoSugestao, corretor=Depends(require_corretor)):
    from app.domain.atendimento.analise import sugerir_resposta
    from app.integration.llm.gemini import GeminiError

    await _atendimento_do_corretor(corretor, atendimento_id)
    async with get_session(corretor.tenant_id) as session:
        try:
            texto = await sugerir_resposta(session, corretor.tenant_id, corretor.corretor_id, str(atendimento_id), body.instrucao)
        except GeminiError as e:
            raise HTTPException(status_code=503, detail="A IA não respondeu agora (confira a chave do Gemini no servidor ou tente em instantes).") from e
    if not texto:
        raise HTTPException(status_code=422, detail="Ainda não há mensagens neste atendimento para sugerir uma resposta.")
    return {"texto": texto}


# --- Envio ao cliente pelo WhatsApp pessoal do corretor ------------------------------------------------

LIMITE_ENVIOS_POR_MINUTO = 20


class EnvioTexto(BaseModel):
    texto: str = Field(min_length=1, max_length=4000)


class EnvioAcao(BaseModel):
    tipo: Literal["imoveis", "book"]
    codigos: List[int] = Field(default_factory=list, max_length=12)
    mensagem: str = Field(default="", max_length=1000)
    modelo_id: Optional[UUID] = None
    titulo: str = Field(default="", max_length=80)


async def _contexto_de_envio(corretor, atendimento_id: UUID):
    """Atendimento do corretor + sessão do WhatsApp pessoal conectada; erros claros para a tela."""
    async with get_session(corretor.tenant_id) as session:
        at = (await session.execute(
            text("SELECT id, telefone_cliente, lead_id FROM atendimentos WHERE id = :aid AND tenant_id = :tid AND corretor_id = :cid"),
            {"aid": str(atendimento_id), "tid": str(corretor.tenant_id), "cid": str(corretor.corretor_id)})).first()
        ws = (await session.execute(
            text("SELECT instance_id, status FROM whatsapp_sessions WHERE corretor_id = :cid AND tipo = 'corretor'"),
            {"cid": str(corretor.corretor_id)})).first()
    if not at:
        raise HTTPException(status_code=404, detail="Atendimento não encontrado.")
    if not ws or ws.status != "connected":
        raise HTTPException(status_code=409, detail="Seu WhatsApp não está conectado. Conecte em Configurações para enviar mensagens.")
    from app.shared.redis import get_redis_pool

    redis = get_redis_pool()
    chave = f"envio_cliente:{corretor.corretor_id}"
    usados = await redis.incr(chave)
    if usados == 1:
        await redis.expire(chave, 60)
    if usados > LIMITE_ENVIOS_POR_MINUTO:
        raise HTTPException(status_code=429, detail="Muitos envios em pouco tempo. Aguarde um minuto (isso protege o seu número).")
    return at, ws


async def _registrar_envio(corretor, atendimento_id: UUID, resposta: dict, tipo: str, conteudo: str, midia: Optional[dict] = None) -> dict:
    """Guarda a mensagem enviada no atendimento; usa o id que o WhatsApp devolveu (o eco do webhook não duplica)."""
    import time as _t
    from uuid import uuid4

    mid = ((resposta or {}).get("key") or {}).get("id") or f"portal_{int(_t.time() * 1000)}_{uuid4().hex[:6]}"
    async with get_session(corretor.tenant_id) as session:
        linha = (await session.execute(
            text("""
                INSERT INTO atendimento_mensagens (tenant_id, atendimento_id, message_id, autor, tipo, conteudo, midia)
                VALUES (:tid, :aid, :mid, 'corretor', :tipo, :conteudo, CAST(:midia AS jsonb))
                ON CONFLICT (tenant_id, message_id) DO NOTHING RETURNING id, created_at
            """),
            {"tid": str(corretor.tenant_id), "aid": str(atendimento_id), "mid": mid, "tipo": tipo, "conteudo": conteudo,
             "midia": json.dumps(midia) if midia else None})).first()
        await session.execute(
            text("UPDATE atendimentos SET ultima_mensagem_em = NOW(), aguardando_corretor = FALSE WHERE id = :aid"),
            {"aid": str(atendimento_id)})
    return {"id": str(linha.id) if linha else mid, "autor": "corretor", "tipo": tipo, "conteudo": conteudo, "transcricao": None,
            "created_at": linha.created_at.isoformat() if linha else None}


@router.post("/atendimentos/{atendimento_id}/enviar", summary="Envia uma mensagem de texto ao cliente pelo seu WhatsApp")
async def enviar_ao_cliente(atendimento_id: UUID, body: EnvioTexto, corretor=Depends(require_corretor)):
    from app.integration.whatsapp.evolution import EvolutionClient

    at, ws = await _contexto_de_envio(corretor, atendimento_id)
    texto = body.texto.strip()
    if not texto:
        raise HTTPException(status_code=422, detail="Escreva a mensagem.")
    try:
        resposta = await EvolutionClient().send_text(instance_id=ws.instance_id, to=at.telefone_cliente, text=texto)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail="O WhatsApp não aceitou a mensagem agora. Tente de novo em instantes.") from e
    return await _registrar_envio(corretor, atendimento_id, resposta, "text", texto)


async def _partes_da_acao(corretor, at, body: EnvioAcao):
    from app.domain.conversa.portal import ConversaPortalService, PortalErro

    async with get_session(corretor.tenant_id) as session:
        servico = ConversaPortalService(session, corretor.tenant_id)
        try:
            partes = await servico.montar_acao(body.tipo, body.codigos, None, body.mensagem, body.modelo_id, body.titulo)
        except PortalErro as e:
            raise HTTPException(status_code=e.status, detail=str(e))
    return partes


@router.post("/atendimentos/{atendimento_id}/acoes-rapidas/previa", summary="O que será enviado ao cliente, sem enviar")
async def previa_ao_cliente(atendimento_id: UUID, body: EnvioAcao, corretor=Depends(require_corretor)):
    at = await _atendimento_do_corretor(corretor, atendimento_id)
    return {"mensagens": await _partes_da_acao(corretor, at, body)}


async def _identidade(corretor):
    async with get_session(corretor.tenant_id) as session:
        nome = (await session.execute(text("SELECT nome FROM corretores WHERE id = :cid"), {"cid": str(corretor.corretor_id)})).scalar()
    return SimpleNamespace(nome=nome, id=corretor.corretor_id)


async def _atendimento_do_corretor(corretor, atendimento_id: UUID):
    async with get_session(corretor.tenant_id) as session:
        at = (await session.execute(
            text("SELECT id, telefone_cliente FROM atendimentos WHERE id = :aid AND tenant_id = :tid AND corretor_id = :cid"),
            {"aid": str(atendimento_id), "tid": str(corretor.tenant_id), "cid": str(corretor.corretor_id)})).first()
    if not at:
        raise HTTPException(status_code=404, detail="Atendimento não encontrado.")
    return at


@router.post("/atendimentos/{atendimento_id}/acoes-rapidas/book-pdf", summary="PDF do book para conferir antes de enviar ao cliente")
async def book_ao_cliente(atendimento_id: UUID, body: EnvioAcao, corretor=Depends(require_corretor)):
    from fastapi import Response

    from app.domain.conversa.portal import ConversaPortalService, PortalErro

    await _atendimento_do_corretor(corretor, atendimento_id)
    async with get_session(corretor.tenant_id) as session:
        try:
            book = await ConversaPortalService(session, corretor.tenant_id).pdf_do_book(
                await _identidade(corretor), body.codigos, body.modelo_id, body.titulo)
        except PortalErro as e:
            raise HTTPException(status_code=e.status, detail=str(e))
    return Response(book["pdf"], media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{book["arquivo"]}"'})


@router.post("/atendimentos/{atendimento_id}/acoes-rapidas/enviar", summary="Envia imóveis (cartões) ou um book em PDF ao cliente")
async def enviar_acao_ao_cliente(atendimento_id: UUID, body: EnvioAcao, corretor=Depends(require_corretor)):
    import base64

    from app.domain.conversa.portal import ConversaPortalService, PortalErro
    from app.integration.whatsapp.evolution import EvolutionClient

    at, ws = await _contexto_de_envio(corretor, atendimento_id)
    partes = await _partes_da_acao(corretor, at, body)
    cliente, enviadas = EvolutionClient(), []
    for parte in partes:
        try:
            if parte["tipo"] == "document":
                async with get_session(corretor.tenant_id) as session:
                    book = await ConversaPortalService(session, corretor.tenant_id).pdf_do_book(
                        await _identidade(corretor), parte["codigos"], body.modelo_id, body.titulo)
                resposta = await cliente.send_media(
                    instance_id=ws.instance_id, to=at.telefone_cliente, media_url=base64.b64encode(book["pdf"]).decode(),
                    caption=f"Book de imóveis · {parte['cartao']['titulo']}", mediatype="document", mimetype="application/pdf", file_name=book["arquivo"])
                enviadas.append(await _registrar_envio(corretor, atendimento_id, resposta, "document", f"Book com {len(parte['codigos'])} imóveis · {book['arquivo']}"))
            elif parte.get("foto_url"):
                try:
                    resposta = await cliente.send_media(instance_id=ws.instance_id, to=at.telefone_cliente, media_url=parte["foto_url"],
                                                        caption=parte["texto"][:1000], file_name=f"imovel-{parte.get('codigo', 'foto')}.jpg")
                    enviadas.append(await _registrar_envio(corretor, atendimento_id, resposta, "image", parte["texto"]))
                except Exception:  # noqa: BLE001 - sem a foto, vai o texto
                    resposta = await cliente.send_text(instance_id=ws.instance_id, to=at.telefone_cliente, text=parte["texto"])
                    enviadas.append(await _registrar_envio(corretor, atendimento_id, resposta, "text", parte["texto"]))
            else:
                resposta = await cliente.send_text(instance_id=ws.instance_id, to=at.telefone_cliente, text=parte["texto"])
                enviadas.append(await _registrar_envio(corretor, atendimento_id, resposta, "text", parte["texto"]))
        except PortalErro as e:
            raise HTTPException(status_code=e.status, detail=str(e))
        except HTTPException:
            raise
        except Exception:  # noqa: BLE001
            break
    if not enviadas:
        raise HTTPException(status_code=502, detail="O WhatsApp não aceitou o envio agora. Tente de novo em instantes.")
    return {"mensagens": enviadas, "falhas": len(partes) - len(enviadas)}
