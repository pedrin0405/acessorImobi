"""Importação de leads do Imoview: normalização, faixa de páginas e filtros da carteira."""
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.domain.crm import importacao_imoview as imp
from app.domain.crm.service import CrmService

AGORA = datetime(2026, 10, 30, 15, 0, tzinfo=timezone.utc)


def _bruto(**extra):
    base = {"codigo": 123, "nome": "  Maria   da Silva ", "datainclusao": "01/09/2026 10:00", "dataultimaalteracao": "01/10/2026 10:00"}
    return {**base, **extra}


def test_normaliza_nome_codigo_e_email():
    lead = imp.normalizar_lead(_bruto(emails=[{"email": "  MARIA@Exemplo.com "}]), AGORA)
    assert lead["codigo"] == 123
    assert lead["nome"] == "Maria da Silva"
    assert lead["email"] == "maria@exemplo.com"
    assert lead["temperatura"] == "morno"


def test_descarta_sem_codigo_ou_sem_nome():
    assert imp.normalizar_lead(_bruto(codigo=None), AGORA) is None
    assert imp.normalizar_lead(_bruto(nome="   "), AGORA) is None


def test_prefere_celular_e_gera_busca_pelos_ultimos_11_digitos():
    lead = imp.normalizar_lead(_bruto(telefones=[
        {"tipo": "Residencial", "numero": "(63) 3215-0000"},
        {"tipo": "Celular", "numero": "(63) 99999-1234"},
    ]), AGORA)
    assert lead["busca"] == "63999991234"
    assert lead["telefone"].endswith("63999991234")


def test_sem_telefone_valido_nao_quebra():
    lead = imp.normalizar_lead(_bruto(telefones=[{"tipo": "Celular", "numero": "123"}], emails=["sem-arroba"]), AGORA)
    assert lead["telefone"] is None and lead["busca"] is None and lead["email"] is None


def test_lead_parado_ha_mais_de_um_ano_e_frio():
    lead = imp.normalizar_lead(_bruto(datainclusao="01/01/2024 00:00", dataultimaalteracao="01/02/2024"), AGORA)
    assert lead["temperatura"] == "frio"


@pytest.mark.parametrize("texto,esperado", [
    ("+55 63 99999-1234", "63999991234"),
    ("(63) 99999-1234", "63999991234"),
    ("1234", None),
    (None, None),
])
def test_telefone_busca(texto, esperado):
    assert imp.telefone_busca(texto) == esperado


def test_primeira_importacao_le_tudo():
    assert imp.paginas_a_ler(27832, 0, False) == (1, 1392)


def test_completa_retoma_do_checkpoint():
    assert imp.paginas_a_ler(27832, 27832, True, checkpoint=700) == (700, 1392)
    assert imp.paginas_a_ler(100, 0, True, checkpoint=999) == (5, 5)  # checkpoint além do fim


def test_incremental_le_so_o_fim():
    inicio, fim = imp.paginas_a_ler(1000, 900, False)
    assert fim == 50 and inicio == 44  # página do último conhecido (45) menos uma de folga
    assert imp.paginas_a_ler(1000, 1000, False) == (49, 50)  # nada novo: relê o fim


def test_filtro_clientes_combina_condicoes():
    tid, resp = uuid4(), uuid4()
    onde, p = CrmService._filtro_clientes(tid, "Maria 63 99999", str(resp), "imoview", "quente")
    assert "l.corretor_id = :resp" in onde and "l.origem = :origem" in onde and "l.temperatura = :temp" in onde
    assert p["fone"] == "%6399999%" and p["termo"] == "%Maria 63 99999%"


def test_filtro_sem_responsavel_e_temperatura_invalida_ignorada():
    onde, p = CrmService._filtro_clientes(uuid4(), None, "sem", None, "gelado")
    assert "corretor_id IS NULL" in onde and "temperatura" not in onde and "termo" not in p


def test_filtro_rejeita_responsavel_que_nao_e_uuid():
    with pytest.raises(ValueError):
        CrmService._filtro_clientes(uuid4(), None, "'; DROP TABLE crm_leads;--", None, None)
