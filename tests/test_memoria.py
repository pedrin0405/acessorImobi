"""Memória de longo prazo das conversas (RAG): ruído, ranking, janela recente, resumo e falhas."""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from app.domain.conversa import memoria
from app.integration.llm import agent as agent_module
from app.integration.llm.agent import AgentOrchestrator, _janela_contexto
from app.integration.llm.gemini import GeminiError

FUSO = ZoneInfo("America/Sao_Paulo")
AGORA = datetime(2026, 10, 30, 15, 0, tzinfo=timezone.utc)


def _linha(similaridade, conteudo, papel="inbound", seguinte=None, quando=None):
    return SimpleNamespace(
        similaridade=similaridade, conteudo=conteudo, papel=papel, criada_em=quando or AGORA,
        seguinte=seguinte, seguinte_papel="outbound" if seguinte else None,
    )


class _Resultado:
    def __init__(self, linhas=None, primeira=None):
        self._linhas = linhas or []
        self._primeira = primeira

    def fetchall(self):
        return self._linhas

    def first(self):
        return self._primeira


class _SessaoFalsa:
    """Responde por trecho do SQL e guarda os parâmetros de cada consulta."""

    def __init__(self, resumo=None, ha_antigas=True, linhas=None):
        self.resumo, self.ha_antigas, self.linhas = resumo, ha_antigas, linhas or []
        self.chamadas = []

    async def execute(self, consulta, params=None):
        sql = str(consulta)
        self.chamadas.append((sql, params or {}))
        if "FROM conversa_resumos" in sql:
            return _Resultado(primeira=SimpleNamespace(resumo=self.resumo) if self.resumo else None)
        if "SELECT 1 FROM conversa_memoria" in sql:
            return _Resultado(primeira=object() if self.ha_antigas else None)
        if "<=>" in sql:
            return _Resultado(linhas=self.linhas)
        return _Resultado()


@pytest.fixture
def embeddings_falsos(monkeypatch):
    chamadas = []

    async def _embed(textos, tarefa):
        chamadas.append((list(textos), tarefa))
        return [[0.1] * 768 for _ in textos]

    monkeypatch.setattr(memoria, "_embed", _embed)
    return chamadas


# --- Ruído e texto indexável ------------------------------------------------------

def test_ruido_nao_entra_na_memoria():
    for ruido in ["ok", "Sim", "oi!", "Bom dia", "valeu", "Obrigado!", "beleza", "isso", "?", ""]:
        assert memoria.eh_ruido(ruido), ruido
    for util in ["Luciano Pereira", "quero alugar na Orla", "até 3 mil", "visita sexta 10h", "pode ser 2 quartos?"]:
        assert not memoria.eh_ruido(util), util


def test_texto_indexavel_compacta_foto_de_imovel_e_prefere_transcricao():
    legenda = (
        "🏠 *Apartamento* no bairro *Graciosa Orla 14* - Palmas\n📐 3 quarto(s) • 2 vaga(s) • 112m²\n"
        "💰 Aluguel: *R$ 7.500,00/mês*\n🏷️ Código: 16992\n" + "detalhe longo " * 40
    )
    linha = memoria.texto_indexavel({"tipo": "image", "conteudo": legenda})
    assert linha.startswith("Enviou um imóvel: Apartamento no bairro Graciosa Orla 14")
    assert "3 quartos" in linha and "R$ 7.500,00/mês" in linha and "cód. 16992" in linha and len(linha) < 200

    assert memoria.texto_indexavel({"tipo": "audio", "conteudo": "oi", "transcricao": "quero casa no Plano Diretor"}) == "quero casa no Plano Diretor"
    assert memoria.texto_indexavel({"tipo": "text", "conteudo": "ok"}) is None
    assert memoria.texto_indexavel({"tipo": "text", "conteudo": "   "}) is None


# --- Consulta ----------------------------------------------------------------------

def test_consulta_anaforica_busca_de_duas_formas():
    hist = [{"direcao": "inbound", "conteudo": "Marca visita com o Roberto sábado"}, {"direcao": "outbound", "conteudo": "Feito"}]
    sozinha, combinada = memoria.consulta_de_busca("e o cachorro dela?", hist)
    assert sozinha == "e o cachorro dela?" and combinada.startswith("Marca visita com o Roberto") and combinada.endswith("e o cachorro dela?")
    # Assunto próprio (nome, número ou texto longo) vai sozinho.
    assert memoria.consulta_de_busca("Me fala da Ana de novo", hist) == ["Me fala da Ana de novo"]
    assert memoria.consulta_de_busca("e o de 3 mil?", hist) == ["e o de 3 mil?"]
    assert memoria.consulta_de_busca("Voltando ao orçamento daquela cliente que quer alugar", hist) == ["Voltando ao orçamento daquela cliente que quer alugar"]
    assert memoria.consulta_de_busca("e o outro?", []) == ["e o outro?"]


# --- Ranking -----------------------------------------------------------------------

