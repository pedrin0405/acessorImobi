"""Regras das Configurações: listas, tipos de atividade, roleta, lembretes e imagens."""
import base64
from datetime import datetime, timedelta, timezone

import pytest

from app.domain.configuracoes import padroes
from app.domain.configuracoes.padroes import ConfigErro
from app.domain.crm.service import CrmService


def test_listas_padrao_e_validacao():
    padrao = padroes.listas_padrao()
    assert set(padrao) == set(padroes.LISTAS_PADRAO)
    assert all("custo_mensal" in i for i in padrao["origem_lead"])
    assert not any("custo_mensal" in i for i in padrao["motivo_perda"])

    ok = padroes.validar_lista("origem_lead", [{"nome": " Site ", "cor": "#4E80EE", "custo_mensal": "800"}, {"nome": "Indicação"}])
    assert ok[0]["nome"] == "Site" and ok[0]["custo_mensal"] == 800.0 and ok[1]["cor"].startswith("#")
    # Custo só existe onde a lista pede.
    assert "custo_mensal" not in padroes.validar_lista("motivo_perda", [{"nome": "Preço", "custo_mensal": 5}])[0]

    for ruim in ([{"nome": ""}], [{"nome": "A"}, {"nome": "a"}], [{"nome": "X", "cor": "vermelho"}], [{"nome": "x" * 61}]):
        with pytest.raises(ConfigErro):
            padroes.validar_lista("motivo_perda", ruim)
    with pytest.raises(ConfigErro):
        padroes.validar_lista("origem_lead", [{"nome": "A", "custo_mensal": -1}])
    with pytest.raises(ConfigErro):
        padroes.validar_lista("inexistente", [])


def test_tipos_de_atividade_protegem_os_do_sistema():
    base = padroes.tipos_atividade_padrao()
    assert [t["chave"] for t in base][:2] == ["visita", "reuniao"]

    # Renomear, esconder e criar tipo novo: a chave personalizada é gerada.
    editado = [{**t} for t in base]
    editado[0]["nome"] = "Visita ao imóvel"
    editado[1]["visivel"] = False
    editado.append({"chave": "", "nome": "Vistoria", "icone": "key", "cor": "#2F9E6B", "visivel": True})
    saida = padroes.validar_tipos_atividade(editado)
    assert saida[0]["nome"] == "Visita ao imóvel" and saida[1]["visivel"] is False
    nova = saida[-1]
    assert nova["chave"].startswith("custom_") and not nova["sistema"]

    # Os oito originais não podem sumir; ícone e nome repetido são recusados.
    with pytest.raises(ConfigErro):
        padroes.validar_tipos_atividade([t for t in base if t["chave"] != "visita"])
    with pytest.raises(ConfigErro):
        padroes.validar_tipos_atividade([{**t, "icone": "xpto"} if t["chave"] == "tarefa" else t for t in base])
    with pytest.raises(ConfigErro):
        padroes.validar_tipos_atividade([{**t, "nome": "Visita"} if t["chave"] == "reuniao" else t for t in base])
    # Tipo personalizado em uso não pode ser apagado.
    with pytest.raises(ConfigErro):
        padroes.validar_tipos_atividade(base, {nova["chave"]: 3})


def test_roleta_em_rodizio():
    assert padroes.proximo_da_fila([], None) is None
    fila = ["c", "a", "b"]
    assert padroes.proximo_da_fila(fila, None) == "a"
    assert padroes.proximo_da_fila(fila, "a") == "b"
    assert padroes.proximo_da_fila(fila, "c") == "a"          # volta ao início
    assert padroes.proximo_da_fila(fila, "saiu") == "a"       # quem saiu da fila não trava o rodízio
    assert padroes.validar_roleta({"ativa": 1, "participantes": [1, "x"]})["participantes"] == ["1", "x"]
    with pytest.raises(ConfigErro):
        padroes.validar_roleta({"modo": "aleatorio"})


