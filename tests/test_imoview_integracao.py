import asyncio
from uuid import UUID, uuid4

import pytest

from app.domain.imovel import consulta, sync
from app.integration.imoview import seguranca
from app.integration.imoview.client import ImoviewAuthError


# --- SSRF e máscara ------------------------------------------------------------

@pytest.mark.parametrize("url", [
    "http://api.imoview.com.br",            # sem HTTPS
    "https://localhost",
    "https://127.0.0.1",
    "https://169.254.169.254",              # metadados de nuvem
    "https://10.0.0.5",
    "https://servidor",                     # nome sem ponto
    "https://painel.local",
    "https://app.internal",
    "https://usuario:senha@api.imoview.com.br",
    "https://api.imoview.com.br:8443",
    "https://api.imoview.com.br/v1/imoveis",
    "https://api.imoview.com.br?x=1",
    "ftp://api.imoview.com.br",
    "",
    "https://" + "a" * 300 + ".com",
])
def test_url_base_invalida(url):
    with pytest.raises(seguranca.UrlInvalida):
        seguranca.normalizar_base_url(url)


def test_url_base_valida_e_normalizada():
    assert seguranca.normalizar_base_url("https://API.imoview.com.br/") == "https://api.imoview.com.br"
    assert seguranca.normalizar_base_url("api.imoview.com.br") == "https://api.imoview.com.br"
    assert seguranca.normalizar_base_url("https://api.imoview.com.br:443") == "https://api.imoview.com.br"


@pytest.mark.parametrize("endereco", ["10.1.2.3", "127.0.0.1", "169.254.169.254", "192.168.0.10", "::1", "fd00::1"])
def test_dns_para_rede_interna_e_recusado(monkeypatch, endereco):
    async def resolver(host):
        return [endereco]

    monkeypatch.setattr(seguranca, "_resolver", resolver)
    with pytest.raises(seguranca.UrlInvalida):
        asyncio.run(seguranca.validar_base_url("https://api.imoview.com.br"))


def test_dns_misto_com_um_endereco_interno_e_recusado(monkeypatch):
    async def resolver(host):
        return ["8.8.8.8", "10.0.0.1"]

    monkeypatch.setattr(seguranca, "_resolver", resolver)
    with pytest.raises(seguranca.UrlInvalida):
        asyncio.run(seguranca.validar_base_url("https://api.imoview.com.br"))


def test_dns_publico_e_aceito_e_falha_de_dns_vira_erro_amigavel(monkeypatch):
    async def publico(host):
        return ["8.8.8.8"]

    async def falha(host):
        raise OSError("nome não resolve")

    monkeypatch.setattr(seguranca, "_resolver", publico)
    assert asyncio.run(seguranca.validar_base_url("https://api.imoview.com.br")) == "https://api.imoview.com.br"
    monkeypatch.setattr(seguranca, "_resolver", falha)
    with pytest.raises(seguranca.UrlInvalida, match="resolver"):
        asyncio.run(seguranca.validar_base_url("https://api.imoview.com.br"))


def test_mascarar_chave_nunca_mostra_a_chave_inteira():
    assert seguranca.mascarar_chave("") == ""
    assert seguranca.mascarar_chave("curta") == "••••"
    chave = "abcdef0123456789SEGREDO1234"
    mascarada = seguranca.mascarar_chave(chave)
    assert mascarada.endswith("1234") and "SEGREDO" not in mascarada and chave not in mascarada


def test_mensagem_de_erro_nao_vaza_detalhes():
    msg = sync.mensagem_de_erro(ImoviewAuthError("chave=XYZ123 inválida"))
    assert "XYZ123" not in msg and "chave" in msg.lower()
    assert "inesperado" in sync.mensagem_de_erro(RuntimeError("senha=abc"))
    assert "abc" not in sync.mensagem_de_erro(RuntimeError("senha=abc"))


# --- Conversões e normalização -------------------------------------------------

