"""Testes da integração com Gemini e da busca flexível de imóveis."""
import base64
import json
import re
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.integration.llm.agent import (
    AGENT_TOOLS,
    AgentOrchestrator,
    _parse_limite,
    _parse_valor_max,
)
from app.integration.llm.gemini import (
    GeminiClient,
    _converter_tools,
    _montar_contents,
    preparar_texto_fala,
)
from app.integration.transcription.whisper import _decodificar_midia
from app.integration.whatsapp.evolution import EvolutionClient
from app.worker.pipeline import _deve_enviar_audio, _enviar_resposta, _texto_para_fala


class _FakeResult:
    def fetchall(self):
        return [
            SimpleNamespace(bairro="Condominio Alphaville 1"),
            SimpleNamespace(bairro="Condominio Alphaville 2 - Quadra 209 Sul"),
            SimpleNamespace(bairro="Plano Diretor Sul"),
        ]


class _FakeSession:
    async def execute(self, *args, **kwargs):
        return _FakeResult()


def _imovel(codigo: int):
    return {
        "codigo": codigo,
        "resumo_texto": f"Imóvel {codigo}",
        "foto_url": None,
    }


def test_parse_limite():
    assert _parse_limite("de 3 a 5 opcoes de casa") == 5
    assert _parse_limite("me mande 2 imoveis") == 2
    assert _parse_limite("quero 4 casas para alugar") == 4
    assert _parse_limite("quero uma casa") == 5
    assert _parse_limite("quero 42 imoveis") == 10


def test_parse_valor_max():
    assert _parse_valor_max("de ate 2 milhoes") == 2_000_000
    assert _parse_valor_max("ate 800 mil") == 800_000
    assert _parse_valor_max("maximo r$ 3500") == 3500
    assert _parse_valor_max("sem limite") is None


def test_preparar_texto_fala():
    texto = "🏠 *Casa* no bairro *Alphaville*\n\n---\n\n💰 Valor: *R$ 2.000.000*"
    fala = preparar_texto_fala(texto)
    assert "*" not in fala
    assert "🏠" not in fala
    assert "Casa no bairro Alphaville" in fala
    assert "---" not in fala


def test_montar_contents_agrupa_papeis():
    contents = _montar_contents(
        [
            {"role": "system", "content": "persona"},
            {"role": "assistant", "content": "Olá"},
            {"role": "user", "content": "quero casa"},
        ]
    )
    assert contents[0]["role"] == "user"
    assert contents[1]["role"] == "model"


def test_converter_tools():
    tools = _converter_tools(AGENT_TOOLS)
    nomes = {d["name"] for d in tools[0]["functionDeclarations"]}
    assert "consultar_imoveis" in nomes


@pytest.mark.asyncio
async def test_busca_natural_alphaville(monkeypatch):
    agente = AgentOrchestrator(
        uuid4(),
        SimpleNamespace(nome="Pedro", id=uuid4()),
        _FakeSession(),
    )
    capturado = {}

    async def fake_buscar(**kwargs):
        capturado.update(kwargs)
        return [_imovel(i) for i in range(1, 6)]

    monkeypatch.setattr(agente.imovel_service, "buscar", fake_buscar)

    resultado = await agente._roteamento_deterministico(
        "Me mande de 3 a 5 opcoes de casa no alphaville de ate 2 milhoes",
        {"persona": "teste"},
        incluir_imoveis=True,
    )

    assert resultado is not None
    assert capturado["finalidade"] == "venda"
    assert capturado["bairro"] == "Alphaville"
    assert capturado["tipo"] == "casa"
    assert capturado["valor_max"] == 2_000_000
    assert capturado["limit"] == 5
    assert len(resultado.imoveis or []) == 5
    assert "5 opções" in resultado.texto


@pytest.mark.asyncio
async def test_gemini_function_call(httpx_mock):
    httpx_mock.add_response(
        url=re.compile(r".*/models/.*:generateContent.*"),
        json={
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "functionCall": {
                                    "name": "consultar_imoveis",
                                    "args": {
                                        "finalidade": "venda",
                                        "bairro": "Alphaville",
                                        "tipo": "casa",
                                        "valor_max": 2_000_000,
                                        "limite": 5,
                                    },
                                }
                            }
                        ]
                    }
                }
            ]
        },
    )

    cliente = GeminiClient(api_key="chave-de-teste", record_usage=False)
    resposta = await cliente.gerar(
        "Você é um assistente imobiliário.",
        [{"role": "user", "content": "casa no alphaville até 2 milhões"}],
        tools=AGENT_TOOLS,
    )

    assert resposta["function_call"]["name"] == "consultar_imoveis"
    assert resposta["function_call"]["args"]["limite"] == 5


