"""Testes do CRM do corretor: perfil de busca, ações do agente e mensagens proativas."""
from datetime import datetime, time, timezone
from types import SimpleNamespace
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from app.domain.crm.acoes import _parse_inicio, resumo_acao
from app.domain.crm.mensagens import dentro_da_janela, texto_briefing, texto_lembrete
from app.domain.crm.service import CrmError, normalizar_perfil, resumo_perfil
from app.integration.llm.agent import AgentOrchestrator
from app.integration.llm.tom import TONS, remover_palavras_proibidas

SP = ZoneInfo("America/Sao_Paulo")


def test_normalizar_perfil_descarta_lixo_e_padroniza():
    perfil = normalizar_perfil({
        "interesse": "Alugar",
        "tipos": ["Apartamento", "apartamento", ""],
        "bairros": ["Orla 14"],
        "quartos_min": "2",
        "valor_max": "3000",
        "prazo": "amanhã",
        "campo_desconhecido": 1,
    })
    assert perfil == {
        "interesse": ["alugar"],
        "tipos": ["apartamento"],
        "bairros": ["Orla 14"],
        "quartos_min": 2,
        "valor_max": 3000.0,
    }


def test_resumo_perfil_legivel():
    texto = resumo_perfil({
        "interesse": ["alugar"], "tipos": ["apartamento"], "quartos_min": 2,
        "bairros": ["Orla 14"], "valor_max": 3000,
    })
    assert texto == "aluga · apartamento · 2+ quartos · Orla 14 · até R$ 3.000"
    assert resumo_perfil({}) == "sem perfil de busca"


def test_parse_inicio_no_fuso_do_tenant():
    inicio = _parse_inicio({"data": "2026-10-31", "hora": "10:30", "fuso": "America/Sao_Paulo"})
    assert inicio == datetime(2026, 10, 31, 10, 30, tzinfo=SP)
    assert _parse_inicio({}) is None
    with pytest.raises(CrmError):
        _parse_inicio({"data": "31/10"})


def test_resumo_acao_mostra_o_que_sera_gravado():
    lead = resumo_acao("crm_registrar_lead", {"nome": "Ana", "perfil": {"interesse": ["alugar"], "quartos_min": 2}})
    assert "*Ana*" in lead and "2+ quartos" in lead
    perda = resumo_acao("crm_mover_negocio", {"cliente": "Ana", "status": "perdido", "motivo_perda": "preço"})
    assert "perdido" in perda and "preço" in perda
    agenda = resumo_acao("crm_agendar", {
        "tipo": "visita", "cliente": "Ana", "data": "2026-10-31", "hora": "10:00",
        "fuso": "America/Sao_Paulo", "local": "Orla 14",
    })
    assert agenda == "Agendo *Visita* com *Ana* — sáb 31/10 às 10:00, em Orla 14."


def test_briefing_vazio_nao_envia():
    assert texto_briefing("Pedro", {"hoje": [], "atrasadas": [], "travados": [], "matches": []}, SP) is None


def test_briefing_com_conteudo():
    inicio = datetime(2026, 10, 30, 13, 0, tzinfo=timezone.utc).isoformat()
    texto = texto_briefing(
        "Pedro Augusto",
        {
            "hoje": [{"inicio": inicio, "titulo": "Visita com Ana", "local": "Orla 14"}],
            "atrasadas": [],
            "travados": [{"lead_nome": "Bruno", "etapa_nome": "Proposta", "dias_na_etapa": 16}],
            "matches": [{"lead": {"nome": "Ana"}, "imoveis": [{"codigo": 16992}]}],
        },
        SP,
    )
    assert texto.startswith("☀️ Bom dia, Pedro!")
    assert "10:00 — Visita com Ana (Orla 14)" in texto  # 13h UTC = 10h em SP
    assert "Bruno — Proposta há 16 dias" in texto
    assert "Ana: 1 imóvel novo (cód. 16992)" in texto


def test_lembrete_de_visita():
    inicio = datetime(2026, 10, 30, 13, 0, tzinfo=timezone.utc).isoformat()
    texto = texto_lembrete({"titulo": "Visita com Ana", "tipo": "visita", "inicio": inicio, "local": "Orla 14"}, SP)
    assert texto == (
        "⏰ Lembrete: *Visita com Ana* às 10:00, em Orla 14. "
        "Quer que eu te mande os dados do imóvel?"
    )


def test_janela_comercial():
    assert dentro_da_janela(datetime(2026, 10, 30, 8, 0), time(8), time(20))
    assert not dentro_da_janela(datetime(2026, 10, 30, 7, 59), time(8), time(20))
    assert not dentro_da_janela(datetime(2026, 10, 30, 20, 0), time(8), time(20))


def test_remover_palavras_proibidas():
    texto = remover_palavras_proibidas("Imóvel barato, oportunidade imperdível!", ["barato", "imperdível"])
    assert texto == "Imóvel, oportunidade!"
    # Palavra inteira: não corta dentro de outra palavra.
    assert remover_palavras_proibidas("baratinho", ["barato"]) == "baratinho"


