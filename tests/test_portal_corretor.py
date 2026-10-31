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


async def test_notas_internas_da_equipe_nao_chegam_ao_corretor(cenario, cliente):
    tid, ids = cenario
    a = ids["a"]["corretor"]
    async with get_admin_session() as s:
        await s.execute(text("INSERT INTO conversa_notas (tenant_id, corretor_id, autor, texto) VALUES (:t, :c, 'gestor', 'nota secreta da equipe')"), {"t": tid, "c": a})
    try:
        r = await cliente.get(f"/admin/conversas/{a}/mensagens", headers=_auth(tid, a))
        assert r.status_code == 200 and "nota secreta" not in r.text
        async with get_admin_session() as s:
            aid = (await s.execute(text("SELECT id FROM tenant_admins WHERE tenant_id = :t LIMIT 1"), {"t": tid})).scalar()
        h = {"Authorization": "Bearer " + create_access_token("admin", tenant_id=tid, role="admin", admin_id=aid)}
        assert "nota secreta" in (await cliente.get(f"/admin/conversas/{a}/mensagens", headers=h)).text
    finally:
        async with get_admin_session() as s:
            await s.execute(text("DELETE FROM conversa_notas WHERE corretor_id = :c AND texto = 'nota secreta da equipe'"), {"c": a})


async def test_diagnostico_e_religar_assistente_reabre_a_leitura(cenario, cliente):
    tid, ids = cenario
    a = ids["a"]["corretor"]
    h = _auth(tid, a)
    async with get_admin_session() as s:
        await s.execute(text("UPDATE corretores SET assistente_config = CAST('{\"ativo\": false}' AS jsonb) WHERE id = :c"), {"c": a})
        await s.execute(text("DELETE FROM whatsapp_sessions WHERE corretor_id = :c"), {"c": a})
        await s.execute(text("""INSERT INTO whatsapp_sessions (tenant_id, corretor_id, tipo, instance_id, numero, status, historico_importado_ate)
                                VALUES (:t, :c, 'corretor', :i, '+559900000001', 'connected', NOW())"""), {"t": tid, "c": a, "i": f"teste_{a.hex[:12]}"})
    try:
        d = (await cliente.get("/corretor/atendimentos/diagnostico", headers=h)).json()
        assert d["whatsapp"] == "connected" and d["assistente_ativo"] is False and d["ultima_leitura_em"]
        assert (await cliente.post("/corretor/atendimentos/sincronizar", headers=h)).status_code == 409  # desligado
        r = await cliente.put("/corretor/assistente", headers=h, json={"ativo": True, "avisos": True, "carteira_auto": True})
        assert r.status_code == 200
        d = (await cliente.get("/corretor/atendimentos/diagnostico", headers=h)).json()
        assert d["assistente_ativo"] is True and d["ultima_leitura_em"] is None  # vai reler os últimos dias
    finally:
        async with get_admin_session() as s:
            await s.execute(text("DELETE FROM whatsapp_sessions WHERE corretor_id = :c"), {"c": a})


async def _com_atendimento(tid, ids, conectado=True):
    c = ids["a"]["corretor"]
    async with get_admin_session() as s:
        await s.execute(text("DELETE FROM whatsapp_sessions WHERE corretor_id = :c"), {"c": c})
        await s.execute(text("UPDATE corretores SET assistente_config = '{}'::jsonb WHERE id = :c"), {"c": c})
        await s.execute(text("""INSERT INTO whatsapp_sessions (tenant_id, corretor_id, tipo, instance_id, numero, status)
                                VALUES (:t, :c, 'corretor', :i, '+559900000001', :st)"""),
                        {"t": tid, "c": c, "i": f"teste_{c.hex[:12]}", "st": "connected" if conectado else "disconnected"})
        aid = (await s.execute(text("""INSERT INTO atendimentos (tenant_id, corretor_id, telefone_cliente, nome_contato, aguardando_corretor)
                                       VALUES (:t, :c, '+5563988887777', 'Cliente Teste', TRUE)
                                       ON CONFLICT (corretor_id, telefone_cliente) DO UPDATE SET aguardando_corretor = TRUE RETURNING id"""),
                                {"t": tid, "c": c})).scalar()
    return aid


