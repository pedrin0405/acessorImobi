"""Fases dos atendimentos do Imoview: normalização, mapa fase→etapa e fila de alterações pendentes."""
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from app.domain.crm import atendimentos_imoview as f

pytestmark = pytest.mark.asyncio

ETAPA_A, ETAPA_B = str(uuid4()), str(uuid4())


def _bruto(**extra):
    base = {"codigo": 40442, "situacao": "Em atendimento", "termometro": "Frio", "corretorcodigo": 279,
            "datahorainclusao": "30/10/2026 18:13", "datahoraultimaalteracao": "30/10/2026 18:19", "lead": {"codigo": 29867, "nome": "Maria"}}
    return {**base, **extra}


@pytest.mark.parametrize("texto,esperado", [
    ("Em atendimento", "em_atendimento"), ("Negócio realizado", "negocio_realizado"), ("NEGOCIO REALIZADO", "negocio_realizado"),
    ("Descartado", "descartado"), (None, "em_atendimento"), ("algo novo", "em_atendimento"),
])
def test_situacao_tipo(texto, esperado):
    assert f.situacao_tipo(texto) == esperado


def test_normaliza_atendimento():
    n = f.normalizar_atendimento(_bruto(), 2, 3)
    assert (n["codigo"], n["lead_codigo"], n["fase"], n["finalidade"]) == (40442, 29867, 3, 2)
    assert n["situacao_tipo"] == "em_atendimento" and n["corretor_codigo"] == 279
    assert n["alterado_em"] == datetime(2026, 10, 30, 18, 19, tzinfo=ZoneInfo("America/Sao_Paulo"))


def test_atendimento_sem_codigo_ou_lead_nao_quebra():
    assert f.normalizar_atendimento(_bruto(codigo=None), 2, 1) is None
    n = f.normalizar_atendimento(_bruto(lead=None, datahoraultimaalteracao=""), 1, 1)
    assert n["lead_codigo"] is None and n["alterado_em"] == n["incluido_em"]


def test_config_vazia_nao_espelha_nada():
    c = f.ler_config(None)
    assert c == {"espelhar": False, "fases": {}, "auto": True}


def test_config_ignora_fases_invalidas_e_vazias():
    c = f.ler_config({"imoview_funil": {"espelhar": True, "fases": {"1": ETAPA_A, "2": None, "9": ETAPA_B, "x": ETAPA_B, "3": ""}}})
    assert c["fases"] == {1: ETAPA_A} and c["espelhar"] is True


def test_mapa_inverso_usa_a_menor_fase():
    c = f.ler_config({"imoview_funil": {"fases": {"4": ETAPA_A, "2": ETAPA_A, "5": ETAPA_B}}})
    assert f.fase_da_etapa(c, ETAPA_A) == 2 and f.fase_da_etapa(c, ETAPA_B) == 5 and f.fase_da_etapa(c, str(uuid4())) is None
    assert f.etapa_da_fase(c, 4) == ETAPA_A and f.etapa_da_fase(c, 7) is None


def test_filtro_de_data_em_horario_de_brasilia():
    assert f.formatar_filtro_data(datetime(2026, 10, 30, 21, 5, tzinfo=timezone.utc)) == "30/10/2026 18:05"


def test_combinacoes_e_retomada():
    todas = f.combinacoes()
    assert len(todas) == 16 and todas[0] == ("2", 1) and todas[-1] == ("1", 8)
    assert f.combinacoes({"fin": "1", "fase": 3})[0] == ("1", 3)
    assert f.combinacoes({"fin": "9", "fase": 3}) == todas


class _R:
    def __init__(self, primeira=None, escalar=None):
        self._p, self._e = primeira, escalar

    def first(self):
        return self._p

    def scalar(self):
        return self._e


class _Sessao:
    """Responde às consultas de registrar_pendencia na ordem e guarda os comandos de escrita."""

    def __init__(self, negocio, dados):
        self._leituras = [_R(primeira=negocio), _R(escalar=dados)]
        self.escritas = []

    async def execute(self, sql, params=None):
        if self._leituras:
            return self._leituras.pop(0)
        self.escritas.append((str(sql), params))
        return _R()


DADOS = {"imoview_funil": {"espelhar": True, "fases": {"2": ETAPA_A, "3": ETAPA_B}}}


async def test_mover_para_etapa_mapeada_registra_pendencia():
    s = _Sessao(SimpleNamespace(imoview_atendimento=40442, imoview_fase=3), DADOS)
    assert await f.registrar_pendencia(s, uuid4(), uuid4(), etapa_id=ETAPA_A) is True
    insercao = s.escritas[-1]
    assert "INSERT INTO imoview_alteracoes_pendentes" in insercao[0]
    assert insercao[1]["fase"] == 2 and insercao[1]["tipo"] == "fase" and insercao[1]["atend"] == 40442


async def test_sem_atendimento_ou_sem_mapa_nao_registra():
    assert await f.registrar_pendencia(_Sessao(None, DADOS), uuid4(), uuid4(), etapa_id=ETAPA_A) is False
    assert await f.registrar_pendencia(_Sessao(SimpleNamespace(imoview_atendimento=None, imoview_fase=None), DADOS), uuid4(), uuid4(), etapa_id=ETAPA_A) is False
    assert await f.registrar_pendencia(_Sessao(SimpleNamespace(imoview_atendimento=1, imoview_fase=3), DADOS), uuid4(), uuid4(), etapa_id=str(uuid4())) is False


async def test_mover_para_a_fase_em_que_o_imoview_ja_esta_nao_registra():
    s = _Sessao(SimpleNamespace(imoview_atendimento=40442, imoview_fase=3), DADOS)
    assert await f.registrar_pendencia(s, uuid4(), uuid4(), etapa_id=ETAPA_B) is False and not s.escritas


@pytest.mark.parametrize("status,tipo", [("ganho", "ganho"), ("perdido", "descarte")])
async def test_fechar_no_portal_registra_pendencia(status, tipo):
    s = _Sessao(SimpleNamespace(imoview_atendimento=7, imoview_fase=3), DADOS)
    assert await f.registrar_pendencia(s, uuid4(), uuid4(), status=status, motivo="Sem retorno") is True
    assert s.escritas[-1][1]["tipo"] == tipo and s.escritas[-1][1]["fase"] is None


async def test_mudanca_vinda_do_imoview_nao_gera_pendencia(monkeypatch):
    """Sem laço: mover_negocio com autor 'imoview' (o sync) nunca chega a registrar_pendencia."""
    from app.domain.crm.service import CrmService

    chamadas = []

    async def falso(*a, **k):
        chamadas.append(1)
        return True

    monkeypatch.setattr(f, "registrar_pendencia", falso)
    servico = CrmService.__new__(CrmService)
    servico._session = object()
    await servico._pendencia_imoview(uuid4(), uuid4(), "imoview", etapa_id=ETAPA_A)
    assert chamadas == []
    await servico._pendencia_imoview(uuid4(), uuid4(), "portal", etapa_id=ETAPA_A)
    assert chamadas == [1]