@pytest.mark.asyncio
async def test_gemini_preserva_thought_signature_na_segunda_passada(httpx_mock):
    part = {
        "functionCall": {
            "name": "consultar_imoveis",
            "args": {"finalidade": "venda"},
        },
        "thoughtSignature": "assinatura-de-teste",
    }
    httpx_mock.add_response(
        url=re.compile(r".*/models/.*:generateContent.*"),
        json={"candidates": [{"content": {"parts": [part]}}]},
    )
    httpx_mock.add_response(
        url=re.compile(r".*/models/.*:generateContent.*"),
        json={
            "candidates": [
                {"content": {"parts": [{"text": "Achei uma opção pra você."}]}}
            ]
        },
    )

    cliente = GeminiClient(api_key="chave-de-teste", record_usage=False)
    resposta = await cliente.gerar(
        "prompt", [{"role": "user", "content": "casa para venda"}], tools=AGENT_TOOLS
    )
    assert resposta["function_call_part"] == part

    texto = await cliente.gerar_apos_ferramenta(
        system_prompt="prompt",
        messages=[{"role": "user", "content": "casa para venda"}],
        nome_funcao="consultar_imoveis",
        argumentos={"finalidade": "venda"},
        resultado="1 opção encontrada",
        instrucao="responda naturalmente",
        function_call_part=resposta["function_call_part"],
    )
    assert texto == "Achei uma opção pra você."

    enviado = json.loads(httpx_mock.get_requests()[1].content)
    assert enviado["contents"][-2]["parts"][0]["thoughtSignature"] == "assinatura-de-teste"


@pytest.mark.asyncio
async def test_busca_vazia_sugere_alternativas(monkeypatch):
    agente = AgentOrchestrator(
        uuid4(),
        SimpleNamespace(nome="Pedro", id=uuid4()),
        _FakeSession(),
    )
    chamadas = []

    async def fake_buscar(**kwargs):
        chamadas.append(kwargs)
        if kwargs.get("valor_max"):
            return []
        return [
            {**_imovel(8987), "resumo_texto": "Casa 1", "valor": 2_950_000},
            {**_imovel(6053), "resumo_texto": "Casa 2", "valor": 3_300_000},
        ]

    monkeypatch.setattr(agente.imovel_service, "buscar", fake_buscar)

    resultado = await agente._roteamento_deterministico(
        "Me mande de 3 a 5 opcoes de casa no alphaville de ate 2 milhoes",
        {"persona": "teste"},
        incluir_imoveis=True,
    )

    assert chamadas[0]["valor_max"] == 2_000_000
    assert chamadas[1]["valor_max"] is None
    assert len(resultado.imoveis or []) == 2
    assert "Não encontrei casa no bairro Alphaville" in resultado.texto
    assert "R$ 2.000.000,00" in resultado.texto
    assert "acima desse valor" in resultado.texto


@pytest.mark.asyncio
async def test_send_audio_multipart_sem_delay(httpx_mock):
    httpx_mock.add_response(
        url=re.compile(r".*/message/sendWhatsAppAudio/.*"),
        json={"key": {"id": "audio-1"}},
    )

    cliente = EvolutionClient(base_url="http://evolution:8080", api_key="teste")
    await cliente.send_audio(
        instance_id="inst_teste",
        to="+5563999999999",
        audio=b"OggS\x00fake",
    )

    requisicao = httpx_mock.get_requests()[0]
    corpo = requisicao.content.decode("latin-1")
    assert requisicao.headers["content-type"].startswith("multipart/form-data")
    assert 'name="number"' in corpo
    assert 'name="delay"' not in corpo
    assert 'filename="resposta.ogg"' in corpo


@pytest.mark.asyncio
async def test_get_media_base64_envia_mensagem_e_normaliza_data_uri(httpx_mock):
    httpx_mock.add_response(
        url=re.compile(r".*/chat/getBase64FromMediaMessage/.*"),
        json={"base64": "data:audio/ogg;base64,T2dnUw=="},
    )

    cliente = EvolutionClient(base_url="http://evolution:8080", api_key="teste")
    base64_media = await cliente.get_media_base64(
        "inst_teste",
        {"id": "abc", "remoteJid": "5563999999999@s.whatsapp.net", "fromMe": False},
        {"audioMessage": {"mimetype": "audio/ogg", "ptt": True}},
    )

    assert base64_media == "T2dnUw=="
    enviado = json.loads(httpx_mock.get_requests()[0].content)
    assert enviado["message"]["key"]["id"] == "abc"
    assert enviado["message"]["audioMessage"]["mimetype"] == "audio/ogg"


