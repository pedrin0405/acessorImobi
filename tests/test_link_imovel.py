"""Link do imóvel no site da imobiliária."""
import pytest

from app.domain.imovel.link import link_do_site, normalizar_base, slug
from app.domain.imovel.sync import normalizar_imovel

BASE = "https://www.quadrabrasileira.com.br"


def test_exemplo_do_site():
    assert link_do_site(BASE, 15746, "SOBRADO | 3 SUITES | PISCINA") == f"{BASE}/imovel/sobrado-3-suites-piscina/15746"


def test_slug_sem_acento_e_sem_simbolos():
    assert slug("CASA | 163m² | 3Q SENDO 2 SUÍTES | ÁREA GOURMET") == "casa-163m2-3q-sendo-2-suites-area-gourmet"


def test_slug_limitado():
    assert len(slug("a" * 300)) <= 80 and not slug("a" * 300).endswith("-")


def test_sem_titulo_usa_tipo_e_bairro():
    assert link_do_site(BASE, 10, None, "Casa", "Plano Diretor Sul") == f"{BASE}/imovel/casa-plano-diretor-sul/10"


def test_sem_site_ou_codigo_nao_gera():
    assert link_do_site(None, 10, "x") is None and link_do_site(BASE, 0, "x") is None


@pytest.mark.parametrize("entrada,esperado", [
    ("www.quadrabrasileira.com.br/", BASE),
    ("HTTP://Quadrabrasileira.com.br/qualquer/coisa", "http://quadrabrasileira.com.br"),
    ("", None), ("sem espaço.com", None), ("localhost", None),
])
def test_normalizar_base(entrada, esperado):
    assert normalizar_base(entrada) == esperado


def test_normalizar_imovel_monta_link_e_respeita_urlpublica():
    bruto = {"codigo": 15746, "titulo": "SOBRADO | 3 SUITES | PISCINA", "tipo": "Sobrado", "bairro": "Plano Diretor Sul", "valor": "900000"}
    assert normalizar_imovel(bruto, "venda", BASE)["link"] == f"{BASE}/imovel/sobrado-3-suites-piscina/15746"
    assert normalizar_imovel(bruto, "venda")["link"] is None
    assert normalizar_imovel({**bruto, "urlpublica": "https://outro.com/x"}, "venda", BASE)["link"] == "https://outro.com/x"