def test_lembretes_validacao_texto_e_escolha_da_regra():
    tipos = ["visita", "reuniao"]
    regras = padroes.validar_lembretes(padroes.lembretes_padrao(), tipos)
    assert regras[0]["ligada"] and not regras[1]["ligada"]

    base = {**regras[0], "nome": "Teste", "tipo": "visita", "antecedencia_min": 120}
    for ruim in (
        {**base, "mensagem": "oi {{xpto}}"}, {**base, "antecedencia_min": 1}, {**base, "tipo": "naoexiste"},
        {**base, "janela_inicio": "20:00", "janela_fim": "08:00"}, {**base, "janela_inicio": "8h"}, {**base, "nome": ""},
    ):
        with pytest.raises(ConfigErro):
            padroes.validar_lembretes([ruim], tipos)

    texto = padroes.renderizar_lembrete(
        {"mensagem": "Oi, {{corretor.primeiro_nome}}! {{tipo_minusculo}} {{titulo}} às {{hora}}{{local_frase}} ."},
        {"corretor.primeiro_nome": "Pedro", "tipo_minusculo": "visita", "titulo": "com Ana", "hora": "10:00", "local": "Orla 14"},
    )
    assert texto == "Oi, Pedro! visita com Ana às 10:00, em Orla 14."
    # Sem local, a frase some por inteiro.
    assert padroes.renderizar_lembrete({"mensagem": "às {{hora}}{{local_frase}}."}, {"hora": "10:00"}) == "às 10:00."

    ligadas = [
        {"id": "a", "ligada": True, "tipo": "todos", "antecedencia_min": 60},
        {"id": "b", "ligada": True, "tipo": "visita", "antecedencia_min": 1440},
        {"id": "c", "ligada": False, "tipo": "reuniao", "antecedencia_min": 60},
    ]
    assert padroes.antecedencias_para(ligadas, "visita") == [1440, 60]
    assert padroes.antecedencias_para(ligadas, "reuniao") == [60]
    assert padroes.regra_do_lembrete(ligadas, "visita", 1440)["id"] == "b"
    assert padroes.regra_do_lembrete(ligadas, "visita", 60)["id"] == "a"
    assert padroes.regra_do_lembrete(ligadas, "reuniao", 1440) is None
    assert padroes.rotulo_antecedencia(1440) == "1 dia antes" and padroes.rotulo_antecedencia(120) == "2 horas antes"


def test_lembrete_da_atividade_segue_as_regras():
    agora = datetime.now(timezone.utc)
    regras = [
        {"ligada": True, "tipo": "todos", "antecedencia_min": 60},
        {"ligada": True, "tipo": "visita", "antecedencia_min": 1440},
    ]
    escolher = CrmService._lembrete_pelas_regras
    # Visita daqui a 3 dias: o lembrete de 1 dia cabe; daqui a 3 h só o de 1 hora; em 20 min nenhum cabe.
    assert escolher(regras, "visita", agora + timedelta(days=3)) == 1440
    assert escolher(regras, "visita", agora + timedelta(hours=3)) == 60
    assert escolher(regras, "visita", agora + timedelta(minutes=20)) == 0
    assert escolher(regras, "tarefa", agora + timedelta(days=3)) == 60
    assert escolher(regras, "visita", None) == 0
    assert escolher([{"ligada": False, "tipo": "todos", "antecedencia_min": 60}], "visita", agora + timedelta(days=1)) == 0


def test_imagens_e_documentos():
    pequena = "data:image/png;base64," + base64.b64encode(b"\x89PNG" * 10).decode()
    assert padroes.validar_imagem(pequena) == pequena and padroes.validar_imagem(None) is None
    for ruim in ("http://x/y.png", "data:text/html;base64,AAAA", "data:image/svg+xml;base64,AAAA", "data:image/png;base64," + "A" * 600_000):
        with pytest.raises(ConfigErro):
            padroes.validar_imagem(ruim)
    assert padroes.validar_documento("12.345.678/0001-95", "imobiliaria") == "12345678000195"
    assert padroes.validar_documento("123.456.789-09", "autonomo") == "12345678909"
    assert padroes.validar_documento("", "imobiliaria") == ""
    with pytest.raises(ConfigErro):
        padroes.validar_documento("123", "imobiliaria")