def test_texto_para_fala_sem_pontuacao_duplicada():
    fala = _texto_para_fala(
        "Encontrei 3 opções de casa no Alphaville.\n\nDetalhes...",
        [_imovel(1), _imovel(2), _imovel(3)],
    )
    assert ".." not in fala
    assert fala.startswith("Encontrei 3 opções de casa no Alphaville.")
    assert fala.endswith("detalhes de cada imóvel.")


def test_decodificar_midia_data_uri_e_base64():
    conteudo = b"OggS\x00audio"
    codificado = base64.b64encode(conteudo).decode()

    assert _decodificar_midia(f"data:audio/ogg;base64,{codificado}") == conteudo
    assert _decodificar_midia(codificado) == conteudo
    assert _decodificar_midia("não-é-base64") is None


def test_deve_enviar_audio():
    # Áudio recebido sempre recebe áudio no modo mirror.
    assert _deve_enviar_audio(
        modo="mirror", tipo="audio", chance=0.0, tem_imoveis=False
    )
    # Mensagem de texto: só com chance > 0.
    assert not _deve_enviar_audio(
        modo="mirror", tipo="text", chance=0.0, tem_imoveis=False
    )
    assert _deve_enviar_audio(
        modo="mirror", tipo="text", chance=1.0, tem_imoveis=False
    )
    # Nunca dois áudios seguidos por sorteio: alterna texto e voz.
    assert not _deve_enviar_audio(
        modo="mirror", tipo="text", chance=1.0, ultimo_foi_audio=True
    )
    # Sorteio não vale para lista de imóveis; áudio recebido vale.
    assert not _deve_enviar_audio(
        modo="mirror", tipo="text", chance=1.0, tem_imoveis=True
    )
    assert _deve_enviar_audio(
        modo="mirror", tipo="audio", chance=0.0, tem_imoveis=True
    )
    # Propostas de escrita nunca viram áudio.
    assert not _deve_enviar_audio(
        modo="always",
        tipo="text",
        chance=1.0,
        tem_imoveis=False,
        tem_proposta=True,
    )
    assert not _deve_enviar_audio(
        modo="never", tipo="audio", chance=1.0, tem_imoveis=False
    )


def test_audio_a_cada_n_respostas_de_texto():
    base = dict(modo="mirror", tipo="text", chance=0.0)
    assert not _deve_enviar_audio(**base, a_cada=4, textos_desde_audio=3)
    assert _deve_enviar_audio(**base, a_cada=4, textos_desde_audio=4)
    # Nunca dois seguidos, mesmo no contador.
    assert not _deve_enviar_audio(**base, a_cada=2, textos_desde_audio=9, ultimo_foi_audio=True)


def test_audio_nao_responde_audio_com_audio_quando_desligado():
    assert not _deve_enviar_audio(modo="mirror", tipo="audio", chance=0.0, responder_audio=False)


def test_config_audio_do_tenant():
    from app.worker.pipeline import _config_audio, _textos_desde_ultimo_audio

    cfg = _config_audio({"audio_frequencia": "a_cada", "audio_a_cada": 99, "audio_responder_audio": False})
    assert cfg == {"modo": "mirror", "chance": 0.0, "a_cada": 20, "responder_audio": False}

    cfg = _config_audio({"audio_frequencia": "aleatorio", "audio_chance": 35})
    assert cfg["chance"] == 0.35 and cfg["a_cada"] == 0

    assert _config_audio({"audio_frequencia": "sempre"})["modo"] == "always"
    assert _config_audio({"audio_frequencia": "nunca"})["chance"] == 0.0

    historico = [
        {"direcao": "outbound", "tipo": "audio"},
        {"direcao": "inbound", "tipo": "text"},
        {"direcao": "outbound", "tipo": "text"},
        {"direcao": "outbound", "tipo": "image"},
        {"direcao": "outbound", "tipo": "text"},
    ]
    assert _textos_desde_ultimo_audio(historico) == 2


