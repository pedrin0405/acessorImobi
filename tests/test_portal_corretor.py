"""Portal do corretor: a mesma API da imobiliária, mas cada corretor só enxerga e mexe no que é dele."""
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text

from app.api.main import app
from app.shared.database import get_admin_session
from app.shared.security import create_access_token

pytestmark = pytest.mark.asyncio(loop_scope="module")


TELEFONES = {"a": "+559900000001", "b": "+559900000002", "c": "+559900000003"}


@pytest_asyncio.fixture(loop_scope="module")
async def cenario():
    """Três corretores de teste fixos (a e b ativos, c bloqueado), cada um com um cliente e um negócio.

    Ficam sempre os mesmos porque a auditoria é só de acréscimo e impede apagar corretor que já agiu."""
    async with get_admin_session() as s:
        tid = (await s.execute(text("SELECT id FROM tenants ORDER BY created_at LIMIT 1"))).scalar()
        etapa = (await s.execute(text("SELECT id FROM crm_etapas WHERE tenant_id = :t ORDER BY ordem LIMIT 1"), {"t": tid})).scalar()
        ids = {}
        for nome, tel in TELEFONES.items():
            status = "blocked" if nome == "c" else "active"
            cid = (await s.execute(
                text("""INSERT INTO corretores (tenant_id, telefone, nome, status) VALUES (:t, :tel, :n, :st)
                        ON CONFLICT (tenant_id, telefone) DO UPDATE SET status = EXCLUDED.status, nome = EXCLUDED.nome RETURNING id"""),
                {"t": tid, "tel": tel, "n": f"Teste {nome}", "st": status})).scalar()
            lid, nid = uuid4(), uuid4()
            await s.execute(text("INSERT INTO crm_leads (id, tenant_id, corretor_id, nome, telefone, origem, temperatura, status) "
                                 "VALUES (:i, :t, :c, :n, :tel, 'manual', 'morno', 'lead')"),
                            {"i": lid, "t": tid, "c": cid, "n": f"Cliente do {nome}", "tel": f"+5599{uuid4().int % 10**9:09d}"})
            await s.execute(text("INSERT INTO crm_negocios (id, tenant_id, corretor_id, lead_id, etapa_id, titulo, valor) VALUES (:i, :t, :c, :l, :e, :n, 1000)"),
                            {"i": nid, "t": tid, "c": cid, "l": lid, "e": etapa, "n": f"Negócio {nome}"})
            ids[nome] = {"corretor": cid, "lead": lid, "negocio": nid}
    yield tid, ids
    async with get_admin_session() as s:
        for v in ids.values():
            for tabela in ("crm_atividades", "crm_negocios", "crm_leads"):
                await s.execute(text(f"DELETE FROM {tabela} WHERE corretor_id = :c"), {"c": v["corretor"]})
        await s.execute(text("UPDATE corretores SET status = 'blocked' WHERE tenant_id = :t AND telefone = ANY(:tels)"), {"t": tid, "tels": list(TELEFONES.values())})


def _auth(tid, cid):
    t = create_access_token("+5500000000000", tenant_id=tid, role="corretor", corretor_id=cid)
    return {"Authorization": f"Bearer {t}"}


@pytest_asyncio.fixture(loop_scope="module")
async def cliente():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        yield c


async def test_corretor_so_ve_a_propria_carteira(cenario, cliente):
    tid, ids = cenario
    h = _auth(tid, ids["a"]["corretor"])
    r = await cliente.get("/admin/crm/clientes?por_pagina=100", headers=h)
    assert r.status_code == 200
    donos = {c["corretor_id"] for c in r.json()["itens"]} if "itens" in r.json() else set()
    assert donos <= {str(ids["a"]["corretor"])}
    # tentar enxergar a carteira de outro por parâmetro não funciona
    r = await cliente.get(f"/admin/crm/clientes?responsavel={ids['b']['corretor']}&por_pagina=100", headers=h)
    assert all(c["corretor_id"] == str(ids["a"]["corretor"]) for c in r.json()["itens"])
    r = await cliente.get(f"/admin/crm/funil?corretor={ids['b']['corretor']}&por_coluna=100", headers=h)
    nomes = [n["lead_nome"] for e in r.json()["etapas"] for n in e["negocios"]]
    assert "Cliente do b" not in nomes and "Cliente do a" in nomes


