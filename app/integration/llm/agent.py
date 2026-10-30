"""
Orquestrador do Agente de IA com suporte a Tool Calling.

Provedor principal configurável por LLM_PROVIDER (gemini ou ollama) e fallback
determinístico para manter o atendimento responsivo mesmo sem IA disponível.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
import random
import re
import time
import unicodedata
from typing import Any, Dict, List, Optional
from uuid import UUID
from zoneinfo import ZoneInfo

import httpx
import structlog
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import text

from app.domain.cliente.service import ClienteService
from app.domain.crm.acoes import executar_acao, resumo_acao
from app.domain.crm.service import CrmService, resumo_perfil
from app.domain.imovel.service import ImovelService
from app.integration.llm.gemini import GeminiClient, GeminiError
from app.integration.llm.tom import TONS, remover_palavras_proibidas
from app.shared.config import get_settings

log = structlog.get_logger()
settings = get_settings()


@dataclass
class PropostaEscrita:
    tipo: str  # 'criar_cliente' | 'atualizar_cliente'
    payload: Dict[str, Any]


@dataclass
class ToolResult:
    texto: str
    proposta_escrita: Optional[PropostaEscrita] = None
    fallback: bool = False
    # Imóveis retornados pela busca, para envio de foto + legenda pelo WhatsApp.
    imoveis: Optional[List[Dict[str, Any]]] = None


_PERFIL_SCHEMA = {
    "type": "object",
    "description": "Perfil de busca do cliente. Preencha só o que o corretor disse.",
    "properties": {
        "interesse": {
            "type": "array", "items": {"type": "string", "enum": ["comprar", "alugar", "vender"]},
        },
        "tipos": {
            "type": "array", "items": {"type": "string"},
            "description": "apartamento, casa, casa em condomínio, studio, loft, cobertura, lote, comercial",
        },
        "bairros": {
            "type": "array", "items": {"type": "string"},
            "description": "Bairros ou regiões citados (ex.: Orla, Plano Diretor Sul, Graciosa).",
        },
        "quartos_min": {"type": "integer"},
        "vagas_min": {"type": "integer"},
        "valor_max": {"type": "number", "description": "Valor máximo em reais."},
        "area_min": {"type": "number", "description": "Área mínima em m²."},
        "prazo": {"type": "string", "enum": ["imediato", "3_meses", "6_meses", "sem_pressa"]},
    },
}

_ETAPAS_DESC = (
    "Etapa do funil: Lead, Contato feito, Qualificado, Visita agendada, "
    "Visita realizada, Proposta ou Negociação."
)

# Ferramentas do CRM do corretor (carteira, funil e agenda no Acessor).
CRM_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "registrar_lead",
            "description": (
                "Anota um cliente/interessado na carteira do corretor com o que ele procura. "
                "Use quando o corretor contar de um cliente novo ('minha cliente Ana quer apê de 2 quartos...')."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "nome": {"type": "string"},
                    "telefone": {"type": "string"},
                    "email": {"type": "string"},
                    "perfil": _PERFIL_SCHEMA,
                    "observacoes": {"type": "string", "description": "Outros detalhes: pet, prazo, quem decide..."},
                    "temperatura": {"type": "string", "enum": ["quente", "morno", "frio"]},
                },
                "required": ["nome"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "atualizar_lead",
            "description": "Atualiza o perfil de busca, a temperatura ou as observações de um cliente da carteira.",
            "parameters": {
                "type": "object",
                "properties": {
                    "cliente": {"type": "string", "description": "Nome do cliente."},
                    "perfil": _PERFIL_SCHEMA,
                    "observacoes": {"type": "string"},
                    "temperatura": {"type": "string", "enum": ["quente", "morno", "frio"]},
                    "status": {"type": "string", "enum": ["lead", "cliente", "arquivado"]},
                },
                "required": ["cliente"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "buscar_leads",
            "description": "Lista os clientes da carteira do corretor (ou busca por nome) com o que cada um procura.",
            "parameters": {
                "type": "object",
                "properties": {"termo": {"type": "string", "description": "Nome ou parte do nome."}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "match_lead",
            "description": "Mostra imóveis da carteira da imobiliária que combinam com o perfil de busca de um cliente.",
            "parameters": {
                "type": "object",
                "properties": {"cliente": {"type": "string", "description": "Nome do cliente."}},
                "required": ["cliente"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "criar_negocio",
            "description": "Abre um negócio no funil para um cliente (cria o cliente se ainda não existir).",
            "parameters": {
                "type": "object",
                "properties": {
                    "cliente": {"type": "string"},
                    "etapa": {"type": "string", "description": _ETAPAS_DESC},
                    "valor": {"type": "number", "description": "Valor do negócio em reais."},
                    "imovel_codigo": {"type": "integer"},
                    "fechamento_previsto": {"type": "string", "description": "AAAA-MM-DD"},
                },
                "required": ["cliente"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mover_negocio",
            "description": (
                "Muda a etapa do negócio de um cliente, ou fecha como ganho/perdido. "
                "Para perdido, peça o motivo antes se o corretor não disse."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "cliente": {"type": "string"},
                    "etapa": {"type": "string", "description": _ETAPAS_DESC},
                    "status": {"type": "string", "enum": ["ganho", "perdido", "aberto"]},
                    "motivo_perda": {"type": "string"},
                    "valor": {"type": "number"},
                },
                "required": ["cliente"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "agendar_atividade",
            "description": (
                "Agenda visita, reunião, ligação, follow-up ou tarefa do corretor. Converta "
                "'amanhã', 'sexta' etc. em data usando a data de hoje do contexto."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "tipo": {
                        "type": "string",
                        "enum": ["visita", "reuniao", "ligacao", "follow_up", "whatsapp", "tarefa", "email", "documento"],
                    },
                    "cliente": {"type": "string"},
                    "data": {"type": "string", "description": "AAAA-MM-DD"},
                    "hora": {"type": "string", "description": "HH:MM (24h)"},
                    "duracao_min": {"type": "integer"},
                    "local": {"type": "string"},
                    "imovel_codigo": {"type": "integer"},
                    "titulo": {"type": "string"},
                },
                "required": ["tipo"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "minha_agenda",
            "description": "Mostra a agenda do corretor: compromissos de hoje e dos próximos dias e os atrasados.",
            "parameters": {
                "type": "object",
                "properties": {"dias": {"type": "integer", "description": "Quantos dias à frente (padrão 7; 1 = só hoje)."}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "meus_negocios",
            "description": "Mostra os negócios abertos do corretor por etapa, os travados e a previsão de receita.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]

# Atendimentos observados no WhatsApp pessoal do corretor (só leitura e sugestão).
ATENDIMENTO_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "meus_atendimentos",
            "description": (
                "Lista os atendimentos recentes do WhatsApp pessoal do corretor com clientes, "
                "indicando quem está esperando resposta."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "resumir_atendimento",
            "description": (
                "Resume e analisa o atendimento do corretor com um cliente no WhatsApp pessoal: "
                "o que o cliente procura, objeções, pendências e próximo passo. Para pedidos de "
                "'o que respondo', use sugerir_resposta."
            ),
            "parameters": {
                "type": "object",
                "properties": {"cliente": {"type": "string", "description": "Nome ou telefone do cliente."}},
                "required": ["cliente"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sugerir_resposta",
            "description": (
                "Escreve uma sugestão de resposta para o corretor copiar e enviar ao cliente. "
                "Use quando o corretor perguntar o que responder, como responder ou pedir um texto "
                "para o cliente. O agente nunca envia nada ao cliente."
            ),
            "parameters": {
                "type": "object",
                "properties": {"cliente": {"type": "string", "description": "Nome ou telefone do cliente."}},
                "required": ["cliente"],
            },
        },
    },
]

_ACOES_CRM = {
    "registrar_lead": "crm_registrar_lead",
    "atualizar_lead": "crm_atualizar_lead",
    "criar_negocio": "crm_criar_negocio",
    "mover_negocio": "crm_mover_negocio",
    "agendar_atividade": "crm_agendar",
}


# Especificação das ferramentas no formato suportado pela API de Chat do Ollama
AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "consultar_imoveis",
            "description": (
                "Busca imóveis disponíveis para aluguel ou venda no cache local. "
                "Use sempre que o corretor pedir opções de imóveis, mesmo em linguagem natural."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "finalidade": {
                        "type": "string",
                        "enum": ["aluguel", "venda"],
                        "description": (
                            "Finalidade desejada. Se o corretor não disser, deduza pelo contexto: "
                            "valores a partir de R$ 50.000 indicam venda; valores menores indicam aluguel."
                        ),
                    },
                    "bairro": {
                        "type": "string",
                        "description": "Bairro ou condomínio citado pelo corretor (ex.: Alphaville).",
                    },
                    "tipo": {"type": "string", "description": "Tipo de imóvel: apartamento, casa, lote, etc."},
                    "quartos": {"type": "integer", "description": "Número mínimo de quartos."},
                    "vagas": {"type": "integer", "description": "Número mínimo de vagas de garagem."},
                    "valor_min": {"type": "number", "description": "Valor mínimo em reais."},
                    "valor_max": {"type": "number", "description": "Valor máximo em reais."},
                    "limite": {
                        "type": "integer",
                        "description": (
                            "Quantidade de opções a retornar. 'de 3 a 5 opções' => 5; "
                            "'me mande 2' => 2. Padrão 5, máximo 10."
                        ),
                    },
                    "codigo": {"type": "integer", "description": "Código específico do imóvel no Imoview."},
                },
                "required": ["finalidade"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "consultar_clientes",
            "description": "Busca clientes cadastrados no CRM por nome, telefone, email ou código.",
            "parameters": {
                "type": "object",
                "properties": {
                    "q": {"type": "string", "description": "Termo de busca (nome, telefone, e-mail ou código)."}
                },
                "required": ["q"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propor_criacao_cliente",
            "description": (
                "Cadastra cliente no IMOVIEW (sistema oficial da imobiliária). Use só quando o "
                "corretor pedir explicitamente para cadastrar no Imoview. Para anotar um cliente "
                "e o que ele procura, use registrar_lead. Sempre requer confirmação."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "nome": {"type": "string", "description": "Nome completo do cliente."},
                    "telefone": {"type": "string", "description": "Telefone com DDD."},
                    "email": {"type": "string", "description": "E-mail de contato."},
                    "finalidade": {"type": "string", "enum": ["1", "2"], "description": "1 para Aluguel, 2 para Venda."},
                    "anotacoes": {"type": "string", "description": "Observações ou interesse do cliente."},
                },
                "required": ["nome"],
            },
        },
    },
] + CRM_TOOLS + ATENDIMENTO_TOOLS + [
    {
        "type": "function",
        "function": {
            "name": "consultar_taxas",
            "description": "Consulta indicadores econômicos e taxas de mercado imobiliário (Selic, IPCA, TR, financiamento).",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
]


_DIAS_SEMANA = (
    "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira",
    "sexta-feira", "sábado", "domingo",
)

# Sem mensagem há mais tempo que isso, a conversa é tratada como nova.
_PAUSA_NOVA_CONVERSA = timedelta(hours=3)


def _conversa_em_andamento(historico: Optional[List[Dict[str, Any]]]) -> bool:
    """True se houve troca de mensagens recente (não cabe cumprimentar de novo)."""
    if not historico:
        return False
    ultima = historico[-1].get("created_at")
    if not ultima:
        return True
    try:
        quando = datetime.fromisoformat(str(ultima))
    except ValueError:
        return True
    if quando.tzinfo is None:
        quando = quando.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - quando < _PAUSA_NOVA_CONVERSA


def _resumo_legenda(legenda: str) -> str:
    """Primeira linha da legenda do imóvel, sem markdown/emojis (ex.: 'Apartamento no bairro X')."""
    linha = (legenda or "").strip().split("\n", 1)[0]
    linha = re.sub(r"[*_~`]", "", linha)
    linha = re.sub(r"[\U0001F000-\U0001FAFF☀-➿]", "", linha)
    return re.sub(r"\s+", " ", linha).strip()[:90]


def _historico_para_contexto(historico: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """
    Converte o histórico do banco em mensagens para a IA.

    Cada imóvel enviado vira uma mensagem de foto com a legenda inteira; com
    o histórico cru, uma única busca ocupava todo o contexto e a IA perdia o
    que o corretor tinha pedido. Aqui as fotos seguidas viram uma linha-resumo,
    áudios que repetem o texto anterior são descartados e o total respeita a
    janela de contexto configurada.
    """
    mensagens: List[Dict[str, str]] = []
    fotos: List[str] = []

    def _fechar_fotos() -> None:
        if not fotos:
            return
        itens = "; ".join(f for f in fotos if f)
        rotulo = "1 foto de imóvel" if len(fotos) == 1 else f"{len(fotos)} fotos de imóveis"
        mensagens.append({
            "role": "assistant",
            "content": f"[Enviei {rotulo} com os detalhes na legenda: {itens}]",
        })
        fotos.clear()

    historico = historico or []
    for i, h in enumerate(historico):
        conteudo = (h.get("conteudo") or "").strip()
        saida = h.get("direcao") != "inbound"
        # Mensagem do corretor seguida de outra dele, sem resposta no meio, é um
        # pedido que falhou. Refazê-lo no turno seguinte agenda/anota o cliente errado.
        if not saida and i + 1 < len(historico) and historico[i + 1].get("direcao") == "inbound":
            continue
        if saida and h.get("tipo") == "image":
            fotos.append(_resumo_legenda(conteudo))
            continue
        _fechar_fotos()
        if not conteudo:
            continue
        papel = "assistant" if saida else "user"
        if saida and mensagens and mensagens[-1]["role"] == "assistant" and mensagens[-1]["content"] == conteudo:
            continue
        mensagens.append({"role": papel, "content": conteudo})
    _fechar_fotos()

    mensagens = mensagens[-settings.context_window_messages:]
    orcamento = settings.context_window_tokens * 4  # ~4 caracteres por token
    while len(mensagens) > 1 and sum(len(m["content"]) for m in mensagens) > orcamento:
        mensagens.pop(0)
    return mensagens


def _normalizar(texto: str) -> str:
    """Remove acentos e converte para minúsculas para comparação de intenções."""
    sem_acento = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode()
    return sem_acento.lower().strip()


# Pedidos de escrita no CRM (anotar cliente, abrir negócio, marcar visita...).
# Só a IA sabe executá-los; as rotas sem IA não podem confundi-los com busca
# de imóveis só porque a frase cita "apartamento" ou "alugar".
_RE_VERBO_CRM = re.compile(
    r"\b(anota\w*|anote\w*|cadastr\w*|cri(?:a|ar|e|em)|registr\w*|adiciona\w*|inclu\w*|"
    r"agend\w*|marc(?:a|ar|e)|atualiz\w*|mov(?:e|er)|fech(?:a|ar))\b"
)
_RE_ALVO_CRM = re.compile(r"\b(lead|leads|lid|lids|carteira|visita|visitas|negocio|negocios|reuniao|ligacao|follow)\b")
_RE_ANOTAR = re.compile(r"\b(anota\w*|anote\w*)\b")


def _pede_escrita_crm(texto_normalizado: str) -> bool:
    if _RE_ANOTAR.search(texto_normalizado):
        return True
    return bool(_RE_VERBO_CRM.search(texto_normalizado) and _RE_ALVO_CRM.search(texto_normalizado))


_ANOTACAO_FOTOS = re.compile(r"\[Enviei [^\]]*\]\s*")


def _limpar_resposta(content: str) -> str:
    texto = (content or "").strip()
    if texto.startswith("```") and texto.endswith("```") and len(texto) > 6:
        texto = texto[3:-3].strip()
        if texto.lower().startswith(("text", "json")):
            texto = texto[4:].strip()
    # O modelo às vezes imita a anotação de fotos do histórico.
    return _ANOTACAO_FOTOS.sub("", texto).strip()


def _resposta_texto_valida(texto: str) -> bool:
    """Rejeita JSON de tool call vazando como texto (comum em modelos pequenos)."""
    if not texto:
        return False
    if '"function"' in texto and '"parameters"' in texto:
        return False
    if texto.startswith("{"):
        try:
            data = json.loads(texto)
        except Exception:
            return True
        if isinstance(data, dict) and {"function", "parameters", "name"} & set(data.keys()):
            return False
    return True


def _parse_numero_br(token: str, tem_escala: bool = False) -> Optional[float]:
    """Converte números em formato brasileiro (1.5 / 1,5 / 2.000.000)."""
    token = (token or "").strip().rstrip(".,")
    if not token:
        return None

    if "," in token:
        # Vírgula é o separador decimal; pontos são milhares.
        normalizado = token.replace(".", "").replace(",", ".")
    elif token.count(".") > 1:
        normalizado = token.replace(".", "")
    elif "." in token:
        inteiro, _, decimal = token.partition(".")
        # "2.000" (milhar) vs. "1.5" (decimal, comum com escala).
        if len(decimal) == 3 and not tem_escala:
            normalizado = inteiro + decimal
        else:
            normalizado = f"{inteiro}.{decimal}"
    else:
        normalizado = token

    try:
        return float(normalizado)
    except ValueError:
        return None


def _formatar_reais(valor: Optional[float]) -> str:
    """Formata 2000000.0 como 'R$ 2.000.000,00'."""
    if valor is None:
        return "valor não informado"
    return f"R$ {valor:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _texto_resultado_imoveis(
    imoveis: List[Dict[str, Any]], finalidade: Optional[str] = None
) -> str:
    """Monta a lista de imóveis com introdução variada, para soar mais humano."""
    total = len(imoveis)
    rotulo = "1 opção" if total == 1 else f"{total} opções"
    para = f" para {finalidade}" if finalidade else ""
    intro = random.choice((
        f"Encontrei {rotulo}{para}:\n\n",
        f"Achei {rotulo}{para}:\n\n",
        f"Olha o que encontrei{para} — {rotulo}:\n\n",
        f"Boa! Separei {rotulo}{para}:\n\n",
    ))
    textos = [im["resumo_texto"] for im in imoveis]
    rodape = random.choice((
        "*Copie e envie ao seu cliente!*",
        "É só copiar e mandar pro seu cliente! 📲",
    ))
    return intro + "\n\n---\n\n".join(textos) + "\n\n" + rodape


def _parse_valor_max(texto: str) -> Optional[float]:
    """Extrai o teto de valor de frases como 'até 2 milhões' ou 'máximo R$ 800 mil'."""
    match = re.search(
        r"(?:ate|maximo|max|por|abaixo de|menos de)\s*r?\$?\s*([\d.,]+)\s*"
        r"(milhoes|milhao|mil|mi)?\b",
        texto,
    )
    if not match:
        return None

    escala = match.group(2)
    valor = _parse_numero_br(match.group(1), tem_escala=bool(escala))
    if valor is None:
        return None

    if escala == "mil":
        valor *= 1_000
    elif escala in ("milhao", "milhoes", "mi"):
        valor *= 1_000_000
    return valor


def _parse_limite(texto: str, default: int = 5) -> int:
    """Extrai a quantidade desejada: 'de 3 a 5 opções' => 5, 'me mande 2' => 2."""
    unidades = (
        r"(?:opc|opcoes|opcao|imoveis|imovel|casas|casa|apartamentos|apartamento|"
        r"aptos|apto|resultados|resultado|opções|opção)"
    )
    faixa = re.search(rf"(\d+)\s*(?:a|ate|-)\s*(\d+)\s*{unidades}", texto)
    if faixa:
        return max(1, min(int(faixa.group(2)), 10))
    unico = re.search(rf"(\d+)\s*{unidades}", texto)
    if unico:
        return max(1, min(int(unico.group(1)), 10))
    return default


class AgentOrchestrator:
    def __init__(self, tenant_id: UUID, corretor, session: AsyncSession):
        self.tenant_id = tenant_id
        self.corretor = corretor
        self._session = session
        self.imovel_service = ImovelService(session)
        self.cliente_service = ClienteService(session)
        self.crm = CrmService(session)
        self._cfg: Dict[str, Any] = {}

    async def _carregar_config_tenant(self) -> Dict[str, Any]:
        res = await self._session.execute(
            text("SELECT agent_config, ollama_model, nome, fuso FROM tenants WHERE id = :tid"),
            {"tid": str(self.tenant_id)},
        )
        row = res.first()
        if not row:
            return {
                "persona": "Você é um assistente imobiliário.",
                "model": settings.ollama_default_model,
                "confirmar_acoes": True,
            }
        config = row.agent_config or {}
        return {
            "nome": row.nome,
            "fuso": row.fuso or settings.usage_timezone,
            "persona": config.get("persona") or f"Você é o assistente virtual da {row.nome}.",
            "vocabulario_bairros": config.get("vocabulario_bairros", []),
            "vocabulario_tipos": config.get("vocabulario_tipos", []),
            "tom": config.get("tom") if config.get("tom") in TONS else None,
            "especialidades": config.get("especialidades") or [],
            "publico_alvo": config.get("publico_alvo") or "",
            "palavras_proibidas": config.get("palavras_proibidas") or [],
            "nota_marca": config.get("nota_marca") or "",
            "memorias": config.get("memorias") or [],
            # Ligado por padrão: o agente só grava no CRM depois do "sim".
            "confirmar_acoes": config.get("confirmar_acoes", True) is not False,
            "model": row.ollama_model or settings.ollama_default_model,
        }

    async def _bairros_conhecidos(self) -> List[str]:
        """Bairros presentes no cache de imóveis do tenant, para reconhecer menções livres."""
        res = await self._session.execute(
            text("""
                SELECT DISTINCT bairro
                FROM imoveis_cache
                WHERE tenant_id = :tid AND bairro IS NOT NULL AND bairro <> ''
            """),
            {"tid": str(self.tenant_id)},
        )
        return [r.bairro for r in res.fetchall()]

    async def _extrair_bairro(self, mensagem: str, cfg: Dict[str, Any]) -> Optional[str]:
        texto = _normalizar(mensagem)
        candidatos = list(cfg.get("vocabulario_bairros") or [])
        candidatos += await self._bairros_conhecidos()

        # 1) Nome completo do bairro presente na mensagem.
        for bairro in sorted(set(candidatos), key=len, reverse=True):
            if bairro and _normalizar(bairro) in texto:
                return bairro

        # 2) Token distintivo: "alphaville" encontra "Condominio Alphaville 1/2".
        genericos = {
            "condominio", "residencial", "jardim", "setor", "quadra", "loteamento",
            "chacara", "fazenda", "bairro", "novo", "nova", "sul", "norte", "leste",
            "oeste", "centro", "parque", "vila", "rua", "avenida", "alameda", "praca",
            "municipal", "zona", "regiao",
        }
        tokens_msg = set(re.findall(r"[a-z]{4,}", texto))
        for bairro in sorted(set(candidatos), key=len, reverse=True):
            tokens_bairro = [
                t for t in re.findall(r"[a-z]{4,}", _normalizar(bairro)) if t not in genericos
            ]
            if tokens_bairro and all(t in tokens_msg for t in tokens_bairro):
                return " ".join(tokens_bairro).title()

        # 3) Fallback: "no Alphaville", "na Savassi", "em Lourdes", "do Centro".
        match = re.search(r"\b(?:no|na|em|do|da|nos|nas)\s+([a-z][a-z\s]{2,40})", texto)
        if match:
            paradas = {
                "de", "do", "da", "dos", "das", "ate", "com", "para", "por", "que",
                "e", "ou", "em", "no", "na", "sem", "valor", "preco", "tipo", "quarto",
                "quartos", "vaga", "vagas", "mil", "milhao", "milhoes", "opcao", "opcoes",
            }
            proibidas = {
                "um", "uma", "uns", "umas", "predio", "casa", "apartamento",
                "imovel", "regiao", "local", "cidade", "bairro", "rua", "avenida",
            }
            palavras = []
            for palavra in match.group(1).split():
                if palavra in paradas or palavra.isdigit():
                    break
                palavras.append(palavra)
            if palavras and len(palavras) <= 3 and not (set(palavras) & proibidas):
                return " ".join(palavras).title()
        return None

    async def _responder_busca_vazia(
        self,
        *,
        finalidade: str,
        bairro: Optional[str] = None,
        tipo: Optional[str] = None,
        quartos: Optional[int] = None,
        vagas: Optional[int] = None,
        valor_max: Optional[float] = None,
    ) -> ToolResult:
        """
        Resposta para busca sem resultados.

        Se o motivo foi o teto de valor, mostra as opções reais mais próximas
        acima do orçamento em vez de apenas dizer que não encontrou nada.
        """
        alvo = tipo or "imóveis"
        if bairro:
            alvo += f" no bairro {bairro}"
        if quartos:
            alvo += f" com {quartos}+ quartos"
        if vagas:
            alvo += f" com {vagas}+ vagas"
        teto = f" até {_formatar_reais(valor_max)}" if valor_max else ""

        alternativas: List[Dict[str, Any]] = []
        if valor_max:
            alternativas = await self.imovel_service.buscar(
                tenant_id=self.tenant_id,
                finalidade=finalidade,
                bairro=bairro,
                tipo=tipo,
                quartos_min=quartos,
                vagas_min=vagas,
                valor_max=None,
                limit=3,
            )

        if alternativas:
            rotulo = "opção mais próxima" if len(alternativas) == 1 else "opções mais próximas"
            textos = [im["resumo_texto"] for im in alternativas]
            return ToolResult(
                texto=(
                    f"Não encontrei {alvo} para {finalidade}{teto}. "
                    f"As {rotulo} (acima desse valor) são:\n\n"
                    + "\n\n---\n\n".join(textos)
                    + "\n\n*Copie e envie ao seu cliente!*"
                ),
                imoveis=alternativas,
            )

        return ToolResult(
            texto=(
                f"Não achei {alvo} para {finalidade}{teto} agora. 🤔 "
                "Quer que eu tente outro bairro, uma faixa de valor diferente ou mais/menos quartos?"
            )
        )

    async def _roteamento_deterministico(
        self,
        mensagem: str,
        cfg: Dict[str, Any],
        incluir_imoveis: bool = True,
        incluir_conversa: bool = True,
        incluir_clientes: bool = True,
    ) -> Optional[ToolResult]:
        """
        Respostas instantâneas para intenções comuns.

        O modelo local roda em CPU e pode levar dezenas de segundos. Rotear o
        que é determinístico mantém o agente responsivo e reserva a IA para
        mensagens realmente ambíguas. Com o Gemini ativo, `incluir_conversa`
        fica False para que saudações e papo casual sejam respondidos pela IA.
        """
        texto = _normalizar(mensagem)

        # "Anota a Ana, quer apê de 2 quartos..." parece busca de imóvel, mas é
        # um pedido para o CRM; sem a IA, nenhuma das buscas abaixo se aplica.
        if _pede_escrita_crm(texto):
            incluir_imoveis = False
            incluir_clientes = False

        # Saudações, testes de conexão e agradecimentos.
        if incluir_conversa and re.fullmatch(
            r"(oi+|ola+|opa|eai|bom dia|boa tarde|boa noite|tudo bem|tudo bom|"
            r"teste|testando|testar|funciona|funcionando|ping|ok|obrigado|obrigada|valeu)"
            r"[\s!.?]*",
            texto,
        ):
            nome = self.corretor.nome.split()[0] if self.corretor.nome else "corretor"
            saudacoes = (
                f"Olá, {nome}! 👋 Tudo certo por aí? Eu sou o Acessor, seu assistente imobiliário. "
                "Posso buscar imóveis, consultar clientes, cadastrar alguém novo no Imoview ou "
                "trazer taxas de mercado. É só pedir!",
                f"Oi, {nome}! 😊 Aqui é o Acessor. Estou no ar e pronto pra te ajudar — "
                "quer buscar imóveis, ver dados de um cliente ou conferir as taxas de hoje?",
                f"E aí, {nome}! 👋 Sou o Acessor, seu parceiro imobiliário digital. "
                "Me diz o que você precisa: imóveis para alugar ou vender, clientes no CRM, "
                "cadastro novo ou indicadores de mercado.",
            )
            return ToolResult(texto=random.choice(saudacoes))

        # Indicadores financeiros.
        if any(k in texto for k in ("taxa", "selic", "ipca", "financiamento", "juros")):
            resultado, _, _ = await self._executar_ferramenta("consultar_taxas", {})
            return ToolResult(texto=resultado)

        # Cadastro de cliente (sempre propõe; nunca grava direto).
        if incluir_clientes and "cadastrar" in texto and ("cliente" in texto or "lead" in texto):
            return ToolResult(
                texto=(
                    "Vamos cadastrar um cliente no Imoview. 📋\n\n"
                    "Me envie os dados nesta ordem: *nome completo*, *telefone com DDD* e "
                    "*e-mail* (se tiver). Depois eu peço sua confirmação antes de gravar."
                )
            )

        # Consulta de clientes.
        if incluir_clientes and ("cliente" in texto or "lead" in texto):
            match = re.search(
                r"(?:cliente|lead)\s+(?:chamad[oa]\s+|de\s+|do\s+|da\s+)?"
                r"([A-Za-zÀ-ÿ]{2,}(?:\s+[A-Za-zÀ-ÿ]{2,}){0,3})",
                mensagem,
                flags=re.IGNORECASE,
            )
            termo = match.group(1).strip() if match else ""
            termos_ignorados = {"novo", "nova", "para", "por", "favor", "meu", "minha"}
            if termo and _normalizar(termo).split()[0] not in termos_ignorados:
                resultado, _, _ = await self._executar_ferramenta(
                    "consultar_clientes", {"q": termo}
                )
                return ToolResult(texto=resultado)
            return ToolResult(
                texto="Claro! Qual é o nome, telefone ou código do cliente que você quer consultar?"
            )

        # Busca de imóveis.
        palavras_imovel = (
            r"\b(?:imovel|imoveis|apartamento|apto|aptos|casa|casas|cobertura|"
            r"terreno|terrenos|lote|lotes|galpao|galpoes|sala|salas|aluguel|"
            r"alugar|locacao|locar|venda|vendas|comprar|compra|quarto|quartos|"
            r"bairro|bairros)\b"
        )
        if incluir_imoveis and re.search(palavras_imovel, texto):
            tipo = None
            for candidato in ("apartamento", "apto", "casa", "cobertura", "terreno", "lote", "galpao", "sala"):
                if candidato in texto:
                    tipo = "apartamento" if candidato == "apto" else candidato
                    break

            match_quartos = re.search(r"(\d+)\s*(?:quarto|quartos|qto|qtos|qt|qts)", texto)
            quartos = int(match_quartos.group(1)) if match_quartos else None

            match_vagas = re.search(r"(\d+)\s*(?:vaga|vagas|garagem|garagens)", texto)
            vagas = int(match_vagas.group(1)) if match_vagas else None

            valor_max = _parse_valor_max(texto)

            finalidade = None
            if re.search(r"\b(?:venda|vendas|vender|vendendo|comprar|compra|comprando)\b", texto):
                finalidade = "venda"
            elif re.search(r"\b(?:aluguel|alugueis|alugar|alugando|aluga|locacao|locar|locando)\b", texto):
                finalidade = "aluguel"
            elif valor_max is not None:
                # Sem finalidade explícita, o valor indica o tipo de operação.
                finalidade = "venda" if valor_max >= 50_000 else "aluguel"

            if not finalidade:
                return ToolResult(
                    texto="Você procura um imóvel para *aluguel* ou para *venda*?"
                )

            limite = _parse_limite(texto, default=settings.imoview_max_results)
            bairro = await self._extrair_bairro(mensagem, cfg)
            imoveis = await self.imovel_service.buscar(
                tenant_id=self.tenant_id,
                finalidade=finalidade,
                bairro=bairro,
                tipo=tipo,
                quartos_min=quartos,
                vagas_min=vagas,
                valor_max=valor_max,
                limit=limite,
            )
            if not imoveis:
                return await self._responder_busca_vazia(
                    finalidade=finalidade,
                    bairro=bairro,
                    tipo=tipo,
                    quartos=quartos,
                    vagas=vagas,
                    valor_max=valor_max,
                )

            textos = [im["resumo_texto"] for im in imoveis]
            return ToolResult(
                texto=_texto_resultado_imoveis(imoveis, finalidade),
                imoveis=imoveis,
            )

        return None

    async def _executar_ferramenta(
        self, tool_name: str, args: Dict[str, Any]
    ) -> (str, Optional[PropostaEscrita], Optional[List[Dict[str, Any]]]):
        """Executa a ferramenta chamada pela IA."""
        if tool_name == "consultar_imoveis":
            finalidade = args.get("finalidade", "aluguel")
            try:
                limite = int(args.get("limite") or settings.imoview_max_results)
            except (TypeError, ValueError):
                limite = settings.imoview_max_results
            limite = max(1, min(limite, 10))
            imoveis = await self.imovel_service.buscar(
                tenant_id=self.tenant_id,
                finalidade=finalidade,
                bairro=args.get("bairro"),
                tipo=args.get("tipo"),
                quartos_min=args.get("quartos"),
                vagas_min=args.get("vagas"),
                valor_min=args.get("valor_min"),
                valor_max=args.get("valor_max"),
                codigo=args.get("codigo"),
                limit=limite,
            )
            if not imoveis:
                vazio = await self._responder_busca_vazia(
                    finalidade=finalidade,
                    bairro=args.get("bairro"),
                    tipo=args.get("tipo"),
                    quartos=args.get("quartos"),
                    vagas=args.get("vagas"),
                    valor_max=args.get("valor_max"),
                )
                return vazio.texto, None, vazio.imoveis

            return _texto_resultado_imoveis(imoveis, finalidade), None, imoveis

        elif tool_name == "consultar_clientes":
            termo = args.get("q", "")
            clientes = await self.cliente_service.buscar(q=termo, tenant_id=self.tenant_id)
            if not clientes:
                return f"Nenhum cliente encontrado para '{termo}'.", None, None

            linhas = []
            for c in clientes[:5]:
                linhas.append(f"👤 *{c['nome']}* | Tel: {c['telefone_mascarado']} | Cód: {c['codigo']}")
            return "Clientes encontrados:\n" + "\n".join(linhas), None, None

        elif tool_name == "propor_criacao_cliente":
            nome = args.get("nome")
            tel = args.get("telefone", "Não informado")
            email = args.get("email", "Não informado")
            texto_proposta = (
                f"📋 *Confirmação de Cadastro de Cliente*\n\n"
                f"• Nome: *{nome}*\n"
                f"• Telefone: *{tel}*\n"
                f"• E-mail: *{email}*\n\n"
                f"Deseja cadastrar este cliente no Imoview? Responda *sim* para confirmar ou *não* para cancelar."
            )
            proposta = PropostaEscrita(tipo="criar_cliente", payload=args)
            return texto_proposta, proposta, None

        elif tool_name == "consultar_taxas":
            hoje = time.strftime("%d/%m/%Y")
            return (
                f"📊 *Indicadores Financeiros* (Referência: {hoje})\n"
                f"• Selic: 10,75% a.a.\n"
                f"• IPCA (12 meses): 4,42%\n"
                f"• TR: 0,11% a.m.\n"
                f"• Taxas Médias Caixa: 9,99% a.a. + TR\n\n"
                f"_Fonte: Banco Central do Brasil. Não constitui recomendação financeira._",
                None,
                None,
            )

        elif tool_name in _ACOES_CRM:
            return await self._acao_crm(_ACOES_CRM[tool_name], args or {})

        elif tool_name == "buscar_leads":
            leads = await self.crm.listar_leads(
                self.tenant_id, self.corretor.id, termo=args.get("termo"), limit=10
            )
            if not leads:
                return "Sua carteira ainda está vazia. Me conta de um cliente e eu anoto.", None, None
            linhas = [
                f"• *{l['nome']}* ({l['temperatura']}) — {resumo_perfil(l['perfil'])}"
                + (f" · {l['negocios_abertos']} negócio(s)" if l["negocios_abertos"] else "")
                for l in leads
            ]
            return "Sua carteira:\n" + "\n".join(linhas), None, None

        elif tool_name == "match_lead":
            lead = await self.crm.encontrar_lead(self.tenant_id, self.corretor.id, args.get("cliente", ""))
            if not lead:
                return f"Não achei *{args.get('cliente', '')}* na sua carteira.", None, None
            if not lead.get("perfil"):
                return (
                    f"*{lead['nome']}* ainda não tem perfil de busca. "
                    "Me diz o que ela procura que eu anoto e já cruzo com a carteira.",
                    None, None,
                )
            imoveis = await self.crm.match(self.tenant_id, lead)
            if not imoveis:
                return (
                    f"Nada na carteira bate hoje com {lead['nome']} ({resumo_perfil(lead['perfil'])}). "
                    "Te aviso no briefing quando entrar algo.",
                    None, None,
                )
            return _texto_resultado_imoveis(imoveis, f"{lead['nome']}"), None, imoveis

        elif tool_name == "minha_agenda":
            return await self._texto_agenda(int(args.get("dias") or 7)), None, None

        elif tool_name == "meus_negocios":
            return await self._texto_negocios(), None, None

        elif tool_name == "meus_atendimentos":
            return await self._texto_atendimentos(), None, None

        elif tool_name in ("resumir_atendimento", "sugerir_resposta"):
            return await self._atendimento(args.get("cliente", ""), tool_name == "sugerir_resposta"), None, None

        return "Ferramenta não suportada.", None, None

    def _fuso(self) -> ZoneInfo:
        return ZoneInfo(self._cfg.get("fuso") or settings.usage_timezone or "America/Sao_Paulo")

    async def _acao_crm(
        self, tipo: str, args: Dict[str, Any]
    ) -> (str, Optional[PropostaEscrita], None):
        """Escrita no CRM: propõe e espera o "sim" (padrão) ou grava na hora."""
        payload = {k: v for k, v in args.items() if v not in (None, "", [], {})}
        for campo in ("imovel_codigo", "duracao_min"):
            if campo in payload:
                try:
                    payload[campo] = int(payload[campo])
                except (TypeError, ValueError):
                    payload.pop(campo)
        if tipo == "crm_agendar":
            payload["fuso"] = str(self._fuso())

        if self._cfg.get("confirmar_acoes", True):
            texto = f"{resumo_acao(tipo, payload)}\n\nConfirma? Responda *sim* ou *não*."
            return texto, PropostaEscrita(tipo=tipo, payload=payload), None

        texto = await executar_acao(self._session, self.tenant_id, self.corretor.id, tipo, payload)
        return texto, None, None

    def _hora_local(self, iso: Optional[str]) -> str:
        if not iso:
            return "sem data"
        quando = datetime.fromisoformat(iso).astimezone(self._fuso())
        return f"{_DIAS_SEMANA[quando.weekday()][:3]} {quando:%d/%m %H:%M}"

    async def _texto_agenda(self, dias: int) -> str:
        fuso = self._fuso()
        hoje = datetime.now(fuso).replace(hour=0, minute=0, second=0, microsecond=0)
        atividades = await self.crm.agenda(
            self.tenant_id, self.corretor.id,
            de=hoje, ate=hoje + timedelta(days=max(1, min(dias, 30))),
        )
        if not atividades:
            return "Agenda livre por aqui. Quer marcar alguma visita?"

        def _linha_atividade(a: Dict[str, Any]) -> str:
            texto = f"• {self._hora_local(a['inicio'])} — {a['titulo']}"
            if a.get("local"):
                texto += f" ({a['local']})"
            return texto

        atrasadas = [a for a in atividades if a["inicio"] and datetime.fromisoformat(a["inicio"]) < hoje]
        sem_data = [a for a in atividades if not a["inicio"]]
        proximas = [a for a in atividades if a not in atrasadas and a not in sem_data]
        blocos = []
        if proximas:
            blocos.append("📅 *Agenda*\n" + "\n".join(_linha_atividade(a) for a in proximas))
        if atrasadas:
            blocos.append("⚠️ *Atrasadas*\n" + "\n".join(_linha_atividade(a) for a in atrasadas))
        if sem_data:
            blocos.append("📝 *Sem data*\n" + "\n".join(f"• {a['titulo']}" for a in sem_data))
        return "\n\n".join(blocos)

    async def _texto_atendimentos(self) -> str:
        rows = await self._session.execute(
            text("""
                SELECT COALESCE(l.nome, a.nome_contato, a.telefone_cliente) AS nome,
                       a.aguardando_corretor, a.ultima_do_cliente_em, a.analise
                FROM atendimentos a
                LEFT JOIN crm_leads l ON l.id = a.lead_id
                WHERE a.tenant_id = :tid AND a.corretor_id = :cid
                  AND a.imobiliario IS NOT FALSE
                  AND a.ultima_mensagem_em > NOW() - INTERVAL '7 days'
                ORDER BY a.aguardando_corretor DESC, a.ultima_mensagem_em DESC
                LIMIT 8
            """),
            {"tid": str(self.tenant_id), "cid": str(self.corretor.id)},
        )
        itens = rows.fetchall()
        if not itens:
            return (
                "Não vi atendimentos no seu WhatsApp nos últimos 7 dias. Se ainda não conectou "
                "seu número, faça isso no Portal do Corretor, em Meu WhatsApp."
            )
        linhas = []
        for r in itens:
            resumo = ((r.analise or {}).get("resumo") or "").split(". ")[0][:120]
            espera = ""
            if r.aguardando_corretor and r.ultima_do_cliente_em:
                minutos = int((datetime.now(timezone.utc) - r.ultima_do_cliente_em).total_seconds() // 60)
                espera = f" ⏳ esperando há {minutos} min" if minutos < 120 else f" ⏳ esperando há {minutos // 60} h"
            linhas.append(f"• *{r.nome}*{espera}" + (f"\n  {resumo}" if resumo else ""))
        return "💬 *Seus atendimentos*\n" + "\n".join(linhas)

    async def _atendimento(self, cliente: str, sugerir: bool) -> str:
        """Resumo ou sugestão de resposta; reanalisa se houve mensagem depois da última análise."""
        from app.domain.atendimento.analise import analisar, texto_resumo

        digitos = "".join(ch for ch in cliente if ch.isdigit())
        row = await self._session.execute(
            text("""
                SELECT a.id, a.analise, a.analisado_em, a.ultima_mensagem_em, a.aguardando_corretor,
                       COALESCE(l.nome, a.nome_contato, a.telefone_cliente) AS nome
                FROM atendimentos a
                LEFT JOIN crm_leads l ON l.id = a.lead_id
                WHERE a.tenant_id = :tid AND a.corretor_id = :cid
                  AND (a.nome_contato ILIKE :termo OR l.nome ILIKE :termo
                       OR (:digitos <> '' AND a.telefone_cliente LIKE :fone))
                ORDER BY a.ultima_mensagem_em DESC LIMIT 1
            """),
            {"tid": str(self.tenant_id), "cid": str(self.corretor.id), "termo": f"%{cliente.strip()}%",
             "digitos": digitos, "fone": f"%{digitos[-8:]}%"},
        )
        at = row.first()
        if not at:
            return f"Não achei atendimento com *{cliente}* no seu WhatsApp pessoal."
        analise = at.analise or {}
        if not at.analisado_em or at.analisado_em < at.ultima_mensagem_em:
            analise = await analisar(
                self._session, self.tenant_id, self.corretor.id, str(at.id), avisar=False
            ) or analise
        if not analise:
            return f"Ainda não consegui analisar a conversa com {at.nome}. Tente de novo em instantes."
        if not sugerir:
            return texto_resumo(at.nome, analise, at.aguardando_corretor)
        if analise.get("sugestao_resposta"):
            return f"💡 Para {at.nome} (é só copiar):\n\n{analise['sugestao_resposta']}"
        passo = analise.get("proximo_passo") or "retomar o contato com uma pergunta objetiva"
        return (
            f"Você foi o último a falar com {at.nome}, então não há pergunta pendente. "
            f"Próximo passo sugerido: {passo}"
        )

    async def _texto_negocios(self) -> str:
        previsao = await self.crm.forecast(self.tenant_id, self.corretor.id)
        if not previsao["quantidade"]:
            return "Você não tem negócios abertos. Quer abrir um para algum cliente?"
        linhas = [
            f"• {e['etapa']}: {e['quantidade']}" + (f" ({e['travados']} parado)" if e["travados"] else "")
            for e in previsao["etapas"] if e["quantidade"]
        ]
        esperado = f"{previsao['esperado']:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
        return (
            f"💼 *{previsao['quantidade']} negócio(s) abertos*\n" + "\n".join(linhas)
            + f"\n\nPrevisão ponderada: *R$ {esperado}*"
        )

    def _montar_system_prompt(
        self,
        tenant_cfg: Dict[str, Any],
        historico: Optional[List[Dict[str, Any]]] = None,
        entrada_audio: bool = False,
        resposta_em_audio: bool = False,
    ) -> str:
        """
        Prompt em camadas: persona do tenant (autoridade), contexto do momento
        e regras de conversa. O contexto (nome, horário, se a conversa já está
        em andamento, canal de voz) é o que evita respostas genéricas.
        """
        primeiro_nome = (getattr(self.corretor, "nome", None) or "").split()
        primeiro_nome = primeiro_nome[0] if primeiro_nome else None
        agora = datetime.now(ZoneInfo(tenant_cfg.get("fuso") or settings.usage_timezone or "America/Sao_Paulo"))
        periodo = "manhã" if 5 <= agora.hour < 12 else "tarde" if agora.hour < 18 else "noite"

        contexto = [
            f"- Agora é {_DIAS_SEMANA[agora.weekday()]}, {agora:%d/%m/%Y} ({agora:%Y-%m-%d}), "
            f"{agora:%H:%M} ({periodo}).",
        ]
        if primeiro_nome:
            contexto.append(
                f"- Você está falando com {primeiro_nome}, corretor(a) da {tenant_cfg.get('nome') or 'imobiliária'}. "
                "Use o nome de vez em quando, não em toda mensagem."
            )
        if _conversa_em_andamento(historico):
            contexto.append(
                "- A conversa já está em andamento: não cumprimente de novo e não se apresente. "
                "Continue de onde parou, considerando o histórico."
            )
        else:
            contexto.append(
                "- É o começo da conversa (ou ela ficou parada por horas): um cumprimento curto "
                "combinando com o horário cai bem, sem se apresentar com textão."
            )
        if entrada_audio:
            contexto.append(
                "- O corretor mandou um ÁUDIO; você recebe a transcrição automática, que pode ter "
                "erros de palavras. Interprete pelo sentido e, se algo essencial ficou confuso, "
                "pergunte só aquilo."
            )
        if resposta_em_audio:
            contexto.append(
                "- Sua resposta vai virar MENSAGEM DE VOZ. Escreva exatamente como falaria: frases "
                "curtas e corridas, sem emojis, sem asteriscos, sem listas, sem links e sem códigos "
                "longos. Pode usar marcas de fala naturais ('olha', 'então', 'beleza', 'show'). "
                "Máximo de 3 frases."
            )

        marca = []
        if tenant_cfg.get("nota_marca"):
            marca.append(f"- Sobre a imobiliária: {tenant_cfg['nota_marca']}")
        tom = TONS.get(tenant_cfg.get("tom") or "")
        if tom:
            marca.append(f"- {tom['instrucao']} Exemplo do tom: \"{tom['exemplo']}\"")
        if tenant_cfg.get("especialidades"):
            marca.append(f"- Especialidades: {', '.join(tenant_cfg['especialidades'])}.")
        if tenant_cfg.get("publico_alvo"):
            marca.append(f"- Público-alvo: {tenant_cfg['publico_alvo']}")
        if tenant_cfg.get("memorias"):
            marca.append("- Fatos que a imobiliária pediu para você lembrar:")
            marca.extend(f"  • {m}" for m in tenant_cfg["memorias"])
        if tenant_cfg.get("palavras_proibidas"):
            marca.append(
                "- Nunca use estas palavras: " + ", ".join(tenant_cfg["palavras_proibidas"]) + "."
            )
        bloco_marca = ("## Marca e tom\n" + "\n".join(marca) + "\n\n") if marca else ""

        return (
            f"{tenant_cfg['persona']}\n\n"
            + bloco_marca
            + "## Contexto deste momento\n"
            + "\n".join(contexto)
            + "\n\n## Como conversar\n"
            "Você é o Acessor e conversa pelo WhatsApp como um colega de verdade, não como um robô "
            "de atendimento. Se algo abaixo conflitar com a persona acima, siga a persona.\n"
            "- Reaja ao que o corretor disse antes de responder (concorde, comente, brinque se ele "
            "brincou), sem fórmula fixa.\n"
            "- Espelhe o tom e o tamanho: mensagem curta pede resposta curta. Em geral 1 a 3 frases.\n"
            "- Nunca liste o que você sabe fazer nem ofereça menu de opções. Nunca termine com "
            "'posso ajudar em algo mais?', 'estou à disposição' ou parecidos.\n"
            "- Não repita aberturas, expressões ou emojis que você já usou nas últimas mensagens "
            "do histórico.\n"
            "- Atenda SOMENTE à última mensagem do corretor. O histórico é contexto: nunca refaça "
            "(agendar, anotar, buscar) algo de mensagens anteriores, a menos que ele peça de novo agora. "
            "Use o cliente citado na última mensagem, não o de conversas antigas.\n"
            "- Se não entendeu, diga o que faltou numa pergunta só, específica.\n"
            "- Emojis: siga a persona; na dúvida, no máximo um, e só quando combinar.\n"
            "- Trechos entre colchetes no histórico, como [Enviei 3 fotos...], são anotações do "
            "sistema sobre o que já foi enviado. Use para entender o contexto, mas nunca escreva "
            "colchetes assim na resposta.\n\n"
            "## Ferramentas e dados\n"
            "Interprete linguagem natural: quantidades ('de 3 a 5 opções' => limite 5), "
            "valores abreviados ('2 milhões' => 2000000, '800 mil' => 800000) e bairros "
            "ou condomínios citados. Se o corretor não informar a finalidade, deduza pelo "
            "valor: a partir de R$ 50.000 é venda; abaixo disso, aluguel. "
            "Quando o corretor pedir imóveis, use SEMPRE a ferramenta consultar_imoveis; "
            "nunca invente imóveis. Quando pedir clientes do Imoview, use consultar_clientes.\n\n"
            "## Carteira, funil e agenda do corretor\n"
            "O Acessor guarda a carteira do corretor. Quando ele contar de um cliente e do que o "
            "cliente procura, use registrar_lead (ou atualizar_lead se o cliente já existe). "
            "Para negócios use criar_negocio e mover_negocio; para compromissos, agendar_atividade; "
            "para consultar, buscar_leads, match_lead, minha_agenda e meus_negocios. "
            "Se o corretor conectou o WhatsApp pessoal, você também lê os atendimentos dele com "
            "clientes: use meus_atendimentos, resumir_atendimento e sugerir_resposta. Você nunca "
            "fala com o cliente; a sugestão é para o corretor copiar. "
            "Só cadastre no Imoview (propor_criacao_cliente) se o corretor pedir o Imoview. "
            "Se faltar algo essencial (nome do cliente, dia de uma visita, motivo de uma perda), "
            "pergunte antes de chamar a ferramenta."
        )

    def _montar_messages(
        self, system_prompt: str, historico: List[Dict[str, Any]], mensagem: str
    ) -> List[Dict[str, str]]:
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(_historico_para_contexto(historico))
        messages.append({"role": "user", "content": mensagem})
        return messages

    def _instrucao_naturalidade(
        self, nome_funcao: str, imoveis: Optional[List[Dict[str, Any]]]
    ) -> str:
        """Instrução da segunda passada: transforma o resultado da ferramenta em fala humana."""
        if nome_funcao in ("consultar_imoveis", "match_lead"):
            if imoveis:
                return (
                    "O resultado acima é a busca de imóveis. Escreva a resposta ao corretor "
                    "como uma pessoa no WhatsApp: comente em 1 ou 2 frases o que encontrou "
                    "(quantidade, bairro/tipo e faixa de valor) e avise que está enviando as "
                    "fotos com os detalhes. Não repita a lista inteira, não invente "
                    "características e não use marcadores. Se houver opções acima do "
                    "orçamento, explique isso com delicadeza."
                )
            return (
                "O resultado acima é uma busca sem imóveis. Responda em 1 ou 2 frases "
                "naturais, sem parecer script, oferecendo uma alternativa concreta "
                "(outro bairro, faixa de valor ou número de quartos). Não invente imóveis."
            )
        if nome_funcao == "consultar_clientes":
            return (
                "O resultado acima é uma consulta de clientes. Apresente o que encontrou "
                "de forma natural e curta, mantendo nomes, telefones mascarados e códigos "
                "exatamente como estão. Não invente dados e não repita o cabeçalho técnico."
            )
        return (
            "Reescreva o resultado acima como uma resposta natural e curta de WhatsApp, "
            "preservando todos os fatos, valores, códigos e nomes."
        )

    async def _processar_gemini(
        self, system_prompt: str, messages: List[Dict[str, str]]
    ) -> ToolResult:
        """Executa o Gemini com tool calling e naturaliza o resultado da ferramenta."""
        cliente = GeminiClient()
        resposta = await cliente.gerar(system_prompt, messages, tools=AGENT_TOOLS)

        chamada = resposta.get("function_call")
        if chamada:
            nome_funcao = chamada["name"]
            argumentos = chamada.get("args") or {}
            parte_chamada = resposta.get("function_call_part")
            texto_ferramenta, proposta, imoveis = await self._executar_ferramenta(
                nome_funcao, argumentos
            )

            # Segunda passada: o resultado bruto da ferramenta vira uma resposta
            # humana. Propostas de escrita e taxas ficam exatamente como estão.
            if not proposta and nome_funcao in ("consultar_imoveis", "consultar_clientes", "match_lead"):
                try:
                    natural = await cliente.gerar_apos_ferramenta(
                        system_prompt=system_prompt,
                        messages=messages,
                        nome_funcao=nome_funcao,
                        argumentos=argumentos,
                        resultado=texto_ferramenta,
                        instrucao=self._instrucao_naturalidade(nome_funcao, imoveis),
                        function_call_part=parte_chamada,
                    )
                    natural = _limpar_resposta(natural or "")
                    if natural and _resposta_texto_valida(natural):
                        texto_ferramenta = natural
                except GeminiError as e:
                    log.warning("gemini_naturalizacao_falhou", error=str(e)[:200])

            return ToolResult(
                texto=texto_ferramenta,
                proposta_escrita=proposta,
                imoveis=imoveis,
            )

        content = _limpar_resposta(resposta.get("text") or "")
        if _resposta_texto_valida(content):
            return ToolResult(texto=content)

        log.warning("gemini_resposta_invalida", trecho=content[:120])
        raise GeminiError("resposta de texto inválida")

    async def _processar_ollama(
        self, tenant_cfg: Dict[str, Any], messages: List[Dict[str, str]], mensagem: str
    ) -> ToolResult:
        """Executa o modelo local via API de Chat do Ollama."""
        ollama_url = f"{settings.ollama_base_url.rstrip('/')}/api/chat"
        payload = {
            "model": tenant_cfg["model"],
            "messages": messages,
            "stream": False,
            "keep_alive": "15m",
            "options": {
                "num_predict": 120,
                "temperature": 0.6,
            },
        }
        # Qwen3 raciocina por padrão; com num_predict curto o `content` volta vazio.
        if "qwen3" in tenant_cfg["model"].lower():
            payload["think"] = False

        try:
            async with httpx.AsyncClient(timeout=settings.ollama_timeout_seconds) as client:
                res = await client.post(ollama_url, json=payload)
                if res.status_code == 200:
                    data = res.json()
                    resp_msg = data.get("message", {})
                    tool_calls = resp_msg.get("tool_calls", [])

                    if tool_calls:
                        # Executa a primeira ferramenta indicada
                        tc = tool_calls[0]
                        fn_name = tc.get("function", {}).get("name")
                        fn_args = tc.get("function", {}).get("arguments", {})
                        if isinstance(fn_args, str):
                            try:
                                fn_args = json.loads(fn_args)
                            except Exception:
                                fn_args = {}

                        texto_ferramenta, proposta, imoveis = await self._executar_ferramenta(fn_name, fn_args)
                        return ToolResult(
                            texto=texto_ferramenta,
                            proposta_escrita=proposta,
                            imoveis=imoveis,
                        )

                    # Resposta direta em texto
                    content = _limpar_resposta(resp_msg.get("content", ""))
                    if _resposta_texto_valida(content):
                        return ToolResult(texto=content)
                    log.warning(
                        "ollama_resposta_invalida",
                        modelo=tenant_cfg["model"],
                        trecho=content[:120],
                    )

        except Exception as e:
            log.warning("ollama_chamada_falhou", error=str(e))

        # Fallback determinístico
        return self._fallback_deterministico(mensagem)

    async def processar(
        self,
        mensagem: str,
        historico: List[Dict[str, Any]],
        entrada_audio: bool = False,
        resposta_em_audio: bool = False,
    ) -> ToolResult:
        """
        Orquestra a chamada ao provedor de IA (Gemini ou Ollama) com tolerância a falha.

        `entrada_audio`/`resposta_em_audio` ajustam o prompt: transcrição pode
        ter erros, e resposta que vira voz precisa ser escrita como fala.
        """
        self._cfg = await self._carregar_config_tenant()
        resultado = await self._processar(
            mensagem, historico, self._cfg, entrada_audio, resposta_em_audio
        )
        # Garantia além da instrução no prompt: palavra proibida nunca sai.
        if self._cfg.get("palavras_proibidas") and resultado.texto:
            resultado.texto = remover_palavras_proibidas(
                resultado.texto, self._cfg["palavras_proibidas"]
            )
        return resultado

    async def _processar(
        self,
        mensagem: str,
        historico: List[Dict[str, Any]],
        tenant_cfg: Dict[str, Any],
        entrada_audio: bool,
        resposta_em_audio: bool,
    ) -> ToolResult:
        provider = (settings.llm_provider or "ollama").strip().lower()
        usar_gemini = provider == "gemini" and bool(settings.gemini_api_key)

        # Rota determinística: responde na hora o que não precisa de IA.
        # Com Gemini ativo, conversa casual e busca de imóveis vão para a IA,
        # que interpreta linguagem natural e responde com mais naturalidade.
        deterministico = await self._roteamento_deterministico(
            mensagem,
            tenant_cfg,
            incluir_imoveis=not usar_gemini,
            incluir_conversa=not usar_gemini,
            incluir_clientes=not usar_gemini,
        )
        if deterministico:
            return deterministico

        system_prompt = self._montar_system_prompt(
            tenant_cfg,
            historico=historico,
            entrada_audio=entrada_audio,
            resposta_em_audio=resposta_em_audio,
        )
        messages = self._montar_messages(system_prompt, historico, mensagem)

        if usar_gemini:
            try:
                return await self._processar_gemini(system_prompt, messages)
            except GeminiError as e:
                log.warning("gemini_falhou", error=str(e))
                # Se a IA falhar, tenta a rota determinística de imóveis.
                fallback = await self._roteamento_deterministico(
                    mensagem, tenant_cfg, incluir_imoveis=True
                )
                if fallback:
                    return fallback
                return self._fallback_deterministico(mensagem)

        return await self._processar_ollama(tenant_cfg, messages, mensagem)

    def _fallback_deterministico(self, mensagem: str) -> ToolResult:
        """
        Gera resposta segura quando o modelo local falhar ou demorar demais.
        """
        # Sem IA não dá para entender nuance; o melhor é soar humano e pedir
        # o essencial, em vez de despejar um menu de funcionalidades.
        msg = _normalizar(mensagem)
        nome = (getattr(self.corretor, "nome", None) or "").split()
        vocativo = f", {nome[0]}" if nome and random.random() < 0.5 else ""

        if _pede_escrita_crm(msg):
            return ToolResult(
                texto=(
                    f"Não consegui anotar isso agora{vocativo}: minha IA está fora do ar por um instante. "
                    "Nada foi gravado. Manda de novo daqui a pouco?"
                ),
                fallback=True,
            )

        if re.search(r"\b(imove(l|is)|aluguel|venda|apto|apartamento|casa|lote)\b", msg):
            opcoes = (
                f"Bora{vocativo}! É pra venda ou aluguel, e em qual bairro?",
                f"Fechou{vocativo}. Me diz se é venda ou aluguel e a região que eu já procuro.",
                "Consigo sim. Qual bairro e se é pra venda ou aluguel?",
            )
        elif "cliente" in msg or "lead" in msg:
            opcoes = (
                "Me passa o nome ou telefone do cliente que eu procuro aqui.",
                f"Beleza{vocativo}, qual o nome ou o telefone dele?",
            )
        else:
            opcoes = (
                f"Opa{vocativo}, não peguei direito. Me fala de novo o que você precisa?",
                "Acho que me perdi aqui. Pode repetir de outro jeito?",
                f"Não entendi bem{vocativo}. O que você tá precisando?",
            )
        return ToolResult(texto=random.choice(opcoes), fallback=True)