def test_id_de_voz_clonada():
    from app.integration.tts.vozes import falante_catalogo, id_clone, voz_valida

    uid = "0f8e1c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b"
    assert id_clone(f"clone:{uid}") == uid
    assert id_clone("clone:qualquer") is None
    assert voz_valida(f"clone:{uid}") and voz_valida("ryan") and not voz_valida("xpto")
    assert falante_catalogo(f"clone:{uid}") == "serena"


def test_audio_cabe_na_resposta():
    from app.worker.pipeline import _audio_cabe_na_resposta

    kwargs = dict(modo="mirror", tipo="text", tem_imoveis=False, tem_proposta=False)
    assert _audio_cabe_na_resposta("Opa, bom dia! Bora ver isso agora.", **kwargs)
    # Dados que o corretor precisa copiar ficam por escrito.
    assert not _audio_cabe_na_resposta("Link: https://imob.com/imovel/123", **kwargs)
    assert not _audio_cabe_na_resposta("Ana | Tel: (63) 99999-1234 | Cód: 4242", **kwargs)
    assert not _audio_cabe_na_resposta("- um\n- dois\n- três", **kwargs)
    assert not _audio_cabe_na_resposta("x" * 700, **kwargs)
    assert not _audio_cabe_na_resposta("ok", **{**kwargs, "tem_proposta": True})
    # Imóveis: áudio só comenta quando o corretor falou por áudio.
    assert _audio_cabe_na_resposta("Achei 3", **{**kwargs, "tipo": "audio", "tem_imoveis": True})
    assert not _audio_cabe_na_resposta("Achei 3", **{**kwargs, "tem_imoveis": True})


def test_interpretar_confirmacao_aceita_transcricao():
    from app.worker.pipeline import _interpretar_confirmacao

    assert _interpretar_confirmacao("Sim.") == (True, False)
    assert _interpretar_confirmacao("sim, pode cadastrar") == (True, False)
    assert _interpretar_confirmacao("Não, cancela") == (False, True)
    assert _interpretar_confirmacao("talvez depois") == (False, False)
    assert _interpretar_confirmacao("") == (False, False)


@pytest.mark.asyncio
async def test_audio_substitui_texto_e_vem_depois_das_fotos(monkeypatch):
    from app.worker import pipeline

    eventos = []
    tts_ok = {"valor": True}

    class FakeEvolution:
        def __init__(self, *args, **kwargs):
            pass

        async def send_text(self, **kwargs):
            eventos.append(("text", kwargs["text"]))

        async def send_media(self, **kwargs):
            eventos.append(("image", kwargs["caption"]))

        async def send_audio(self, **kwargs):
            eventos.append(("audio", kwargs["audio"]))

        async def send_presence(self, *args, **kwargs):
            pass

    class FakeTTS:
        async def texto_para_audio(self, texto, voz=None, clone=None):
            if not tts_ok["valor"]:
                raise RuntimeError("tts offline")
            return b"OggS\x00audio"

    class FakeSession:
        async def execute(self, *args, **kwargs):
            return SimpleNamespace(
                first=lambda: SimpleNamespace(instance_id="inst_teste")
            )

    monkeypatch.setattr(
        "app.integration.whatsapp.evolution.EvolutionClient", FakeEvolution
    )
    monkeypatch.setattr(pipeline, "get_tts_client", lambda: FakeTTS())

    corretor = SimpleNamespace(id=uuid4(), telefone="+5563999999999")

    await _enviar_resposta(
        uuid4(),
        corretor,
        "Oi! Tudo certo por aqui.",
        FakeSession(),
        audio=True,
    )
    # Voz no lugar do texto (sem duplicar a mesma resposta).
    assert [e[0] for e in eventos] == ["audio"]

    # TTS falhou: o corretor recebe o texto, nunca fica sem resposta.
    eventos.clear()
    tts_ok["valor"] = False
    await _enviar_resposta(
        uuid4(),
        corretor,
        "Oi! Tudo certo por aqui.",
        FakeSession(),
        audio=True,
    )
    assert eventos == [("text", "Oi! Tudo certo por aqui.")]
    tts_ok["valor"] = True

    eventos.clear()
    await _enviar_resposta(
        uuid4(),
        corretor,
        "Achei 2 opções para você.\n\nDetalhes nos imóveis.",
        FakeSession(),
        imoveis=[
            {**_imovel(1), "foto_url": "https://exemplo/1.jpg"},
            {**_imovel(2), "foto_url": "https://exemplo/2.jpg"},
        ],
        audio=True,
    )
    # Fotos primeiro; o áudio comenta a busca no lugar do cabeçalho escrito.
    assert [e[0] for e in eventos] == ["image", "image", "audio"]