async def test_dados_de_outro_corretor_valem_404(cenario, cliente):
    tid, ids = cenario
    h, b = _auth(tid, ids["a"]["corretor"]), ids["b"]
    for metodo, url, corpo in (
        ("get", f"/admin/crm/clientes/{b['lead']}", None),
        ("get", f"/admin/crm/clientes/{b['lead']}/linha-do-tempo", None),
        ("patch", f"/admin/crm/clientes/{b['lead']}", {"observacoes": "x"}),
        ("get", f"/admin/crm/leads/{b['lead']}/match", None),
        ("get", f"/admin/crm/negocios/{b['negocio']}", None),
        ("get", f"/admin/crm/negocios/{b['negocio']}/completo", None),
        ("patch", f"/admin/crm/negocios/{b['negocio']}", {"valor": 5}),
        ("get", f"/admin/conversas/{b['corretor']}/mensagens", None),
        ("get", f"/admin/conversas/{b['corretor']}/detalhes", None),
        ("get", f"/admin/corretores/{b['corretor']}/painel", None),
        ("post", f"/admin/conversas/{b['corretor']}/acoes-rapidas/previa", {"tipo": "imoveis", "codigos": [1]}),
        ("post", f"/admin/conversas/{ids['a']['corretor']}/acoes-rapidas/previa", {"tipo": "lead", "lead_id": str(b["lead"])}),
    ):
        r = await getattr(cliente, metodo)(url, headers=h, **({"json": corpo} if corpo else {}))
        assert r.status_code == 404, (metodo, url, r.status_code)
    # o próprio continua acessível
    a = ids["a"]
    assert (await cliente.get(f"/admin/crm/clientes/{a['lead']}", headers=h)).status_code == 200
    assert (await cliente.get(f"/admin/crm/negocios/{a['negocio']}/completo", headers=h)).status_code == 200
    assert (await cliente.patch(f"/admin/crm/negocios/{a['negocio']}", headers=h, json={"valor": 2500})).status_code == 200


async def test_o_que_e_da_gestao_fica_fechado_ao_corretor(cenario, cliente):
    tid, ids = cenario
    h = _auth(tid, ids["a"]["corretor"])
    fechadas = [
        ("get", "/admin/configuracoes/equipe"), ("get", "/admin/configuracoes/roleta"), ("get", "/admin/configuracoes/resumo"),
        ("put", "/admin/configuracoes/imobiliaria"), ("get", "/admin/auditoria"), ("get", "/admin/pendencias"),
        ("get", "/admin/visao-geral"), ("put", "/admin/crm/etapas"), ("post", "/admin/crm/clientes/atribuir"),
        ("get", "/admin/integracoes/imoview"), ("put", "/admin/books/modelos/" + str(uuid4()) + "/padrao") if False else ("post", "/admin/books/modelos"),
        ("put", f"/admin/corretores/{ids['a']['corretor']}/roleta"), ("put", f"/admin/corretores/{ids['a']['corretor']}/situacao"),
        ("post", f"/admin/conversas/{ids['a']['corretor']}/enviar"), ("get", "/admin/agente/configuracao"),
    ]
    for metodo, url in fechadas:
        r = await getattr(cliente, metodo)(url, headers=h, **({"json": {}} if metodo in ("put", "post") else {}))
        assert r.status_code in (404, 405), (metodo, url, r.status_code)


async def test_listas_do_corretor(cenario, cliente):
    tid, ids = cenario
    h = _auth(tid, ids["a"]["corretor"])
    r = await cliente.get("/admin/corretores", headers=h)
    assert [c["id"] for c in r.json()] == [str(ids["a"]["corretor"])]
    r = await cliente.get("/admin/conversas", headers=h)
    assert {c["corretor_id"] for c in r.json()} <= {str(ids["a"]["corretor"])}
    for url in ("/admin/crm/etapas", "/admin/imoveis", "/admin/books/modelos", "/admin/configuracoes/tipos-atividade", "/admin/crm/forecast", "/admin/crm/agenda"):
        assert (await cliente.get(url, headers=h)).status_code == 200, url
    meu = await cliente.get("/admin/visao-geral/meu", headers=h)
    assert meu.status_code == 200 and meu.json()["carteira"]["total"] >= 1


