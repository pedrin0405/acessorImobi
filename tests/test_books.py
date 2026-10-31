"""Books de imóveis em PDF: configuração, modelos, geração e roteamento do agente."""
import io
from uuid import UUID, uuid4

import pytest

from app.domain.book import config as cfg
from app.domain.book.pdf import reais, renderizar
from app.domain.book.servico import _url_publica

IMOVEL = {
    "codigo": 10575, "titulo": "Galpão | Comercial | 4.100 m²", "finalidade": "venda", "tipo": "Galpão", "bairro": "Plano Diretor Expansão Sul",
    "cidade": "Palmas", "estado": "TO", "valor": 13000000.0, "valor_condominio": 800.0, "valor_iptu": 120.0, "quartos": 0, "suites": 0,
    "banheiros": 3, "vagas": 10, "area_m2": 4100.0, "descricao": "Galpão comercial amplo. " * 40, "caracteristicas": ["Ar-condicionado", "Escritório"],
    "extras": ["Piscina"], "endereco": {"logradouro": "Rua SR 9", "numero": "45"}, "link": "https://exemplo.com/imovel/10575", "_fotos": [],
}
EMPRESA = {"nome": "Quadra Brasileira ç ã é €", "telefone": "(63) 3000-0000", "email": "a@b.com", "site": "https://x.com", "creci": "123 TO", "logo": None}


def test_config_padrao_e_validacao():
    c = cfg.normalizar({"layout": "galeria", "cor_primaria": "#ABCDEF", "fotos_por_imovel": "3"})
    assert c["layout"] == "galeria" and c["cor_primaria"] == "#abcdef" and c["fotos_por_imovel"] == 3
    assert c["mostrar_capa"] is True  # o que não veio vem do padrão
    for ruim in ({"layout": "x"}, {"cor_primaria": "vermelho"}, {"fotos_por_imovel": 9}, {"fonte": "comic"}, {"titulo_capa": "a" * 200}):
        with pytest.raises(cfg.ConfigErro):
            cfg.normalizar(ruim)


def test_fabrica_valida_e_um_padrao():
    assert sum(1 for m in cfg.FABRICA if m["padrao"]) == 1
    for m in cfg.FABRICA:
        cfg.normalizar(m["config"])


@pytest.mark.parametrize("layout", ["classico", "galeria", "compacto"])
@pytest.mark.parametrize("capa", [True, False])
def test_renderiza_pdf_valido_sem_fotos_e_com_texto_exotico(layout, capa):
    config = cfg.normalizar({"layout": layout, "mostrar_capa": capa, "fonte": "classica" if capa else "moderna"})
    pdf = renderizar(config, [IMOVEL, {**IMOVEL, "codigo": 2, "titulo": None, "descricao": None}, {**IMOVEL, "codigo": 3}], EMPRESA, {"nome": "Pedro", "telefone": "(63) 99999-0000"}, "Imóveis 日本")
    assert pdf.startswith(b"%PDF") and len(pdf) > 2000


def test_renderiza_com_fotos_reais_e_corrompidas():
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (1200, 800), (30, 120, 200)).save(buf, "JPEG")
    im = {**IMOVEL, "_fotos": [buf.getvalue(), b"lixo-que-nao-e-imagem", buf.getvalue()]}
    for layout in ("classico", "galeria", "compacto"):
        assert renderizar(cfg.normalizar({"layout": layout}), [im], EMPRESA).startswith(b"%PDF")


def test_reais():
    assert reais(13000000) == "R$ 13.000.000" and reais(None) == "" and reais(0) == ""


@pytest.mark.parametrize("url,ok", [
    ("https://cdn.imoview.com.br/a.jpg", True), ("http://cdn.imoview.com.br/a.jpg", False), ("https://localhost/a.jpg", False),
    ("https://127.0.0.1/a.jpg", False), ("https://10.0.0.5/a.jpg", False), ("https://169.254.169.254/x", False),
    ("https://servico.internal/a.jpg", False), ("file:///etc/passwd", False), ("", False),
])
def test_so_baixa_foto_de_host_publico(url, ok):
    assert _url_publica(url) is ok


@pytest.mark.asyncio
async def test_modelos_crud_e_regras():
    from app.shared.database import get_admin_session
    from sqlalchemy import text
    from app.domain.book.modelos import ModelosBook
    from app.shared.database import get_session
    async with get_admin_session() as s:
        tid = (await s.execute(text("SELECT id FROM tenants LIMIT 1"))).scalar()
    async with get_session(tid) as s:
        m = ModelosBook(s)
        modelos = await m.listar(tid)
        assert len(modelos) >= 3 and sum(1 for x in modelos if x["padrao"]) == 1
        novo = await m.criar(tid, f"Teste {uuid4().hex[:6]}", {"layout": "galeria", "cor_primaria": "#112233"})
        assert novo["config"]["cor_primaria"] == "#112233" and not novo["sistema"]
        with pytest.raises(cfg.ConfigErro):
            await m.criar(tid, novo["nome"].upper(), {})  # nome repetido (sem diferenciar caixa)
        editado = await m.atualizar(tid, UUID(novo["id"]), novo["nome"] + "!", {"fotos_por_imovel": 2})
        assert editado["config"]["fotos_por_imovel"] == 2 and editado["config"]["cor_primaria"] == "#112233"
        padrao = next(x for x in modelos if x["padrao"])
        with pytest.raises(cfg.ConfigErro):
            await m.excluir(tid, UUID(padrao["id"]))  # padrão não se exclui
        fabrica = next(x for x in modelos if x["sistema"] and not x["padrao"])
        with pytest.raises(cfg.ConfigErro):
            await m.excluir(tid, UUID(fabrica["id"]))
        await m.definir_padrao(tid, UUID(novo["id"]))
        assert (await m.obter(tid, None))["id"] == novo["id"]
        await m.definir_padrao(tid, UUID(padrao["id"]))
        await m.excluir(tid, UUID(novo["id"]))
        assert (await m.obter(tid, UUID(novo["id"])))["id"] == padrao["id"]  # id inexistente cai no padrão
