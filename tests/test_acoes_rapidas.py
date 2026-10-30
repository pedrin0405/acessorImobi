"""Ações rápidas da conversa: texto dos imóveis e ficha do lead enviados ao corretor."""
from datetime import datetime, timezone
from uuid import uuid4

from app.domain.conversa import acoes_rapidas as ar


def _lead(**extra):
    base = {
        "id": uuid4(), "nome": " Maria Souza ", "telefone": "5563999991234", "email": "maria@exemplo.com",
        "origem": "imoview", "temperatura": "quente", "corretor_nome": "Pedro Augusto",
        "perfil": {"interesse": ["comprar"], "tipos": ["apartamento"], "quartos_min": 2, "valor_max": 500000},
        "observacoes": "Prefere ligar à tarde.", "ultimo_contato": datetime(2026, 10, 12, tzinfo=timezone.utc),
        "cpf": "123.456.789-00", "cnpj": "00.000.000/0001-00",
    }
    return {**base, **extra}


def test_ficha_completa_e_formatada():
    texto = ar.texto_lead(ar.ficha_do_lead(_lead()))
    assert "*Cliente: Maria Souza*" in texto
    assert "(63) 99999-1234" in texto
    assert "maria@exemplo.com" in texto
    assert "compra · apartamento · 2+ quartos · até R$ 500.000" in texto
    assert "Origem: Imoview · Interesse: quente" in texto
    assert "Responsável: Pedro Augusto" in texto
    assert "Último contato: 12/10/2026" in texto
    assert "Obs.: Prefere ligar à tarde." in texto


def test_ficha_nunca_leva_documento():
    ficha = ar.ficha_do_lead(_lead(observacoes=None))
    assert "123.456" not in str(ficha) and "cpf" not in ficha and "cnpj" not in ficha
    assert "123.456" not in ar.texto_lead(ficha)


def test_lead_sem_dono_perfil_ou_contato():
    ficha = ar.ficha_do_lead(_lead(corretor_nome=None, perfil={}, telefone=None, email=None, observacoes=None, ultimo_contato=None, origem="whatsapp_pessoal"))
    texto = ar.texto_lead(ficha)
    assert "Responsável: ainda sem corretor" in texto
    assert "Procura" not in texto and "📞" not in texto and "✉️" not in texto and "Último contato" not in texto
    assert "Origem: WhatsApp pessoal" in texto


def test_observacoes_longas_sao_cortadas():
    ficha = ar.ficha_do_lead(_lead(observacoes="x" * 1000))
    assert len(ficha["observacoes"]) == ar.MAX_OBSERVACOES


def test_telefone_formatos():
    assert ar.formatar_telefone("+55 (63) 3215-0000") == "(63) 3215-0000"
    assert ar.formatar_telefone("12345") == "12345"
    assert ar.formatar_telefone(None) == ""


def test_texto_do_imovel_traz_codigo_valor_e_link():
    item = {"codigo": 123, "tipo": "Apartamento", "bairro": "Orla", "cidade": "Palmas", "quartos": 2, "suites": 0, "vagas": 1,
            "area_m2": 80.0, "valor": 350000.0, "valor_condominio": None, "finalidade": "venda", "link": "https://x.com/123"}
    texto = ar.texto_imovel(item)
    assert "*Apartamento* no bairro *Orla*" in texto and "R$ 350.000" in texto and "Código: 123" in texto and "https://x.com/123" in texto