async def _limpar_atendimento(ids):
    c = ids["a"]["corretor"]
    async with get_admin_session() as s:
        await s.execute(text("DELETE FROM atendimento_mensagens WHERE atendimento_id IN (SELECT id FROM atendimentos WHERE corretor_id = :c)"), {"c": c})
        await s.execute(text("DELETE FROM atendimentos WHERE corretor_id = :c"), {"c": c})
        await s.execute(text("DELETE FROM whatsapp_sessions WHERE corretor_id = :c"), {"c": c})


async def test_corretor_envia_mensagem_ao_cliente_pelo_proprio_whatsapp(cenario, cliente, monkeypatch):
    from app.integration.whatsapp import evolution
    enviados = []

    async def falso(self, instance_id, to, text):
        enviados.append((instance_id, to, text))
        return {"key": {"id": f"MSG{len(enviados)}"}}

    monkeypatch.setattr(evolution.EvolutionClient, "send_text", falso)
    tid, ids = cenario
    aid = await _com_atendimento(tid, ids)
    try:
        h = _auth(tid, ids["a"]["corretor"])
        r = await cliente.post(f"/corretor/atendimentos/{aid}/enviar", headers=h, json={"texto": "Oi, tudo bem?"})
        assert r.status_code == 200, r.text
        assert enviados == [(f"teste_{ids['a']['corretor'].hex[:12]}", "+5563988887777", "Oi, tudo bem?")]
        d = (await cliente.get(f"/corretor/atendimentos/{aid}", headers=h)).json()
        assert d["mensagens"][-1]["conteudo"] == "Oi, tudo bem?" and d["mensagens"][-1]["autor"] == "corretor"
        assert d["aguardando_corretor"] is False
        # outro corretor não envia pelo atendimento alheio
        r = await cliente.post(f"/corretor/atendimentos/{aid}/enviar", headers=_auth(tid, ids["b"]["corretor"]), json={"texto": "x"})
        assert r.status_code == 404
        assert (await cliente.post(f"/corretor/atendimentos/{aid}/enviar", headers=h, json={"texto": ""})).status_code == 422
    finally:
        await _limpar_atendimento(ids)


async def test_envio_exige_whatsapp_conectado(cenario, cliente):
    tid, ids = cenario
    aid = await _com_atendimento(tid, ids, conectado=False)
    try:
        r = await cliente.post(f"/corretor/atendimentos/{aid}/enviar", headers=_auth(tid, ids["a"]["corretor"]), json={"texto": "oi"})
        assert r.status_code == 409 and "conectado" in r.json()["detail"]
    finally:
        await _limpar_atendimento(ids)


async def test_analise_na_hora_explica_a_falha(cenario, cliente, monkeypatch):
    from app.domain.atendimento import analise as mod
    from app.integration.llm.gemini import GeminiError
    tid, ids = cenario
    aid = await _com_atendimento(tid, ids)
    try:
        async with get_admin_session() as s:
            await s.execute(text("INSERT INTO atendimento_mensagens (tenant_id, atendimento_id, message_id, autor, tipo, conteudo) VALUES (:t, :a, :m, 'cliente', 'text', 'Quero um apto')"),
                            {"t": tid, "a": aid, "m": f"t{uuid4().hex}"})

        class Quebrado:
            async def gerar_json(self, *a, **k):
                raise GeminiError("sem chave")

        monkeypatch.setattr(mod, "GeminiClient", Quebrado)
        h = _auth(tid, ids["a"]["corretor"])
        r = await cliente.post(f"/corretor/atendimentos/{aid}/analisar", headers=h)
        assert r.status_code == 503 and "Gemini" in r.json()["detail"]

        class Bom:
            async def gerar_json(self, *a, **k):
                return {"imobiliario": False, "resumo": "Cliente quer um apartamento.", "temperatura": "morno"}

        monkeypatch.setattr(mod, "GeminiClient", Bom)
        r = await cliente.post(f"/corretor/atendimentos/{aid}/analisar", headers=h)
        assert r.status_code == 200 and r.json()["analise"]["resumo"].startswith("Cliente quer")
        assert (await cliente.get(f"/corretor/atendimentos/{aid}", headers=h)).json()["analise"]["resumo"]
    finally:
        await _limpar_atendimento(ids)


