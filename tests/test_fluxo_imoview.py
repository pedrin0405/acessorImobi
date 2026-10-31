"""Fluxo: estágio deduzido do conteúdo do atendimento e versão enxuta dos detalhes."""
import json
from pathlib import Path

import pytest

from app.domain.crm import atendimentos_imoview as at
from app.domain.crm.fluxo_imoview import deduzir_estagio, limpar_html, montar_detalhes
from app.domain.crm.importacao_imoview import _data

HUMANA = {"datahora": "08/10/2026 16:05", "descricao": "<p>Liguei&nbsp;para o cliente</p>", "usuario": "Rafael"}
ROBO = {"datahora": "06/10/2026 10:21", "descricao": "Inclusão do atendimento", "usuario": "IMOVIEW ROBÔ"}
IMOVEL = {"codigo": 5120, "titulo": "Apto", "valor": "R$ 2.350,00", "urlfotoprincipal": "https://cdn/x.jpg", "numeroquartos": "2"}


@pytest.mark.parametrize("bruto,esperado", [
    ({}, "lead"),
    ({"interacoes": [ROBO]}, "lead"),
    ({"interacoes": [ROBO, HUMANA]}, "contato"),
    ({"datahora1Resposta": "06/10/2026 10:34"}, "contato"),
    ({"imoveiscarrinho": [IMOVEL]}, "qualificado"),
    ({"leadqualificado": True}, "qualificado"),
    ({"imoveisvisita": [{**IMOVEL, "situacaovisita": "Agendamento"}]}, "visita_agendada"),
    ({"imoveisvisita": [{**IMOVEL, "situacaovisita": "Realizado"}], "imoveiscarrinho": [IMOVEL]}, "visita_realizada"),
    ({"imoveisproposta": [{**IMOVEL, "negociacoes": [{"situacaonegociacao": "Cancelado"}]}]}, "proposta"),
    ({"imoveisproposta": [{**IMOVEL, "negociacoes": [{"situacaonegociacao": "Em negociação"}]}]}, "negociacao"),
    ({"imoveisnegocio": [{**IMOVEL, "situacaonegocio": "Realizado"}]}, "negociacao"),
])
def test_deduz_estagio(bruto, esperado):
    assert deduzir_estagio(bruto) == esperado


def test_limpa_html_das_interacoes():
    assert limpar_html("<p>entrei em contato&nbsp;com   o cliente</p>") == "entrei em contato com o cliente"


def test_detalhes_enxutos_e_ordenados():
    d = montar_detalhes({
        "perfil": {"tiposimoveis": [{"codigo": 1, "nome": "Apartamento"}], "bairros": [{"nome": "Savassi"}], "numeroquarto": 2,
                   "valorde": 2000, "valorate": 3000, "varanda": True, "piscina": False, "aceitafinanciamento": True},
        "imoveiscarrinho": [IMOVEL],
        "imoveisvisita": [{**IMOVEL, "codigovisita": 9, "datavisita": "08/10/2026 15:00", "situacaovisita": "Realizado", "parecer": "Gostou"}],
        "imoveisproposta": [{**IMOVEL, "codigoproposta": 4, "negociacoes": [{"situacaonegociacao": "Cancelado", "valorproposta": 365000, "datanegociacao": "26/10/2026 10:54"}]}],
        "interacoes": [{"datahora": "06/10/2026 10:34", "descricao": "Primeiro contato"}, HUMANA, {"datahora": "x", "descricao": "  "}],
    }, _data)
    assert d["perfil"]["bairros"] == ["Savassi"] and d["perfil"]["extras"] == ["Varanda"] and d["perfil"]["financiamento"] is True
    assert d["carrinho"][0]["foto"] == "https://cdn/x.jpg" and d["carrinho"][0]["quartos"] == 2
    assert d["visitas"][0]["parecer"] == "Gostou" and d["propostas"][0]["valor"] == 365000
    assert [i["descricao"] for i in d["interacoes"]] == ["Liguei para o cliente", "Primeiro contato"]
    json.dumps(d)


def test_normaliza_atendimento_traz_origem_e_contadores():
    n = at.normalizar_atendimento({
        "codigo": 1, "situacao": "Em atendimento", "funil": "Inbound (passivo)", "midia": "Facebook Ads", "campanha": "Orla",
        "corretor": "Taiane ", "leadqualificado": True, "datahora1Resposta": "30/10/2026 18:18", "interacoes": [HUMANA],
        "lead": {"codigo": 7}, "imoveiscarrinho": [IMOVEL],
    }, 2, 3)
    assert (n["estagio"], n["funil"], n["midia"], n["corretor_nome"], n["qualificado"]) == ("qualificado", "Inbound (passivo)", "Facebook Ads", "Taiane", True)
    assert n["n_interacoes"] == 1 and n["primeira_resposta_em"] is not None
    assert json.loads(n["detalhes"])["carrinho"][0]["codigo"] == 5120


def test_estagios_cobrem_as_etapas_padrao():
    from app.domain.crm.fluxo_imoview import ESTAGIOS, ETAPA_DO_ESTAGIO
    from app.domain.crm.service import ETAPAS_PADRAO
    from app.domain.imovel.sync import sem_acento
    assert {sem_acento(n) for n, *_ in ETAPAS_PADRAO} == {ETAPA_DO_ESTAGIO[e] for e in ESTAGIOS}


def test_valor_do_crm_do_mais_firme_ao_mais_fraco():
    from app.domain.crm.fluxo_imoview import valor_do_atendimento as v
    imovel = {"valor": "R$ 750.000,00"}
    assert v({"negocios": [{"situacao": "Realizado", "valor": 380000, "comissao": 19000}], "propostas": [{"valor": 1, "situacao": "Ok"}]}) == (380000.0, "negocio", 19000.0)
    assert v({"propostas": [{"valor": 365000, "situacao": "Cancelado"}, {"valor": 400000, "situacao": "Em negociação"}]}) == (400000.0, "proposta", None)
    assert v({"propostas": [{"valor": 365000, "situacao": "Cancelado"}], "carrinho": [imovel]}) == (750000.0, "imovel", None)
    assert v({"visitas": [{"em": "2026-10-01", "imovel": {"valor": "R$ 100.000,00"}}, {"em": "2026-10-09", "imovel": {"valor": "R$ 200.000,00"}}], "carrinho": [imovel]}) == (200000.0, "imovel", None)
    assert v({"perfil": {"valor_ate": 3000}}) == (3000.0, "orcamento", None)
    assert v({}) == (None, None, None)