def test_conversoes_do_imoview():
    assert sync.numero_br("R$ 2.000.000,00") == 2_000_000.0
    assert sync.numero_br("117,00") == 117.0
    assert sync.numero_br("1.234,56") == 1234.56
    assert sync.numero_br("1.500.000") == 1_500_000.0
    assert sync.numero_br("") is None and sync.numero_br(None) is None and sync.numero_br(True) is None
    assert sync.inteiro("3") == 3 and sync.inteiro("") is None
    assert sync.data_br("24/10/2026 09:31:32").startswith("2026-10-24T09:31:32")
    assert sync.data_br("lixo") is None
    assert sync.sem_acento("  Plano  Diretor SÚL, São Paulo ") == "plano diretor sul, sao paulo"


IMOVEL = {
    "codigo": 16873, "titulo": "APARTAMENTO | 3 SUÍTES ", "tipo": "Apartamento", "finalidade": "Venda",
    "situacao": "Vago/Disponível", "valor": "R$ 2.000.000,00", "valorcondominio": "R$ 1.680,00",
    "bairro": "Plano Diretor Norte", "cidade": "Palmas", "estado": "TO", "cep": "77001-036",
    "endereco": "Quadra ACNO 11", "numero": "204", "numeroquartos": "3", "numerovagas": "3",
    "numerobanhos": "5", "numerosuites": "3", "areaprincipal": "117,00", "anoconstrucao": 1900,
    "piscina": True, "churrasqueira": True, "academia": False, "descricao": "Lindo apartamento",
    "destaque": "Destaque", "urlpublica": "", "urlfotoprincipal": "https://cdn.imoview.com.br/a.jpg",
    "fotos": [{"url": "https://cdn.imoview.com.br/a.jpg", "descricao": "Sala"}, {"url": "http://inseguro/x.jpg"}],
    "extras": [{"nome": "Churrasqueira"}, "Playground"], "datahoracadastro": "28/08/2026 15:31:44",
}


def test_normalizar_imovel_extrai_colunas_e_extras():
    n = sync.normalizar_imovel(IMOVEL, "venda")
    assert n["codigo"] == 16873 and n["valor"] == 2_000_000.0 and n["valor_condominio"] == 1680.0
    assert (n["quartos"], n["vagas"], n["banheiros"], n["suites"]) == (3, 3, 5, 3)
    assert n["area_m2"] == 117.0 and n["estado"] == "TO" and n["destaque"] is True
    assert n["link"] is None
    assert "apartamento" in n["busca"] and "plano diretor norte" in n["busca"] and "16873" in n["busca"]
    extras = n["extras"]
    assert extras["foto_url"] == "https://cdn.imoview.com.br/a.jpg"
    assert [f["url"] for f in extras["fotos"]] == ["https://cdn.imoview.com.br/a.jpg"]  # http é descartado
    assert extras["caracteristicas"] == ["Churrasqueira", "Piscina"] or set(extras["caracteristicas"]) == {"Piscina", "Churrasqueira"}
    assert extras["extras"] == ["Churrasqueira", "Playground"]
    assert extras["descricao"] == "Lindo apartamento" and extras["hash"] == n["hash"]
    assert "ano_construcao" not in extras  # 1900 é valor vazio do Imoview


def test_hash_muda_so_quando_o_conteudo_muda():
    a = sync.normalizar_imovel(IMOVEL, "venda")
    b = sync.normalizar_imovel(dict(IMOVEL), "venda")
    c = sync.normalizar_imovel({**IMOVEL, "valor": "R$ 1.900.000,00"}, "venda")
    assert a["hash"] == b["hash"] != c["hash"]
    assert sync.normalizar_imovel({"codigo": 0}, "venda") is None


# --- Filtros -------------------------------------------------------------------