async def test_criar_sempre_para_si(cenario, cliente):
    tid, ids = cenario
    h, a, b = _auth(tid, ids["a"]["corretor"]), ids["a"], ids["b"]
    r = await cliente.post("/admin/crm/leads", headers=h, json={"nome": "Lead novo", "corretor_id": str(b["corretor"])})
    assert r.status_code == 201 and r.json()["corretor_id"] == str(a["corretor"])
    r = await cliente.post("/admin/crm/atividades", headers=h, json={"corretor_id": str(b["corretor"]), "tipo": "visita", "titulo": "Visita"})
    assert r.status_code == 201, r.text
    assert r.json()["corretor_id"] == str(a["corretor"])
    atividade_alheia = await cliente.post("/admin/crm/atividades", headers=_auth(tid, b["corretor"]), json={"corretor_id": str(b["corretor"]), "tipo": "visita", "titulo": "Do B"})
    assert atividade_alheia.status_code == 201, atividade_alheia.text
    r = await cliente.patch(f"/admin/crm/atividades/{atividade_alheia.json()['id']}", headers=h, json={"status": "cancelada"})
    assert r.status_code == 404


async def test_corretor_bloqueado_perde_o_acesso(cenario, cliente):
    tid, ids = cenario
    r = await cliente.get("/admin/crm/etapas", headers=_auth(tid, ids["c"]["corretor"]))
    assert r.status_code == 401


async def test_equipe_continua_vendo_tudo(cenario, cliente):
    tid, ids = cenario
    async with get_admin_session() as s:
        aid = (await s.execute(text("SELECT id FROM tenant_admins WHERE tenant_id = :t LIMIT 1"), {"t": tid})).scalar()
    tok = create_access_token("admin", tenant_id=tid, role="admin", admin_id=aid)
    h = {"Authorization": f"Bearer {tok}"}
    r = await cliente.get("/admin/crm/clientes?por_pagina=100&termo=Cliente do", headers=h)
    nomes = {c["nome"] for c in r.json()["itens"]}
    assert {"Cliente do a", "Cliente do b"} <= nomes
    assert (await cliente.get("/admin/visao-geral/meu", headers=h)).status_code == 404


async def test_leads_do_imoview_sem_dono_vao_para_o_corretor_de_mesmo_nome(cenario):
    from app.domain.crm.atendimentos_imoview import vincular_corretores
    from app.shared.database import get_session
    tid, ids = cenario
    codigo = 987654321
    async with get_admin_session() as s:
        await s.execute(text("UPDATE corretores SET nome = 'Ítalo Vínculo Teste', status = 'active' WHERE id = :c"), {"c": ids["a"]["corretor"]})
        await s.execute(text("UPDATE crm_leads SET corretor_id = NULL, codigo_imoview = :cod WHERE id = :l"), {"cod": codigo, "l": ids["a"]["lead"]})
        await s.execute(text("UPDATE crm_negocios SET corretor_id = NULL WHERE id = :n"), {"n": ids["a"]["negocio"]})
        await s.execute(text("""INSERT INTO imoview_atendimentos (tenant_id, codigo, finalidade, lead_codigo, fase, situacao_tipo, corretor_nome)
                                VALUES (:t, :cod, 2, :cod, 1, 'em_atendimento', 'italo vinculo teste')
                                ON CONFLICT (tenant_id, codigo) DO UPDATE SET corretor_nome = EXCLUDED.corretor_nome"""), {"t": tid, "cod": codigo})
    async with get_session(tid) as s:
        assert await vincular_corretores(s, tid) >= 1
    async with get_admin_session() as s:
        dono = (await s.execute(text("SELECT corretor_id FROM crm_leads WHERE id = :l"), {"l": ids["a"]["lead"]})).scalar()
        neg = (await s.execute(text("SELECT corretor_id FROM crm_negocios WHERE id = :n"), {"n": ids["a"]["negocio"]})).scalar()
        await s.execute(text("DELETE FROM imoview_atendimentos WHERE tenant_id = :t AND codigo = :c"), {"t": tid, "c": codigo})
        await s.execute(text("UPDATE crm_leads SET codigo_imoview = NULL WHERE id = :l"), {"l": ids["a"]["lead"]})
        await s.execute(text("UPDATE corretores SET nome = 'Teste a' WHERE id = :c"), {"c": ids["a"]["corretor"]})
    assert dono == ids["a"]["corretor"] and neg == ids["a"]["corretor"]