def test_escolher_aplica_limiar_k_e_remove_repetidos():
    candidatos = [
        _linha(0.82, "A Ana quer alugar na Orla"), _linha(0.81, "A Ana quer alugar na Orla"),
        _linha(0.7, "Ela tem um cachorro"), _linha(0.61, "Precisa de vaga coberta"),
        _linha(0.58, "abaixo do limiar"), _linha(0.55, "ruído"),
    ]
    escolhidos = memoria._escolher(candidatos, k=3, limiar=0.6)
    assert [e["conteudo"] for e in escolhidos] == ["A Ana quer alugar na Orla", "Ela tem um cachorro", "Precisa de vaga coberta"]
    assert memoria._escolher(candidatos, k=1, limiar=0.6)[0]["similaridade"] == 0.82
    assert memoria._escolher([_linha(0.4, "x")], k=4, limiar=0.6) == []


def test_intercalar_alterna_consultas_sem_repetir():
    a = [{"conteudo": "A1"}, {"conteudo": "A2"}, {"conteudo": "A3"}]
    b = [{"conteudo": "B1"}, {"conteudo": "A1"}, {"conteudo": "B3"}]
    assert [t["conteudo"] for t in memoria._intercalar([a, b], 4)] == ["A1", "B1", "A2", "A3"]
    assert memoria._intercalar([a], 2) == a[:2]
    assert memoria._intercalar([], 4) == []


# --- Recuperação -------------------------------------------------------------------

def test_recuperacao_exclui_a_janela_recente_e_usa_consulta_de_pergunta(monkeypatch, embeddings_falsos):
    monkeypatch.setattr(memoria.settings, "memoria_k", 2)
    monkeypatch.setattr(memoria.settings, "memoria_limiar", 0.6)
    corte = AGORA - timedelta(hours=1)
    sessao = _SessaoFalsa(resumo="- Ana: aluguel na Orla", linhas=[_linha(0.75, "A Ana tem um cachorro", seguinte="Registrado")])

    saida = asyncio.run(memoria.recuperar_com_sessao(sessao, uuid4(), uuid4(), corte.isoformat(), ["e o cachorro dela?", "Roberto e o cachorro dela"]))

    assert saida["resumo"] == "- Ana: aluguel na Orla"
    assert [t["conteudo"] for t in saida["trechos"]] == ["A Ana tem um cachorro"]  # a 2ª consulta repete e é descartada
    assert saida["trechos"][0]["seguinte"] == "Registrado"
    # Um único lote de embeddings para as duas consultas, do tipo "pergunta".
    assert embeddings_falsos == [(["e o cachorro dela?", "Roberto e o cachorro dela"], "RETRIEVAL_QUERY")]
    # A busca vetorial só olha antes da janela recente.
    buscas = [p for sql, p in sessao.chamadas if "<=>" in sql]
    assert len(buscas) == 2 and all(p["corte"] == corte and p["n"] == 6 for p in buscas)


def test_recuperacao_pula_o_embedding_quando_nao_ha_memoria_antiga(embeddings_falsos):
    sessao = _SessaoFalsa(resumo=None, ha_antigas=False)
    saida = asyncio.run(memoria.recuperar_com_sessao(sessao, uuid4(), uuid4(), AGORA.isoformat(), "qualquer coisa"))
    assert saida["trechos"] == [] and saida["pulou"] == "sem memória anterior à janela" and embeddings_falsos == []


def test_mensagem_trivial_usa_so_o_resumo(embeddings_falsos):
    sessao = _SessaoFalsa(resumo="- algo")
    saida = asyncio.run(memoria.recuperar_com_sessao(sessao, uuid4(), uuid4(), AGORA.isoformat(), "ok", pular_busca=True))
    assert saida["resumo"] == "- algo" and saida["trechos"] == [] and embeddings_falsos == []


# --- Tolerância a falha ------------------------------------------------------------

def _usar_sessao(monkeypatch, sessao):
    @asynccontextmanager
    async def _get_session(_tenant):
        yield sessao

    monkeypatch.setattr(memoria, "get_session", _get_session)
    monkeypatch.setattr(memoria.settings, "gemini_api_key", "chave")
    monkeypatch.setattr(memoria.settings, "memoria_ativa", True)


def test_falha_do_embedding_nao_derruba_a_resposta(monkeypatch):
    async def _quebrado(textos, tarefa):
        raise GeminiError("HTTP 429 (cota)")

    monkeypatch.setattr(memoria, "_embed", _quebrado)
    _usar_sessao(monkeypatch, _SessaoFalsa())
    assert asyncio.run(memoria.recuperar(uuid4(), uuid4(), AGORA.isoformat(), "quero voltar ao assunto da Ana")) is None


def test_timeout_devolve_none(monkeypatch):
    async def _lento(textos, tarefa):
        await asyncio.sleep(5)

    monkeypatch.setattr(memoria, "_embed", _lento)
    monkeypatch.setattr(memoria.settings, "memoria_timeout_s", 0.05)
    _usar_sessao(monkeypatch, _SessaoFalsa())
    assert asyncio.run(memoria.recuperar(uuid4(), uuid4(), AGORA.isoformat(), "quero voltar ao assunto da Ana")) is None