async def test_sugerir_resposta_gera_na_hora(cenario, cliente, monkeypatch):
    from app.domain.atendimento import analise as mod
    from app.integration.llm.gemini import GeminiError
    tid, ids = cenario
    aid = await _com_atendimento(tid, ids)
    h = _auth(tid, ids["a"]["corretor"])
    try:
        assert (await cliente.post(f"/corretor/atendimentos/{aid}/sugerir-resposta", headers=h, json={})).status_code == 422  # sem mensagens
        async with get_admin_session() as s:
            await s.execute(text("INSERT INTO atendimento_mensagens (tenant_id, atendimento_id, message_id, autor, tipo, conteudo) VALUES (:t, :a, :m, 'cliente', 'text', 'Qual o valor do condomínio?')"),
                            {"t": tid, "a": aid, "m": f"t{uuid4().hex}"})
        visto = {}

        class Bom:
            async def gerar_json(self, sistema, conteudo, max_tokens=0):
                visto["conteudo"] = conteudo
                return {"sugestao": "Oi! O condomínio é [confirmar valor]."}

        monkeypatch.setattr(mod, "GeminiClient", Bom)
        r = await cliente.post(f"/corretor/atendimentos/{aid}/sugerir-resposta", headers=h, json={"instrucao": "mais formal"})
        assert r.status_code == 200 and r.json()["texto"].startswith("Oi!")
        assert "Qual o valor do condomínio?" in visto["conteudo"] and "mais formal" in visto["conteudo"]

        class Quebrado:
            async def gerar_json(self, *a, **k):
                raise GeminiError("x")

        monkeypatch.setattr(mod, "GeminiClient", Quebrado)
        assert (await cliente.post(f"/corretor/atendimentos/{aid}/sugerir-resposta", headers=h, json={})).status_code == 503
        assert (await cliente.post(f"/corretor/atendimentos/{aid}/sugerir-resposta", headers=_auth(tid, ids["b"]["corretor"]), json={})).status_code == 404
    finally:
        await _limpar_atendimento(ids)


