"""
Portal da Imobiliária — administradores do tenant.

Permissões:
- Aprova e desativa corretores
- Configura persona e vocabulário do agente
- Consulta uso, auditoria e pendências de integração
- NÃO acessa conteúdo de conversa por padrão (se acessar, fica registrado)
"""
import asyncio
import re
from typing import Any, Dict, List, Optional
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, field_validator
from sqlalchemy import text

from app.api.middleware.auth import require_admin
from app.domain.corretor import foto as foto_corretor
from app.domain.corretor.service import CorretorService
from app.domain.auditoria.service import AuditoriaService
from app.domain.conversa.portal import ConversaPortalService
from app.domain.conversa.service import ConversaService
from app.domain.tenant.service import TenantService
from app.integration.tts.vozes import VOZ_PADRAO, listar_vozes, resolver_voz, voz_valida
from app.domain.whatsapp.service import WhatsAppService, WhatsAppIntegrationError
from app.integration.llm.tom import MAX_MEMORIA, MAX_MEMORIAS, MAX_NOTA_MARCA, TONS
from app.shared.database import get_session
from app.shared.storage import PREFIXO_S3, ler_midia
from app.shared.security import mask_phone

router = APIRouter()
log = structlog.get_logger()


class AprovarCorretorRequest(BaseModel):
    aprovado: bool
    motivo: Optional[str] = None  # obrigatório em caso de recusa


class CorretorResponse(BaseModel):
    id: UUID
    nome: Optional[str]
    email: Optional[str]
    telefone_mascarado: str
    status: str
    created_at: str
    foto_url: Optional[str] = None