def test_memoria_desligada_ou_sem_chave(monkeypatch):
    monkeypatch.setattr(memoria.settings, "memoria_ativa", False)
    assert not memoria.disponivel()
    assert asyncio.run(memoria.recuperar(uuid4(), uuid4(), AGORA.isoformat(), "x")) is None
    monkeypatch.setattr(memoria.settings, "memoria_ativa", True)
    monkeypatch.setattr(memoria.settings, "gemini_api_key", None)
    assert not memoria.disponivel()


# --- Resumo ------------------------------------------------------------------------

def test_gatilho_do_resumo(monkeypatch):
    monkeypatch.setattr(memoria.settings, "memoria_resumo_a_cada", 16)
    assert not memoria.deve_resumir(15)
    assert memoria.deve_resumir(16) and memoria.deve_resumir(40)


# --- Prompt ------------------------------------------------------------------------

def test_bloco_do_prompt_traz_resumo_e_trechos_com_aviso():
    mem = {
        "resumo": "- Ana: aluguel na Orla até R$ 3.000, aceita pet",
        "trechos": [{
            "papel": "inbound", "conteudo": "A Ana tem um cachorro pequeno", "quando": AGORA,
            "similaridade": 0.75, "seguinte": "Registrei que a Ana precisa de prédio pet", "seguinte_papel": "outbound",
        }],
    }
    bloco = memoria.bloco_prompt(mem, FUSO)
    assert "Resumo da conversa até aqui" in bloco and "aceita pet" in bloco
    assert "Trechos anteriores que podem ser relevantes" in bloco
    assert "(30/10 12:00) Corretor: A Ana tem um cachorro pequeno" in bloco
    assert "↳ Acessor: Registrei que a Ana precisa de prédio pet" in bloco
    assert "não são mensagens atuais" in bloco
    assert memoria.bloco_prompt(None, FUSO) == "" and memoria.bloco_prompt({"resumo": None, "trechos": []}, FUSO) == ""


def test_system_prompt_do_agente_inclui_a_memoria():
    agente = AgentOrchestrator(uuid4(), SimpleNamespace(nome="Pedro", id=uuid4()), object())
    cfg = {"persona": "PERSONA", "nome": "Quadra"}
    com = agente._montar_system_prompt(cfg, historico=[], memoria={"resumo": "- Ana: Orla", "trechos": []})
    sem = agente._montar_system_prompt(cfg, historico=[])
    assert "## Memória desta conversa (passado)" in com and "- Ana: Orla" in com
    assert "Memória desta conversa" not in sem
    assert com.index("Memória desta conversa") < com.index("## Como conversar")


# --- Integração com a janela do agente ---------------------------------------------

def _hist(n, inicio=AGORA):
    return [
        {"id": str(i), "direcao": "inbound" if i % 2 == 0 else "outbound", "tipo": "text",
         "conteudo": f"mensagem {i}", "created_at": (inicio + timedelta(minutes=i)).isoformat()}
        for i in range(n)
    ]


def test_janela_informa_o_corte_e_se_descartou(monkeypatch):
    monkeypatch.setattr(agent_module.settings, "context_window_messages", 12)
    curta = _hist(6)
    msgs, corte, descartou = _janela_contexto(curta)
    assert len(msgs) == 6 and not descartou and corte == curta[0]["created_at"]

    longa = _hist(30)
    msgs, corte, descartou = _janela_contexto(longa)
    assert len(msgs) == 12 and descartou and corte == longa[18]["created_at"]


def test_agente_so_busca_memoria_quando_a_conversa_passa_da_janela(monkeypatch):
    monkeypatch.setattr(agent_module.settings, "context_window_messages", 12)
    monkeypatch.setattr(memoria.settings, "gemini_api_key", "chave")
    monkeypatch.setattr(memoria.settings, "memoria_ativa", True)
    chamadas = []

    async def _recuperar(tenant, corretor, corte, consulta, pular_busca=False):
        chamadas.append((corte, consulta, pular_busca))
        return {"resumo": "r", "trechos": [], "ms": 3}

    monkeypatch.setattr(memoria, "recuperar", _recuperar)

    async def _roda(historico, mensagem):
        agente = AgentOrchestrator(uuid4(), SimpleNamespace(nome="Pedro", id=uuid4()), object())
        tarefa = agente._iniciar_memoria(mensagem, historico)
        return tarefa, (await agente._aguardar_memoria(tarefa)) if tarefa else None, agente

    tarefa, _, _ = asyncio.run(_roda(_hist(6), "quero alugar na Orla"))
    assert tarefa is None and chamadas == []  # tudo cabe na janela: nenhuma consulta

    longa = _hist(30)
    tarefa, memoria_obtida, agente = asyncio.run(_roda(longa, "e o cachorro dela?"))
    assert memoria_obtida["resumo"] == "r"
    corte, consulta, pular = chamadas[0]
    assert corte == longa[18]["created_at"] and len(consulta) == 2 and not pular
    assert agente._passos[-1]["etapa"] == "Memória" and "resumo" in agente._passos[-1]["detalhe"].lower()

    asyncio.run(_roda(longa, "ok"))
    assert chamadas[-1][2] is True  # mensagem trivial: só o resumo, sem embedding