@pytest.mark.asyncio
async def test_gemini_naturaliza_resultado_da_ferramenta(monkeypatch):
    from app.integration.llm import agent as agent_module

    chamadas = {}

    class FakeGemini:
        async def gerar(self, *args, **kwargs):
            return {
                "text": None,
                "function_call": {
                    "name": "consultar_clientes",
                    "args": {"q": "Ana"},
                },
            }

        async def gerar_apos_ferramenta(self, **kwargs):
            chamadas.update(kwargs)
            return "Achei a Ana no seu CRM. Quer que eu abra o cadastro dela?"

    monkeypatch.setattr(agent_module, "GeminiClient", FakeGemini)

    agente = AgentOrchestrator(
        uuid4(),
        SimpleNamespace(nome="Pedro", id=uuid4()),
        _FakeSession(),
    )

    async def fake_executar(nome, args):
        return "Clientes encontrados:\n👤 *Ana* | Tel: (63) *****-1234 | Cód: 42", None, None

    monkeypatch.setattr(agente, "_executar_ferramenta", fake_executar)

    resultado = await agente._processar_gemini(
        "prompt", [{"role": "user", "content": "tem a Ana cadastrada?"}]
    )

    assert resultado.texto == "Achei a Ana no seu CRM. Quer que eu abra o cadastro dela?"
    assert chamadas["nome_funcao"] == "consultar_clientes"
    assert "exatamente como estão" in chamadas["instrucao"]


@pytest.mark.asyncio
async def test_consumo_api_limites(monkeypatch):
    from app.api.routers import dev_panel
    from app.shared.config import get_settings

    cfg = get_settings()
    monkeypatch.setattr(cfg, "gemini_chat_daily_limit", 10)
    monkeypatch.setattr(cfg, "gemini_tts_daily_limit", 2)

    async def fake_consultar_uso(dias: int = 7):
        return {
            "dia": "2026-10-29",
            "modelos": [
                {
                    "provider": "gemini",
                    "operation": "chat",
                    "model": "gemini-flash-lite-latest",
                    "requests": 8,
                    "errors": 1,
                    "input_tokens": 100,
                    "output_tokens": 50,
                    "characters": 0,
                },
                {
                    "provider": "gemini",
                    "operation": "tts",
                    "model": "gemini-3.8-flash-tts",
                    "requests": 2,
                    "errors": 0,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "characters": 120,
                },
            ],
            "historico": [
                {"dia": "2026-10-29", "requests": 10, "errors": 1}
            ],
            "totais": {
                "requests": 10,
                "errors": 1,
                "input_tokens": 100,
                "output_tokens": 50,
            },
        }

    monkeypatch.setattr("app.domain.usage.consultar_uso", fake_consultar_uso)
    monkeypatch.setattr(cfg, "gemini_chat_rpm_limit", 15)
    monkeypatch.setattr(cfg, "gemini_tts_rpm_limit", 3)
    monkeypatch.setattr(cfg, "usage_alert_percent", 80)

    async def fake_tempo_real(provider, operation):
        return {"rpm": 1, "ultimo_429": None, "cooldown_segundos": 0}

    async def fake_cooldown(provider, chave):
        return 0

    monkeypatch.setattr("app.domain.usage.uso_tempo_real", fake_tempo_real)
    monkeypatch.setattr("app.domain.usage.cooldown_restante", fake_cooldown)

    dados = await dev_panel.consumo_apis(dias=7, dev=SimpleNamespace(sub="dev"))

    # 8/10 = 80% do limite diário → alerta; 2/2 → atingido.
    assert dados["limites"]["chat"]["usado"] == 8
    assert dados["limites"]["chat"]["status"] == "alerta"
    assert dados["limites"]["tts"]["status"] == "atingido"
    assert dados["limites"]["transcricao"]["status"] == "sem_limite"
    assert dados["totais"]["requests"] == 10

    # Um 429 recente (cooldown ativo) marca o limite como atingido mesmo
    # com o contador do dia baixo: é o provedor dizendo que estourou.
    async def fake_cooldown_ativo(provider, chave):
        return 30 if chave.startswith("chat:") else 0

    monkeypatch.setattr("app.domain.usage.cooldown_restante", fake_cooldown_ativo)
    monkeypatch.setattr(cfg, "gemini_chat_daily_limit", 1000)
    dados = await dev_panel.consumo_apis(dias=7, dev=SimpleNamespace(sub="dev"))
    assert dados["limites"]["chat"]["status"] == "atingido"
    assert dados["limites"]["chat"]["cooldown_segundos"] == 30