def test_montar_filtros_gera_condicoes_e_parametros():
    tid = uuid4()
    onde, p = consulta.montar_filtros(tid, {
        "busca": "Palmas Sao", "finalidade": "venda", "tipo": "Apartamento,Casa", "bairro": "Graciosa",
        "quartos_min": 2, "valor_min": 100000, "valor_max": 500000, "area_min": 50, "destaque": True,
    })
    assert "ativo = TRUE" in onde and "busca ILIKE :b0" in onde and "busca ILIKE :b1" in onde
    assert p["b0"] == "%palmas%" and p["b1"] == "%sao%"
    assert p["tipo"] == ["Apartamento", "Casa"] and p["quartos_min"] == 2 and p["valor_max"] == 500000.0
    assert "destaque = TRUE" in onde and "area_m2 >= :area_min" in onde

    sem_tipo, p2 = consulta.montar_filtros(tid, {"tipo": "Casa", "valor_min": 1}, ignorar=("tipo", "valor"))
    assert "tipo" not in sem_tipo and "valor" not in sem_tipo and "tipo" not in p2

    inativos, _ = consulta.montar_filtros(tid, {"incluir_inativos": True})
    assert "ativo" not in inativos
    # entrada maliciosa só vira parâmetro, nunca texto da consulta
    perigoso, p3 = consulta.montar_filtros(tid, {"busca": "'; DROP TABLE imoveis_cache; --"})
    assert "DROP" not in perigoso and "drop" in " ".join(str(v) for v in p3.values())


def test_texto_para_compartilhar():
    item = {
        "codigo": 16873, "tipo": "Apartamento", "bairro": "Plano Diretor Norte", "cidade": "Palmas", "quartos": 3,
        "suites": 3, "vagas": 2, "area_m2": 117.0, "valor": 2_000_000.0, "valor_condominio": 1680.0,
        "finalidade": "venda", "link": "https://exemplo.com/i/16873",
    }
    texto = consulta.texto_compartilhar(item, {})
    assert "*Apartamento* no bairro *Plano Diretor Norte* - Palmas" in texto
    assert "3 quarto(s) • 3 suíte(s) • 2 vaga(s) • 117 m²" in texto
    assert "Venda: *R$ 2.000.000*" in texto and "Código: 16873" in texto and texto.endswith("https://exemplo.com/i/16873")
    aluguel = consulta.texto_compartilhar({**item, "finalidade": "aluguel", "valor": 3500.0, "link": None}, {})
    assert "Aluguel: *R$ 3.500/mês*" in aluguel


# --- Banco: sincronização, status e consulta ---------------------------------------

class ClienteFalso:
    """Imita o Imoview: páginas de até `registros` imóveis por finalidade."""

    def __init__(self, venda, aluguel, erro=None):
        self.dados = {2: venda, 1: aluguel}
        self.erro = erro

    async def buscar_imoveis(self, finalidade, pagina=1, registros=20, extra_filters=None):
        if self.erro:
            raise self.erro
        todos = self.dados[finalidade]
        fatia = todos[(pagina - 1) * registros: pagina * registros]
        return {"quantidade": len(todos), "lista": fatia}


def _imovel(codigo, **mudancas):
    base = {**IMOVEL, "codigo": codigo, "fotos": [], "urlfotoprincipal": "", "extras": []}
    base.update(mudancas)
    return base


def _soltar_pools_de_outro_loop() -> None:
    """Pools de banco/Redis são singletons presos ao event loop em que nasceram; testes async de
    arquivos diferentes rodam em loops diferentes. Solta os pools sem fechar conexões do loop morto."""
    from app.shared import database
    from app.shared.redis import get_redis_pool

    database.engine.sync_engine.dispose(close=False)
    get_redis_pool.cache_clear()


def _banco_disponivel() -> bool:
    """Postgres e Redis alcançáveis? (checagem por porta, sem abrir pools que prendam o event loop)."""
    import socket
    from urllib.parse import urlsplit

    from app.shared.config import get_settings

    cfg = get_settings()
    for url in (cfg.database_url, cfg.redis_url):
        partes = urlsplit(url)
        try:
            socket.create_connection((partes.hostname, partes.port), timeout=2).close()
        except OSError:
            return False
    return True