class ConfigurarAgenteRequest(BaseModel):
    persona: str
    vocabulario_bairros: Optional[List[str]] = None
    vocabulario_tipos: Optional[List[str]] = None
    horario_inicio: Optional[str] = None
    horario_fim: Optional[str] = None
    tom: Optional[str] = None
    especialidades: Optional[List[str]] = None
    publico_alvo: Optional[str] = None
    palavras_proibidas: Optional[List[str]] = None
    nota_marca: Optional[str] = None
    memorias: Optional[List[str]] = None
    confirmar_acoes: Optional[bool] = None
    voz: Optional[str] = None
    # Frequência do áudio: 'nunca', 'aleatorio' (chance %), 'a_cada' (N respostas de texto) ou 'sempre'.
    audio_frequencia: Optional[str] = None
    audio_chance: Optional[int] = None
    audio_a_cada: Optional[int] = None
    audio_responder_audio: Optional[bool] = None

    @field_validator("tom")
    @classmethod
    def tom_valido(cls, v: Optional[str]) -> Optional[str]:
        if v and v not in TONS:
            raise ValueError(f"Tom inválido. Opções: {', '.join(TONS)}.")
        return v or None

    @field_validator("audio_frequencia")
    @classmethod
    def frequencia_valida(cls, v: Optional[str]) -> Optional[str]:
        if v and v not in ("nunca", "aleatorio", "a_cada", "sempre"):
            raise ValueError("Frequência de áudio inválida.")
        return v or None

    @field_validator("audio_chance")
    @classmethod
    def chance_valida(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not 0 <= v <= 100:
            raise ValueError("A chance de áudio deve ficar entre 0 e 100.")
        return v

    @field_validator("audio_a_cada")
    @classmethod
    def a_cada_valido(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not 2 <= v <= 20:
            raise ValueError("O intervalo de áudio deve ficar entre 2 e 20 respostas.")
        return v

    @field_validator("voz")
    @classmethod
    def voz_existente(cls, v: Optional[str]) -> Optional[str]:
        if v and not voz_valida(v):
            raise ValueError("Voz inválida. Escolha uma das vozes do catálogo.")
        return v or None

    @field_validator("nota_marca")
    @classmethod
    def nota_curta(cls, v: Optional[str]) -> Optional[str]:
        v = (v or "").strip()
        if len(v) > MAX_NOTA_MARCA:
            raise ValueError(f"A nota de marca deve ter no máximo {MAX_NOTA_MARCA} caracteres.")
        return v

    @field_validator("memorias")
    @classmethod
    def memorias_validas(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        itens = [m.strip() for m in (v or []) if m and m.strip()]
        if len(itens) > MAX_MEMORIAS:
            raise ValueError(f"No máximo {MAX_MEMORIAS} memórias.")
        if any(len(m) > MAX_MEMORIA for m in itens):
            raise ValueError(f"Cada memória deve ter no máximo {MAX_MEMORIA} caracteres.")
        return itens

    @field_validator("especialidades", "palavras_proibidas", "vocabulario_bairros", "vocabulario_tipos")
    @classmethod
    def lista_limpa(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        return list(dict.fromkeys(i.strip() for i in (v or []) if i and i.strip()))

    @field_validator("persona")
    @classmethod
    def persona_preenchida(cls, v: str) -> str:
        # Evita apagar a persona por engano (ex.: formulário salvo antes de carregar).
        v = (v or "").strip()
        if not v:
            raise ValueError("A persona do agente não pode ficar vazia.")
        if len(v) > 8000:
            raise ValueError("A persona deve ter no máximo 8000 caracteres.")
        return v


class ConfiguracaoAgenteResponse(BaseModel):
    persona: str
    vocabulario_bairros: List[str]
    vocabulario_tipos: List[str]
    tom: Optional[str] = None
    especialidades: List[str] = []
    publico_alvo: str = ""
    palavras_proibidas: List[str] = []
    nota_marca: str = ""
    memorias: List[str] = []
    confirmar_acoes: bool = True
    voz: str = VOZ_PADRAO
    audio_frequencia: str = "aleatorio"
    audio_chance: int = 20
    audio_a_cada: int = 5
    audio_responder_audio: bool = True


class ConectarWhatsAppRequest(BaseModel):
    # Com número, a resposta inclui o código de pareamento além do QR code.
    numero: Optional[str] = None


class CriarCorretorRequest(BaseModel):
    nome: str
    telefone: str
    email: Optional[str] = None


class ConversaResumoResponse(BaseModel):
    corretor_id: UUID
    corretor_nome: Optional[str]
    telefone_mascarado: str
    corretor_status: str
    ultima_mensagem: Optional[str]
    ultima_direcao: str
    ultimo_tipo: str
    ultima_em: Optional[str]
    nao_respondidas: int


class MensagemResponse(BaseModel):
    id: UUID
    direcao: str
    tipo: str
    conteudo: Optional[str]
    status: str
    created_at: Optional[str]
    # URL da foto (http...) ou rota autenticada do áudio (/admin/...); None sem mídia.
    midia: Optional[str] = None
    # Quem escreveu: 'bot' (agente), 'humano' (equipe pelo portal), 'nota' (nota interna) ou None (corretor).
    origem: Optional[str] = None
    autor: Optional[str] = None
    # Como a IA respondeu (etapas e tempos), só nas respostas do agente.
    processo: Optional[Dict[str, Any]] = None
    # Ficha enviada pela equipe como ação rápida (hoje: {"tipo": "lead", "lead": {...}}).
    cartao: Optional[Dict[str, Any]] = None


class ConversaDetalheResponse(BaseModel):
    corretor_id: UUID
    corretor_nome: Optional[str]
    telefone_mascarado: str
    mensagens: List[MensagemResponse]


# --- Endpoints ---

def _corretor_response(c, tenant_id: UUID) -> CorretorResponse:
    return CorretorResponse(
        id=c.id,
        nome=c.nome,
        email=c.email,
        telefone_mascarado=mask_phone(c.telefone),
        status=c.status,
        created_at=c.created_at.isoformat(),
        foto_url=foto_corretor.url_da_foto(c.id, c.foto_ref, c.foto_atualizada_em),
    )


def _buscar_foto_em_segundo_plano(tenant_id: UUID, corretor_id: UUID) -> None:
    """Puxa a foto do WhatsApp sem atrasar a resposta; falhas ficam só no log."""
    tarefa = asyncio.create_task(foto_corretor.sincronizar_foto(tenant_id, corretor_id))
    _tarefas_foto.add(tarefa)
    tarefa.add_done_callback(_tarefas_foto.discard)


_tarefas_foto: set = set()


@router.post(
    "/corretores",
    response_model=CorretorResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Cadastra um corretor manualmente na imobiliária",
)
async def criar_corretor(
    body: CriarCorretorRequest,
    admin=Depends(require_admin),
):
    """
    Cadastro direto pelo administrador. O corretor já é criado ativo.
    Se o telefone já existir como pendente/recusado, é promovido a ativo.
    """
    import re
    from app.shared.phone import normalize_phone

    nome = body.nome.strip()
    if len(nome) < 2:
        raise HTTPException(status_code=422, detail="Informe o nome completo do corretor.")

    try:
        normalize_phone(body.telefone)
    except ValueError:
        raise HTTPException(status_code=422, detail="Telefone inválido. Use DDD + número.")

    if body.email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", body.email.strip()):
        raise HTTPException(status_code=422, detail="E-mail inválido.")

    async with get_session(admin.tenant_id) as session:
        service = CorretorService(session)
        try:
            corretor = await service.criar(
                tenant_id=admin.tenant_id,
                nome=nome,
                telefone=body.telefone,
                email=body.email,
                admin_id=admin.admin_id,
            )
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))

        await AuditoriaService(session).registrar(
            tenant_id=admin.tenant_id,
            corretor_id=None,
            acao="criar_corretor",
            entidade="corretor",
            entidade_id=str(corretor.id),
            payload_depois={"nome": corretor.nome, "email": corretor.email, "status": corretor.status},
            origem="portal",
        )

    log.info(
        "corretor_cadastrado_portal",
        tenant_id=str(admin.tenant_id)[:8],
        corretor_id=str(corretor.id),
        admin=admin.sub,
    )
    _buscar_foto_em_segundo_plano(admin.tenant_id, corretor.id)
    return _corretor_response(corretor, admin.tenant_id)


@router.get(
    "/corretores",
    response_model=List[CorretorResponse],
    summary="Lista corretores do tenant",
)
async def listar_corretores(
    status_filter: Optional[str] = None,
    admin=Depends(require_admin),
):
    async with get_session(admin.tenant_id) as session:
        service = CorretorService(session)
        corretores = await service.listar(tenant_id=admin.tenant_id, status=status_filter)

    return [
        _corretor_response(c, admin.tenant_id)
        for c in corretores
    ]


@router.patch(
    "/corretores/{corretor_id}/decisao",
    summary="Aprova ou recusa um corretor",
)
async def decidir_corretor(
    corretor_id: UUID,
    body: AprovarCorretorRequest,
    admin=Depends(require_admin),
):
    if not body.aprovado and not body.motivo:
        raise HTTPException(
            status_code=422,
            detail="Motivo é obrigatório ao recusar um corretor.",
        )

    async with get_session(admin.tenant_id) as session:
        service = CorretorService(session)
        corretor = await service.decidir(
            corretor_id=corretor_id,
            aprovado=body.aprovado,
            motivo=body.motivo,
            admin_id=admin.admin_id,
            tenant_id=admin.tenant_id,
        )

    log.info(
        "corretor_decisao",
        corretor_id=str(corretor_id),
        aprovado=body.aprovado,
        admin=admin.sub,
    )
    if body.aprovado:
        _buscar_foto_em_segundo_plano(admin.tenant_id, corretor_id)
    return {"status": corretor.status}


@router.get("/corretores/{corretor_id}/foto", summary="Foto do corretor (a do perfil do WhatsApp)")
async def foto_do_corretor(corretor_id: UUID, admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as session:
        ref = (await session.execute(
            text("SELECT foto_ref FROM corretores WHERE id = :id AND tenant_id = :tid"),
            {"id": str(corretor_id), "tid": str(admin.tenant_id)},
        )).scalar()
    lido = await ler_midia(ref) if ref else None
    if not lido:
        raise HTTPException(status_code=404, detail="Este corretor não tem foto.")
    dados, tipo = lido
    return Response(content=dados, media_type=tipo, headers={"Cache-Control": "private, max-age=86400"})


@router.post("/corretores/{corretor_id}/foto/atualizar", summary="Busca de novo a foto do WhatsApp do corretor")
async def atualizar_foto_do_corretor(corretor_id: UUID, admin=Depends(require_admin)):
    resultado = await foto_corretor.sincronizar_foto(admin.tenant_id, corretor_id)
    mensagens = {
        "atualizada": "Foto atualizada a partir do WhatsApp.",
        "sem_foto": "O WhatsApp deste número não tem foto visível (ou ela está oculta por privacidade).",
        "manual": "Este corretor tem uma foto escolhida manualmente; ela foi mantida.",
        "sem_sessao": "Conecte o WhatsApp do agente para buscar as fotos.",
        "erro": "Não foi possível buscar a foto agora. Tente de novo em instantes.",
    }
    async with get_session(admin.tenant_id) as session:
        c = (await session.execute(
            text("SELECT id, foto_ref, foto_atualizada_em FROM corretores WHERE id = :id AND tenant_id = :tid"),
            {"id": str(corretor_id), "tid": str(admin.tenant_id)},
        )).first()
    if not c:
        raise HTTPException(status_code=404, detail="Corretor não encontrado.")
    return {"resultado": resultado, "mensagem": mensagens[resultado], "foto_url": foto_corretor.url_da_foto(c.id, c.foto_ref, c.foto_atualizada_em)}


@router.get(
    "/conversas",
    response_model=List[ConversaResumoResponse],
    summary="Lista as conversas do WhatsApp com a última mensagem",
)
async def listar_conversas(admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as session:
        service = ConversaService(session)
        conversas = await service.listar_conversas(admin.tenant_id)

    return [
        ConversaResumoResponse(
            corretor_id=c["corretor_id"],
            corretor_nome=c["corretor_nome"],
            telefone_mascarado=mask_phone(c["telefone"]),
            corretor_status=c["corretor_status"],
            ultima_mensagem=c["ultima_mensagem"],
            ultima_direcao=c["ultima_direcao"],
            ultimo_tipo=c["ultimo_tipo"],
            ultima_em=c["ultima_em"],
            nao_respondidas=c["nao_respondidas"],
        )
        for c in conversas
    ]


_RE_CODIGO_IMOVEL = re.compile(r"C[óo]digo:\s*\*?(\d{3,9})")


async def _fotos_por_codigo(session, tenant_id: UUID, codigos: List[int]) -> Dict[int, str]:
    """Foto de capa dos imóveis (cache do Imoview), para mensagens antigas sem a foto gravada."""
    if not codigos:
        return {}
    rows = await session.execute(
        text("""
            SELECT codigo_imoview, dados_extras->>'foto_url' AS foto
            FROM imoveis_cache
            WHERE tenant_id = :tid AND codigo_imoview = ANY(:codigos)
        """),
        {"tid": str(tenant_id), "codigos": codigos},
    )
    return {r.codigo_imoview: r.foto for r in rows.fetchall() if r.foto}


def _midia_da_mensagem(m: Dict[str, Any], corretor_id: UUID, fotos: Dict[int, str]) -> Optional[str]:
    ref = m.get("midia_url") or ""
    if ref.startswith("http"):
        return ref
    if ref.startswith(PREFIXO_S3):
        return f"/admin/conversas/{corretor_id}/mensagens/{m['id']}/midia"
    if m.get("tipo") == "image":
        achado = _RE_CODIGO_IMOVEL.search(m.get("conteudo") or "")
        if achado:
            return fotos.get(int(achado.group(1)))
    return None


@router.get(
    "/conversas/{corretor_id}/mensagens/{mensagem_id}/midia",
    summary="Arquivo de áudio de uma mensagem (só para o administrador da imobiliária)",
)
async def midia_da_mensagem(
    corretor_id: UUID,
    mensagem_id: UUID,
    admin=Depends(require_admin),
):
    async with get_session(admin.tenant_id) as session:
        row = await session.execute(
            text("""
                SELECT midia_url FROM mensagens
                WHERE id = :id AND corretor_id = :cid AND tenant_id = :tid
            """),
            {"id": str(mensagem_id), "cid": str(corretor_id), "tid": str(admin.tenant_id)},
        )
        r = row.first()
    if not r or not r.midia_url or not r.midia_url.startswith(PREFIXO_S3):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mídia não encontrada.")

    arquivo = await ler_midia(r.midia_url)
    if not arquivo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Arquivo não encontrado.")
    dados, content_type = arquivo
    return Response(
        content=dados,
        media_type=content_type,
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.get(
    "/conversas/{corretor_id}/mensagens",
    response_model=ConversaDetalheResponse,
    summary="Histórico de mensagens de um corretor (visualização estilo WhatsApp)",
)
async def listar_mensagens_conversa(
    corretor_id: UUID,
    limit: int = Query(100, ge=1, le=200),
    admin=Depends(require_admin),
):
    """
    Retorna a conversa em ordem cronológica. O acesso ao conteúdo é
    registrado na auditoria append-only, conforme a política do tenant.
    """
    async with get_session(admin.tenant_id) as session:
        corretor = await CorretorService(session).get_by_id(corretor_id, admin.tenant_id)
        if not corretor:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Corretor não encontrado.")

        mensagens = await ConversaPortalService(session, admin.tenant_id).mensagens(corretor_id, limit=limit)

        codigos = sorted({
            int(a.group(1))
            for m in mensagens
            if m["tipo"] == "image" and not m.get("midia_url")
            for a in [_RE_CODIGO_IMOVEL.search(m.get("conteudo") or "")]
            if a
        })
        fotos = await _fotos_por_codigo(session, admin.tenant_id, codigos)

        await AuditoriaService(session).registrar(
            tenant_id=admin.tenant_id,
            corretor_id=None,
            acao="visualizar_conversa",
            entidade="corretor",
            entidade_id=str(corretor_id),
            origem="portal",
        )

    return ConversaDetalheResponse(
        corretor_id=corretor.id,
        corretor_nome=corretor.nome,
        telefone_mascarado=mask_phone(corretor.telefone),
        mensagens=[
            MensagemResponse(
                **{k: v for k, v in m.items() if k != "midia_url"},
                midia=_midia_da_mensagem(m, corretor_id, fotos),
            )
            for m in mensagens
        ],
    )


@router.get(
    "/agente/configuracao",
    response_model=ConfiguracaoAgenteResponse,
    summary="Consulta persona e vocabulário configurados no agente",
)
async def obter_configuracao_agente(admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as session:
        tenant = await TenantService(session).get_by_id(admin.tenant_id)

    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Imobiliária não encontrada.",
        )

    config = tenant.agent_config or {}
    return ConfiguracaoAgenteResponse(
        persona=config.get("persona", ""),
        vocabulario_bairros=config.get("vocabulario_bairros") or [],
        vocabulario_tipos=config.get("vocabulario_tipos") or [],
        tom=config.get("tom") if config.get("tom") in TONS else None,
        especialidades=config.get("especialidades") or [],
        publico_alvo=config.get("publico_alvo") or "",
        palavras_proibidas=config.get("palavras_proibidas") or [],
        nota_marca=config.get("nota_marca") or "",
        memorias=config.get("memorias") or [],
        confirmar_acoes=config.get("confirmar_acoes", True) is not False,
        voz=resolver_voz(config.get("voz")),
        audio_frequencia=config.get("audio_frequencia") if config.get("audio_frequencia") in ("nunca", "aleatorio", "a_cada", "sempre") else "aleatorio",
        audio_chance=int(config.get("audio_chance", 20)),
        audio_a_cada=int(config.get("audio_a_cada", 5)),
        audio_responder_audio=config.get("audio_responder_audio", True) is not False,
    )


@router.get(
    "/agente/tons",
    summary="Tons de voz disponíveis, com frase de exemplo",
)
async def listar_tons(admin=Depends(require_admin)):
    return [
        {"id": chave, "rotulo": t["rotulo"], "exemplo": t["exemplo"]}
        for chave, t in TONS.items()
    ]


@router.get(
    "/agente/vozes",
    summary="Vozes disponíveis para as respostas em áudio",
)
async def listar_vozes_agente(admin=Depends(require_admin)):
    # As amostras são arquivos estáticos do portal (/vozes/<id>.wav).
    return listar_vozes()


@router.put(
    "/agente/configuracao",
    summary="Configura persona e vocabulário do agente",
)
async def configurar_agente(
    body: ConfigurarAgenteRequest,
    admin=Depends(require_admin),
):
    async with get_session(admin.tenant_id) as session:
        service = TenantService(session)
        await service.atualizar_agent_config(
            tenant_id=admin.tenant_id,
            config={
                "persona": body.persona,
                **body.model_dump(
                    include={
                        "vocabulario_bairros", "vocabulario_tipos", "tom", "especialidades",
                        "publico_alvo", "palavras_proibidas", "nota_marca", "memorias",
                        "confirmar_acoes", "voz", "audio_frequencia", "audio_chance", "audio_a_cada",
                        "audio_responder_audio",
                    },
                    # Campo ausente no request não apaga o que já está salvo.
                    exclude_unset=True,
                ),
            },
        )
    return {"status": "updated"}


@router.get(
    "/auditoria",
    summary="Consulta log de auditoria do tenant",
)
async def consultar_auditoria(
    page: int = 1,
    per_page: int = 50,
    corretor_id: Optional[UUID] = None,
    admin=Depends(require_admin),
):
    async with get_session(admin.tenant_id) as session:
        service = AuditoriaService(session)
        return await service.listar(
            tenant_id=admin.tenant_id,
            page=page,
            per_page=per_page,
            corretor_id=corretor_id,
        )


@router.get(
    "/pendencias",
    summary="Lista pendências de integração com o Imoview",
)
async def listar_pendencias(admin=Depends(require_admin)):
    from app.domain.cliente.service import ClienteService
    async with get_session(admin.tenant_id) as session:
        service = ClienteService(session)
        return await service.listar_pendencias(admin.tenant_id)


# --- WhatsApp do agente ---

@router.get(
    "/whatsapp",
    summary="Status da conexão WhatsApp do agente",
)
async def status_whatsapp(admin=Depends(require_admin)):
    """
    Sincroniza o estado real da instância na Evolution e retorna o status
    para o portal (QR code apenas quando aguardando pareamento).
    """
    async with get_session(admin.tenant_id) as session:
        service = WhatsAppService(session, admin.tenant_id)
        return await service.status()


@router.post(
    "/whatsapp/conectar",
    summary="Inicia a conexão do WhatsApp (QR code e, com número, código de pareamento)",
)
async def conectar_whatsapp(
    body: Optional[ConectarWhatsAppRequest] = None, admin=Depends(require_admin)
):
    async with get_session(admin.tenant_id) as session:
        service = WhatsAppService(session, admin.tenant_id)
        try:
            resultado = await service.conectar(numero=body.numero if body else None)
        except WhatsAppIntegrationError as e:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))

        await AuditoriaService(session).registrar(
            tenant_id=admin.tenant_id,
            corretor_id=None,
            acao="conectar_whatsapp",
            entidade="whatsapp_session",
            entidade_id=resultado.get("instance_id"),
            origem="portal",
        )
    return resultado


@router.post(
    "/whatsapp/desconectar",
    summary="Desconecta o WhatsApp do agente",
)
async def desconectar_whatsapp(admin=Depends(require_admin)):
    async with get_session(admin.tenant_id) as session:
        service = WhatsAppService(session, admin.tenant_id)
        try:
            resultado = await service.desconectar()
        except WhatsAppIntegrationError as e:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))

        await AuditoriaService(session).registrar(
            tenant_id=admin.tenant_id,
            corretor_id=None,
            acao="desconectar_whatsapp",
            entidade="whatsapp_session",
            entidade_id=resultado.get("instance_id"),
            origem="portal",
        )
    return resultado
