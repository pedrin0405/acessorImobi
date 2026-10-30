"""Funil automático e ficha do cliente: cadastro do Imoview sem dados sensíveis e filtros do quadro."""
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.domain.crm import importacao_imoview as imp
from app.domain.crm.service import CrmService

AGORA = datetime(2026, 10, 30, 15, 0, tzinfo=timezone.utc)

BRUTO = {
    "codigo": 10795, "tipo": "Física", "nome": "Rogerio Porto", "cpfoucnpj": "008.687.851-48", "datanascimento": "22/03/1985",
    "sexo": "Masculino", "estadocivil": "Casado(a)", "profissao": "Engenheiro", "rendamensal": 12000.5, "fgts": 0,
    "filiacaopai": "Fulano", "filiacaomae": "Fulana", "instagram": "https://instagram.com/rogerio", "facebook": "",
    "datainclusao": "05/12/2022 09:23", "dataultimaalteracao": "27/12/2022 15:28",
    "telefones": [{"tipo": "Celular", "numero": "(62) 9699-2060"}],
    "emails": [{"tipo": "Comercial", "email": "rogerionporto@gmail.com"}],
    "enderecos": [{"tipo": "Residencial", "endereco": "Avenida Goiás, 1530", "bairro": "Setor Central", "cidade": "Gurupi", "estado": "TO", "cep": "77410-010"}],
    "relacionamentos": [{"lead": 2}, {"locador": 0}, {"comprador": 1}],
    "documentos": [{"tipo": "RG", "numero": "123"}],
}


def test_cadastro_guarda_o_util_e_descarta_dados_sensiveis():
    dados = imp.dados_cadastrais(BRUTO)
    assert dados["profissao"] == "Engenheiro" and dados["estado_civil"] == "Casado(a)"
    assert dados["renda_mensal"] == 12000.5 and "fgts" not in dados  # zero não entra
    assert dados["enderecos"][0]["cidade"] == "Gurupi"
    assert dados["redes"] == {"instagram": "https://instagram.com/rogerio"}
    assert dados["relacionamentos"] == {"lead": 2, "comprador": 1}
    texto = str(dados)
    for proibido in ("008.687.851-48", "Fulano", "Fulana", "cpfoucnpj", "documentos", "RG"):
        assert proibido not in texto


def test_lead_vazio_gera_cadastro_vazio():
    assert imp.dados_cadastrais({"codigo": 1, "nome": "Ana", "telefones": [{"tipo": "", "numero": ""}], "rendamensal": "x"}) == {}


def test_normalizar_lead_traz_o_cadastro():
    lead = imp.normalizar_lead(BRUTO, AGORA)
    assert lead["dados"]["sexo"] == "Masculino" and lead["codigo"] == 10795


def test_filtro_negocios_por_corretor_etapa_e_telefone():
    tid, corretor, etapa = uuid4(), uuid4(), uuid4()
    onde, p = CrmService._filtro_negocios(tid, "aberto", str(corretor), "Maria 63 99999", str(etapa))
    assert "n.corretor_id = :cid" in onde and "n.etapa_id = :eid" in onde and "l.telefone_busca LIKE :fone" in onde
    assert p["status"] == "aberto" and p["fone"] == "%6399999%"


def test_filtro_negocios_sem_responsavel_e_todos_os_status():
    onde, p = CrmService._filtro_negocios(uuid4(), None, "sem", None)
    assert "n.corretor_id IS NULL" in onde and "n.status" not in onde and "termo" not in p


def test_filtro_negocios_rejeita_id_invalido():
    with pytest.raises(ValueError):
        CrmService._filtro_negocios(uuid4(), "aberto", "x'; DROP TABLE crm_negocios;--", None)
    with pytest.raises(ValueError):
        CrmService._filtro_negocios(uuid4(), "aberto", None, None, "nao-e-uuid")
