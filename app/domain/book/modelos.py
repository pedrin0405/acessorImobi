"""Modelos de book por imobiliária: lista (criando os de fábrica), cria, edita, define o padrão e exclui."""
import json
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.domain.book import config as cfg


def _modelo(r) -> Dict[str, Any]:
    return {"id": str(r.id), "nome": r.nome, "padrao": r.padrao, "sistema": r.sistema, "config": cfg.normalizar(r.config)}


class ModelosBook:
    def __init__(self, session):
        self._s = session

    async def listar(self, tenant_id: UUID) -> List[Dict[str, Any]]:
        tid = str(tenant_id)
        linhas = (await self._s.execute(text("SELECT * FROM book_modelos WHERE tenant_id = :tid ORDER BY sistema DESC, created_at"), {"tid": tid})).fetchall()
        if not linhas:
            for item in cfg.FABRICA:
                await self._s.execute(
                    text("""INSERT INTO book_modelos (tenant_id, nome, padrao, sistema, config)
                            VALUES (:tid, :nome, :padrao, TRUE, CAST(:config AS jsonb)) ON CONFLICT DO NOTHING"""),
                    {"tid": tid, "nome": item["nome"], "padrao": item["padrao"], "config": json.dumps(cfg.normalizar(item["config"]))},
                )
            linhas = (await self._s.execute(text("SELECT * FROM book_modelos WHERE tenant_id = :tid ORDER BY sistema DESC, created_at"), {"tid": tid})).fetchall()
        return [_modelo(r) for r in linhas]

    async def obter(self, tenant_id: UUID, modelo_id: Optional[UUID] = None) -> Dict[str, Any]:
        """O modelo pedido ou, sem id (ou id que não existe mais), o padrão."""
        modelos = await self.listar(tenant_id)
        if modelo_id:
            for m in modelos:
                if m["id"] == str(modelo_id):
                    return m
        return next((m for m in modelos if m["padrao"]), modelos[0])

    @staticmethod
    def _nome(nome: Any) -> str:
        limpo = " ".join(str(nome or "").split())
        if not limpo or len(limpo) > 80:
            raise cfg.ConfigErro("Dê um nome ao modelo (até 80 caracteres).")
        return limpo

    async def criar(self, tenant_id: UUID, nome: str, config: Any, copiar_de: Optional[UUID] = None) -> Dict[str, Any]:
        base = (await self.obter(tenant_id, copiar_de))["config"] if copiar_de else cfg.PADRAO
        completa = cfg.normalizar(config, base)
        nome = self._nome(nome)
        try:
            async with self._s.begin_nested():
                r = (await self._s.execute(
                    text("""INSERT INTO book_modelos (tenant_id, nome, config) VALUES (:tid, :nome, CAST(:config AS jsonb)) RETURNING *"""),
                    {"tid": str(tenant_id), "nome": nome, "config": json.dumps(completa)},
                )).first()
        except IntegrityError:
            raise cfg.ConfigErro("Já existe um modelo com esse nome.")
        return _modelo(r)

    async def atualizar(self, tenant_id: UUID, modelo_id: UUID, nome: str, config: Any) -> Dict[str, Any]:
        atual = await self.obter(tenant_id, modelo_id)
        if atual["id"] != str(modelo_id):
            raise cfg.ConfigErro("Modelo não encontrado.")
        nome, completa = self._nome(nome), cfg.normalizar(config, atual["config"])
        try:
            async with self._s.begin_nested():
                r = (await self._s.execute(
                    text("""UPDATE book_modelos SET nome = :nome, config = CAST(:config AS jsonb), updated_at = NOW()
                            WHERE tenant_id = :tid AND id = :id RETURNING *"""),
                    {"tid": str(tenant_id), "id": str(modelo_id), "nome": nome, "config": json.dumps(completa)},
                )).first()
        except IntegrityError:
            raise cfg.ConfigErro("Já existe um modelo com esse nome.")
        return _modelo(r)

    async def definir_padrao(self, tenant_id: UUID, modelo_id: UUID) -> None:
        atual = await self.obter(tenant_id, modelo_id)
        if atual["id"] != str(modelo_id):
            raise cfg.ConfigErro("Modelo não encontrado.")
        await self._s.execute(text("UPDATE book_modelos SET padrao = FALSE WHERE tenant_id = :tid AND padrao"), {"tid": str(tenant_id)})
        await self._s.execute(text("UPDATE book_modelos SET padrao = TRUE WHERE tenant_id = :tid AND id = :id"), {"tid": str(tenant_id), "id": str(modelo_id)})

    async def excluir(self, tenant_id: UUID, modelo_id: UUID) -> None:
        atual = await self.obter(tenant_id, modelo_id)
        if atual["id"] != str(modelo_id):
            raise cfg.ConfigErro("Modelo não encontrado.")
        if atual["padrao"]:
            raise cfg.ConfigErro("Este é o modelo padrão. Defina outro como padrão antes de excluir.")
        if atual["sistema"]:
            raise cfg.ConfigErro("Os modelos de fábrica não podem ser excluídos (você pode editá-los ou criar outros).")
        await self._s.execute(text("DELETE FROM book_modelos WHERE tenant_id = :tid AND id = :id"), {"tid": str(tenant_id), "id": str(modelo_id)})