def test_segundos_retry_do_429():
    from app.domain.usage import segundos_retry

    corpo = '{"error": {"code": 429, "details": [{"retryDelay": "33s"}]}}'
    assert segundos_retry(corpo) == 33
    assert segundos_retry("sem detalhes") == 60
    assert segundos_retry('{"retryDelay": "9999s"}') == 300


def test_historico_compacta_fotos_e_remove_audio_duplicado():
    from app.integration.llm.agent import _historico_para_contexto

    historico = [
        {"direcao": "inbound", "tipo": "text", "conteudo": "Me manda aptos de 2 quartos na orla"},
        {"direcao": "outbound", "tipo": "text", "conteudo": "Achei 3 opções na Orla."},
        {"direcao": "outbound", "tipo": "audio", "conteudo": "Achei 3 opções na Orla."},
    ] + [
        {
            "direcao": "outbound",
            "tipo": "image",
            "conteudo": f"🏠 *Apartamento* no bairro *Orla 14*\n📐 2 quartos\n💰 R$ {i}00.000",
        }
        for i in range(3)
    ] + [
        {"direcao": "inbound", "tipo": "text", "conteudo": "Tá faltando duas opções"},
    ]

    msgs = _historico_para_contexto(historico)

    assert [m["role"] for m in msgs] == ["user", "assistant", "assistant", "user"]
    assert msgs[0]["content"].startswith("Me manda aptos")
    assert msgs[2]["content"].startswith("[Enviei 3 fotos de imóveis")
    assert "Apartamento no bairro Orla 14" in msgs[2]["content"]
    assert "*" not in msgs[2]["content"]


def test_historico_descarta_pedido_sem_resposta():
    from app.integration.llm.agent import _historico_para_contexto

    historico = [
        {"direcao": "inbound", "tipo": "text", "conteudo": "Marca visita com o Luciano hoje 14h"},
        {"direcao": "inbound", "tipo": "text", "conteudo": "oi"},
        {"direcao": "outbound", "tipo": "text", "conteudo": "Opa, tudo certo?"},
        {"direcao": "inbound", "tipo": "text", "conteudo": "marca visita com a Ana amanhã 10h"},
    ]

    msgs = _historico_para_contexto(historico)

    assert [m["content"] for m in msgs] == [
        "oi", "Opa, tudo certo?", "marca visita com a Ana amanhã 10h",
    ]


def test_limpar_resposta_remove_anotacao_de_fotos():
    from app.integration.llm.agent import _limpar_resposta

    bruto = "[Enviei 2 fotos de imóveis com os detalhes na legenda: Apto; Apto]Foi mal, seguem os outros dois."
    assert _limpar_resposta(bruto) == "Foi mal, seguem os outros dois."


def test_conversa_em_andamento():
    from datetime import datetime, timedelta, timezone
    from app.integration.llm.agent import _conversa_em_andamento

    agora = datetime.now(timezone.utc)
    assert not _conversa_em_andamento([])
    assert _conversa_em_andamento([{"created_at": (agora - timedelta(minutes=5)).isoformat()}])
    assert not _conversa_em_andamento([{"created_at": (agora - timedelta(hours=8)).isoformat()}])


def test_system_prompt_traz_persona_contexto_e_modo_voz():
    agente = AgentOrchestrator(
        uuid4(),
        SimpleNamespace(nome="Pedro Henrique", id=uuid4()),
        _FakeSession(),
    )
    cfg = {"persona": "PERSONA DO TENANT", "nome": "Quadra Brasileira"}

    prompt = agente._montar_system_prompt(cfg, historico=[], entrada_audio=True, resposta_em_audio=True)

    assert prompt.startswith("PERSONA DO TENANT")
    assert "Pedro" in prompt and "Quadra Brasileira" in prompt
    assert "MENSAGEM DE VOZ" in prompt
    assert "transcrição" in prompt
    assert "Nunca liste o que você sabe fazer" in prompt

    texto = agente._montar_system_prompt(cfg, historico=[], resposta_em_audio=False)
    assert "MENSAGEM DE VOZ" not in texto


def test_fallback_nao_despeja_menu():
    agente = AgentOrchestrator(uuid4(), SimpleNamespace(nome="Ana", id=uuid4()), _FakeSession())
    for _ in range(20):
        texto = agente._fallback_deterministico("hmm sei lá").texto
        assert "Posso buscar" not in texto
        assert len(texto) < 120