async def test_corretor_define_o_tipo_do_contato_e_a_ia_respeita(cenario, cliente, monkeypatch):
    from app.domain.atendimento import analise as mod
    tid, ids = cenario
    aid = await _com_atendimento(tid, ids)
    h = _auth(tid, ids["a"]["corretor"])
    try:
        async with get_admin_session() as s:
            await s.execute(text("INSERT INTO atendimento_mensagens (tenant_id, atendimento_id, message_id, autor, tipo, conteudo) VALUES (:t, :a, :m, 'cliente', 'text', 'Vamos jantar sábado?')"),
                            {"t": tid, "a": aid, "m": f"t{uuid4().hex}"})
        chamadas = []

        class Ia:
            async def gerar_json(self, *a, **k):
                chamadas.append(1)
                return {"imobiliario": True, "resumo": "Quer imóvel", "temperatura": "morno"}

        monkeypatch.setattr(mod, "GeminiClient", Ia)
        # a IA achou imobiliário; o corretor corrige para pessoal
        assert (await cliente.post(f"/corretor/atendimentos/{aid}/analisar", headers=h)).status_code == 200
        r = await cliente.patch(f"/corretor/atendimentos/{aid}/tipo", headers=h, json={"tipo": "pessoal"})
        assert r.status_code == 200 and r.json()["imobiliario"] is False
        lista = (await cliente.get("/corretor/atendimentos?dias=30", headers=h)).json()
        assert aid.hex not in {x["id"].replace("-", "") for x in lista}  # some da lista padrão
        todos = (await cliente.get("/corretor/atendimentos?dias=30&todos=true", headers=h)).json()
        item = next(x for x in todos if x["id"] == str(aid))
        assert item["tipo_contato"] == "pessoal" and item["tipo_manual"] is True
        # com o tipo fixado, a análise não roda (sem gasto de IA) e não reclassifica
        antes = len(chamadas)
        assert (await cliente.post(f"/corretor/atendimentos/{aid}/analisar", headers=h)).status_code == 422
        assert len(chamadas) == antes
        # fixar imobiliário vence a IA mesmo se ela discordar
        await cliente.patch(f"/corretor/atendimentos/{aid}/tipo", headers=h, json={"tipo": "imobiliario"})
        assert aid in {__import__("uuid").UUID(x["id"]) for x in (await cliente.get("/corretor/atendimentos?dias=30", headers=h)).json()}
        # voltar ao automático
        r = await cliente.patch(f"/corretor/atendimentos/{aid}/tipo", headers=h, json={"tipo": None})
        assert r.json()["tipo_manual"] is False
        # outro corretor não mexe
        assert (await cliente.patch(f"/corretor/atendimentos/{aid}/tipo", headers=_auth(tid, ids["b"]["corretor"]), json={"tipo": "pessoal"})).status_code == 404
    finally:
        await _limpar_atendimento(ids)


async def test_foto_e_nome_do_contato(cenario, cliente, monkeypatch):
    from app.integration.whatsapp import evolution
    from app.shared import storage
    guardados = {}

    async def foto(self, instance_id, number):
        return "https://cdn.exemplo.com/foto.jpg"

    async def contato(self, instance_id, number):
        return {"pushName": "Maria da Silva"}

    async def baixar(url):
        return b"\xff\xd8\xff fake-jpeg", "image/jpeg"

    async def guardar(chave, dados, tipo):
        guardados[chave] = dados
        return "s3:" + chave

    async def ler(ref):
        return guardados[ref[3:]], "image/jpeg"

    monkeypatch.setattr(evolution.EvolutionClient, "fetch_profile_picture_url", foto)
    monkeypatch.setattr(evolution.EvolutionClient, "find_contact", contato)
    from app.domain.atendimento import foto_contato as mod
    monkeypatch.setattr(mod, "_baixar", baixar)
    monkeypatch.setattr(storage, "guardar_objeto", guardar)
    import app.api.routers.corretor_portal as rota
    monkeypatch.setattr("app.shared.storage.ler_midia", ler)

    tid, ids = cenario
    aid = await _com_atendimento(tid, ids)
    async with get_admin_session() as s:
        await s.execute(text("UPDATE atendimentos SET nome_contato = NULL WHERE id = :a"), {"a": aid})
    h = _auth(tid, ids["a"]["corretor"])
    try:
        r = await cliente.post(f"/corretor/atendimentos/{aid}/foto/atualizar", headers=h)
        assert r.status_code == 200 and r.json()["resultado"] == "atualizada" and r.json()["nome"] == "Maria da Silva"
        d = (await cliente.get(f"/corretor/atendimentos/{aid}", headers=h)).json()
        assert d["nome"] == "Maria da Silva" and d["foto_url"].startswith(f"/corretor/atendimentos/{aid}/foto?v=")
        assert (await cliente.get(d["foto_url"], headers=h)).content.startswith(b"\xff\xd8")
        assert (await cliente.get(f"/corretor/atendimentos/{aid}/foto", headers=_auth(tid, ids["b"]["corretor"]))).status_code == 404
        assert (await cliente.post(f"/corretor/atendimentos/{aid}/foto/atualizar", headers=_auth(tid, ids["b"]["corretor"]))).status_code == 404
    finally:
        await _limpar_atendimento(ids)