@pytest.mark.skipif(not _banco_disponivel(), reason="Postgres/Redis indisponíveis (rode com scripts/dev/py.sh)")
@pytest.mark.asyncio
async def test_sincronizacao_status_e_consulta_com_banco():
    from sqlalchemy import text
    from app.shared.database import get_admin_session, get_session
    from app.shared.redis import get_redis_pool

    _soltar_pools_de_outro_loop()
    slug = f"teste-{uuid4().hex[:10]}"
    async with get_admin_session() as s:
        tid: UUID = (await s.execute(
            text("INSERT INTO tenants (nome, slug) VALUES ('Teste Imoveis', :slug) RETURNING id"), {"slug": slug}
        )).scalar()
    redis = get_redis_pool()
    try:
        venda = [
            _imovel(1001, bairro="Plano Diretor Sul", valor="R$ 500.000,00", numeroquartos="2", areaprincipal="80,00"),
            _imovel(1002, bairro="Graciosa", valor="R$ 900.000,00", numeroquartos="3", areaprincipal="120,00", tipo="Casa"),
            _imovel(1003, bairro="São José", valor="R$ 300.000,00", numeroquartos="1", areaprincipal="40,00"),
        ]
        aluguel = [
            _imovel(2001, bairro="Graciosa", valor="R$ 3.500,00", numeroquartos="2", areaprincipal="70,00"),
            _imovel(2002, bairro="Plano Diretor Sul", valor="R$ 2.000,00", numeroquartos="1", areaprincipal="45,00"),
        ]

        # 1) primeira leitura: tudo novo; status com contagens
        r = await sync.sincronizar_tenant(tid, cliente=ClienteFalso(venda, aluguel))
        assert r["ok"] and (r["novos"], r["atualizados"], r["desativados"], r["processados"]) == (5, 0, 0, 5)
        async with get_session(tid) as s:
            st = await sync.obter_status(s, tid)
        assert st["estado"] == "ok" and st["imoveis_ativos"] == 5 and st["ultimo_sucesso_em"] and not st["erro"]

        # 2) segunda leitura idêntica: nada é regravado
        r = await sync.sincronizar_tenant(tid, cliente=ClienteFalso(venda, aluguel))
        assert (r["novos"], r["atualizados"], r["desativados"]) == (0, 0, 0)

        # 3) um preço muda e um imóvel some: 1 atualizado, 1 desativado (não apagado)
        venda2 = [_imovel(1001, bairro="Plano Diretor Sul", valor="R$ 450.000,00", numeroquartos="2", areaprincipal="80,00"), venda[1]]
        r = await sync.sincronizar_tenant(tid, cliente=ClienteFalso(venda2, aluguel))
        assert (r["novos"], r["atualizados"], r["desativados"]) == (0, 1, 1)
        async with get_session(tid) as s:
            total_ativos = (await s.execute(text("SELECT count(*) FROM imoveis_cache WHERE tenant_id=:t AND ativo"), {"t": str(tid)})).scalar()
            total_todos = (await s.execute(text("SELECT count(*) FROM imoveis_cache WHERE tenant_id=:t"), {"t": str(tid)})).scalar()
            lista = await consulta.listar(s, tid, {}, por_pagina=10)
            com_inativos = await consulta.listar(s, tid, {"incluir_inativos": True}, por_pagina=10)
        assert (total_ativos, total_todos) == (4, 5)
        assert lista["total"] == 4 and com_inativos["total"] == 5

        # 4) filtros, ordenação, paginação e facetas
        async with get_session(tid) as s:
            so_venda = await consulta.listar(s, tid, {"finalidade": "venda"}, ordem="valor_desc", por_pagina=10)
            assert [i["codigo"] for i in so_venda["itens"]] == [1002, 1001]
            graciosa = await consulta.listar(s, tid, {"bairro": "Graciosa", "quartos_min": 2}, por_pagina=10)
            assert sorted(i["codigo"] for i in graciosa["itens"]) == [1002, 2001]
            faixa = await consulta.listar(s, tid, {"valor_min": 400000, "valor_max": 600000}, por_pagina=10)
            assert [i["codigo"] for i in faixa["itens"]] == [1001]
            acento = await consulta.listar(s, tid, {"busca": "sul"}, por_pagina=10)
            assert sorted(i["codigo"] for i in acento["itens"]) == [1001, 2002]
            por_codigo = await consulta.listar(s, tid, {"busca": "2001"}, por_pagina=10)
            assert por_codigo["itens"][0]["codigo"] == 2001
            p1 = await consulta.listar(s, tid, {}, ordem="codigo_desc", pagina=1, por_pagina=3)
            p2 = await consulta.listar(s, tid, {}, ordem="codigo_desc", pagina=2, por_pagina=3)
            assert (p1["paginas"], p1["total"]) == (2, 4)
            assert [i["codigo"] for i in p1["itens"]] + [i["codigo"] for i in p2["itens"]] == [2002, 2001, 1002, 1001]
            casas = await consulta.listar(s, tid, {"tipo": "Casa"}, por_pagina=10)
            assert casas["total"] == 1
            fac = casas["facetas"]
            # a faceta de tipo ignora o próprio filtro: mostra Casa e Apartamento
            assert {f["valor"] for f in fac["tipo"]} == {"Casa", "Apartamento"}
            assert {f["valor"]: f["quantidade"] for f in fac["finalidade"]} == {"venda": 1}
            assert fac["faixas"]["valor_min"] == 900000.0
            detalhe = await consulta.obter_detalhe(s, tid, 1002, cliente=ClienteFalso([], []))
            assert detalhe["codigo"] == 1002 and detalhe["descricao"] == "Lindo apartamento" and "texto_compartilhar" in detalhe
            assert await consulta.obter_detalhe(s, tid, 999999) is None

        # 5) leitura que perderia a maior parte do cache não desativa nada
        muitos = [_imovel(3000 + i) for i in range(30)]
        await sync.sincronizar_tenant(tid, cliente=ClienteFalso(muitos, []))
        r = await sync.sincronizar_tenant(tid, cliente=ClienteFalso(muitos[:3], []))
        assert r["ok"] and r["desativados"] == 0 and r["aviso"]

        # 6) falha do Imoview vira status 'erro' legível, sem apagar o que já havia
        r = await sync.sincronizar_tenant(tid, cliente=ClienteFalso([], [], erro=ImoviewAuthError("chave=SEGREDO")))
        assert not r["ok"] and "SEGREDO" not in r["erro"]
        async with get_session(tid) as s:
            st = await sync.obter_status(s, tid)
        assert st["estado"] == "erro" and "chave" in st["erro"].lower() and st["imoveis_ativos"] > 0 and st["ultimo_sucesso_em"]

        # 7) trava: com uma sincronização em andamento, outra é ignorada
        await redis.set(sync.CHAVE_LOCK.format(tid), "outro", ex=60)
        assert (await sync.sincronizar_tenant(tid, cliente=ClienteFalso([], [])))["ignorado"] is True
        assert await sync.solicitar_sync(tid) == "executando"
        await redis.delete(sync.CHAVE_LOCK.format(tid))
        assert await sync.solicitar_sync(tid) == "na_fila"
        assert str(tid) in await redis.smembers(sync.CHAVE_PEDIDOS)
        async with get_session(tid) as s:
            assert (await sync.obter_status(s, tid))["estado"] == "na_fila"

        # 8) sem credenciais, a sincronização real falha com mensagem clara
        await redis.srem(sync.CHAVE_PEDIDOS, str(tid))
        r = await sync.sincronizar_tenant(tid)
        assert not r["ok"] and "configurada" in r["erro"]
    finally:
        await redis.srem(sync.CHAVE_PEDIDOS, str(tid))
        await redis.delete(sync.CHAVE_LOCK.format(tid))
        async with get_admin_session() as s:
            await s.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": str(tid)})
        await get_redis_pool().aclose()
        _soltar_pools_de_outro_loop()
