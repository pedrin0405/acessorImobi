"""Foto do corretor a partir do perfil do WhatsApp (Evolution mockada)."""
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest

from app.domain.corretor import foto
from app.integration.whatsapp.evolution import EvolutionClient

TID, CID = uuid4(), uuid4()


class _Res:
    def __init__(self, primeira=None):
        self._p = primeira

    def first(self):
        return self._p


class _Sessao:
    """Responde pelas consultas do módulo e guarda os UPDATEs executados."""
    def __init__(self, corretor, sessao):
        self.corretor, self.sessao, self.updates = corretor, sessao, []

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        if sql.lstrip().startswith("UPDATE"):
            self.updates.append((sql, params))
            return _Res()
        return _Res(self.sessao if "whatsapp_sessions" in sql else self.corretor)


def _preparar(monkeypatch, corretor, sessao=SimpleNamespace(instance_id="inst")):
    s = _Sessao(corretor, sessao)

    @asynccontextmanager
    async def fake(_tenant):
        yield s

    monkeypatch.setattr(foto, "get_session", fake)
    return s


class _Evo:
    def __init__(self, link):
        self.link, self.chamadas = link, []

    async def fetch_profile_picture_url(self, instance, numero):
        self.chamadas.append((instance, numero))
        return self.link


@pytest.mark.asyncio
async def test_baixa_guarda_e_marca_origem_whatsapp(monkeypatch):
    s = _preparar(monkeypatch, SimpleNamespace(telefone="5563999990000", foto_origem=None))
    guardados = {}

    async def baixar(url):
        return b"JPEG", "image/jpeg"

    async def guardar(chave, dados, tipo):
        guardados[chave] = (dados, tipo)
        return "s3:" + chave

    monkeypatch.setattr(foto, "_baixar", baixar)
    monkeypatch.setattr(foto.storage, "guardar_objeto", guardar)
    evo = _Evo("https://pps.whatsapp.net/x.jpg")
    assert await foto.sincronizar_foto(TID, CID, evo) == "atualizada"
    assert evo.chamadas == [("inst", "5563999990000")]
    assert list(guardados) == [f"fotos/{TID}/{CID}.jpg"]
    assert "foto_origem = 'whatsapp'" in s.updates[0][0] and s.updates[0][1]["ref"].startswith("s3:fotos/")


@pytest.mark.asyncio
async def test_foto_manual_nunca_e_sobrescrita(monkeypatch):
    s = _preparar(monkeypatch, SimpleNamespace(telefone="5563999990000", foto_origem="manual"))
    evo = _Evo("https://x/y.jpg")
    assert await foto.sincronizar_foto(TID, CID, evo) == "manual"
    assert evo.chamadas == [] and s.updates == []


@pytest.mark.asyncio
async def test_sem_foto_ou_privacidade_so_marca_tentativa(monkeypatch):
    s = _preparar(monkeypatch, SimpleNamespace(telefone="5563999990000", foto_origem="whatsapp"))
    assert await foto.sincronizar_foto(TID, CID, _Evo(None)) == "sem_foto"
    assert len(s.updates) == 1 and "foto_tentada_em" in s.updates[0][0] and "foto_ref" not in s.updates[0][0]


@pytest.mark.asyncio
async def test_sem_whatsapp_do_agente_conectado_nao_consulta(monkeypatch):
    s = _preparar(monkeypatch, SimpleNamespace(telefone="5563999990000", foto_origem=None), sessao=None)
    evo = _Evo("https://x/y.jpg")
    assert await foto.sincronizar_foto(TID, CID, evo) == "sem_sessao"
    assert evo.chamadas == [] and s.updates == []


@pytest.mark.asyncio
async def test_falha_da_evolution_nao_levanta(monkeypatch):
    _preparar(monkeypatch, SimpleNamespace(telefone="5563999990000", foto_origem=None))

    class Quebra:
        async def fetch_profile_picture_url(self, *a):
            raise RuntimeError("fora do ar")

    assert await foto.sincronizar_foto(TID, CID, Quebra()) == "erro"


@pytest.mark.asyncio
@pytest.mark.parametrize("corpo,esperado", [
    ({"wuid": "x", "profilePictureUrl": "https://pps.whatsapp.net/a.jpg"}, "https://pps.whatsapp.net/a.jpg"),
    ({"wuid": "x", "profilePictureUrl": None}, None),
    ({"profilePictureUrl": "nao-e-url"}, None),
])
async def test_cliente_evolution_interpreta_resposta(monkeypatch, corpo, esperado):
    def tratador(request):
        assert request.url.path.endswith("/chat/fetchProfilePictureUrl/inst")
        return httpx.Response(201, json=corpo)

    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(tratador)))
    assert await EvolutionClient().fetch_profile_picture_url("inst", "5563999990000") == esperado


@pytest.mark.asyncio
async def test_cliente_evolution_erro_http_vira_none(monkeypatch):
    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(lambda r: httpx.Response(500))))
    assert await EvolutionClient().fetch_profile_picture_url("inst", "5563999990000") is None


@pytest.mark.asyncio
@pytest.mark.parametrize("status,tipo,corpo,ok", [
    (200, "image/jpeg", b"x" * 10, True),
    (200, "text/html", b"<html>", False),
    (403, "image/jpeg", b"x", False),
    (200, "image/png", b"x" * (foto.LIMITE_BYTES + 1), False),
])
async def test_baixar_valida_tipo_status_e_tamanho(monkeypatch, status, tipo, corpo, ok):
    original = httpx.AsyncClient
    resp = lambda r: httpx.Response(status, content=corpo, headers={"content-type": tipo})  # noqa: E731
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(resp)))
    assert (await foto._baixar("https://x/y")) is not None if ok else (await foto._baixar("https://x/y")) is None


def test_url_da_foto_leva_versao_e_some_sem_foto():
    quando = datetime(2026, 10, 30, tzinfo=timezone.utc)
    assert foto.url_da_foto(CID, "s3:k", quando) == f"/admin/corretores/{CID}/foto?v={int(quando.timestamp())}"
    assert foto.url_da_foto(CID, None, quando) is None