class _Sessao:
    async def execute(self, *args, **kwargs):
        return SimpleNamespace(fetchall=lambda: [], first=lambda: None)


def _agente():
    return AgentOrchestrator(uuid4(), SimpleNamespace(nome="Pedro", id=uuid4()), _Sessao())


@pytest.mark.asyncio
async def test_acao_crm_pede_confirmacao_por_padrao():
    agente = _agente()
    agente._cfg = {"confirmar_acoes": True, "fuso": "America/Sao_Paulo"}
    texto, proposta, _ = await agente._executar_ferramenta(
        "agendar_atividade",
        {"tipo": "visita", "cliente": "Ana", "data": "2026-10-31", "hora": "10:00", "imovel_codigo": 16992.0},
    )
    assert proposta.tipo == "crm_agendar"
    assert proposta.payload["imovel_codigo"] == 16992
    assert proposta.payload["fuso"] == "America/Sao_Paulo"
    assert "Responda *sim* ou *não*" in texto


@pytest.mark.asyncio
async def test_acao_crm_executa_na_hora_sem_aprovacao(monkeypatch):
    from app.integration.llm import agent as agent_module

    chamadas = []

    async def fake_executar(session, tenant_id, corretor_id, tipo, payload):
        chamadas.append((tipo, payload))
        return "✅ feito"

    monkeypatch.setattr(agent_module, "executar_acao", fake_executar)
    agente = _agente()
    agente._cfg = {"confirmar_acoes": False}
    texto, proposta, _ = await agente._executar_ferramenta("registrar_lead", {"nome": "Ana", "telefone": ""})
    assert proposta is None and texto == "✅ feito"
    assert chamadas == [("crm_registrar_lead", {"nome": "Ana"})]  # vazios descartados


def test_prompt_usa_configuracao_estruturada():
    agente = _agente()
    prompt = agente._montar_system_prompt({
        "persona": "PERSONA", "nome": "Quadra", "tom": "formal",
        "especialidades": ["alto padrão"], "publico_alvo": "famílias",
        "nota_marca": "Boutique da Orla.", "memorias": ["Trabalhamos com permuta"],
        "palavras_proibidas": ["barato"],
    })
    assert TONS["formal"]["instrucao"] in prompt
    for trecho in ("alto padrão", "famílias", "Boutique da Orla.", "Trabalhamos com permuta", "barato", "registrar_lead"):
        assert trecho in prompt


def test_pedido_de_crm_nao_vira_busca_de_imoveis():
    from app.integration.llm.agent import AgentOrchestrator, _normalizar, _pede_escrita_crm

    pedidos = [
        "Cria um novo Lid na carteira, chamada Ana. Ela tem interesse em alugar um apartamento de dois quartos na Orla",
        "anota a Ana, quer alugar apê de 2 quartos na Orla até 3 mil",
        "marca visita com a Ana amanhã às 10h",
    ]
    for pedido in pedidos:
        assert _pede_escrita_crm(_normalizar(pedido)), pedido

    for busca in ("me manda apartamentos de 2 quartos na Orla para alugar", "busca o cliente Maria"):
        assert not _pede_escrita_crm(_normalizar(busca)), busca

    # Sem IA, a resposta é honesta e nada é gravado nem buscado.
    agente = AgentOrchestrator.__new__(AgentOrchestrator)
    agente.corretor = type("C", (), {"nome": "Pedro Augusto"})()
    resposta = agente._fallback_deterministico(pedidos[0])
    assert resposta.fallback and "Nada foi gravado" in resposta.texto
    assert not resposta.imoveis and not resposta.proposta_escrita


def test_assistente_anexos_e_titulo():
    import base64

    import pytest

    from app.domain.assistente.service import AssistenteErro, preparar_anexos, titulo_da_conversa

    b64 = lambda b: base64.b64encode(b).decode()

    inline, texto, meta = preparar_anexos([
        {"nome": "foto.png", "mime": "image/png", "dados": b64(b"\x89PNG")},
        {"nome": "nota.txt", "mime": "text/plain", "dados": b64("João quer casa".encode())},
    ])
    assert [a["mime"] for a in inline] == ["image/png"]
    assert "João quer casa" in texto and "nota.txt" in texto
    assert [m["nome"] for m in meta] == ["foto.png", "nota.txt"] and "dados" not in meta[0]

    ruins = [
        [{"nome": "a.exe", "mime": "application/x-msdownload", "dados": b64(b"x")}],
        [{"nome": "a.png", "mime": "image/png", "dados": "isso não é base64!"}],
        [{"nome": "a.png", "mime": "image/png", "dados": b64(b"x" * (4 * 1024 * 1024 + 1))}],
        [{"nome": f"{i}.txt", "mime": "text/plain", "dados": b64(b"x")} for i in range(4)],
    ]
    for anexos in ruins:
        with pytest.raises(AssistenteErro):
            preparar_anexos(anexos)

    assert titulo_da_conversa("  Gere   o briefing do dia ") == "Gere o briefing do dia"
    assert titulo_da_conversa("") == "Nova conversa"
    longo = titulo_da_conversa("palavra " * 30)
    assert len(longo) <= 61 and longo.endswith("…")
