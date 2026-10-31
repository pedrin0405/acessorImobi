"""Regras das Configurações do portal da imobiliária (perfil, equipe, listas, localidades, agenda...)."""
import json
import secrets
from datetime import datetime, time, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.configuracoes import padroes
from app.domain.configuracoes.padroes import ConfigErro
from app.domain.corretor.foto import url_da_foto as foto_url
from app.domain.imovel import link
from app.shared.security import hash_password, mask_phone, verify_password

log = structlog.get_logger()

PAPEIS = {"proprietario": "Proprietário", "admin": "Administrador"}


class ConfiguracoesService:
    def __init__(self, session: AsyncSession, tenant_id: UUID):
        self._s = session
        self._tid = str(tenant_id)

    # --- Armazenamento em tenants.dados --------------------------------------

    async def _tenant(self) -> Any:
        r = (await self._s.execute(
            text("SELECT id, slug, nome, status, fuso, horario_inicio, horario_fim, dados FROM tenants WHERE id = :tid"),
            {"tid": self._tid},
        )).first()
        if not r:
            raise ConfigErro("Imobiliária não encontrada.")
        return r

    async def dados(self) -> Dict[str, Any]:
        r = await self._tenant()
        return r.dados if isinstance(r.dados, dict) else {}

    async def _gravar(self, chave: str, valor: Any) -> None:
        await self._s.execute(
            text("UPDATE tenants SET dados = jsonb_set(dados, ARRAY[:chave], CAST(:v AS jsonb), true), updated_at = NOW() WHERE id = :tid"),
            {"tid": self._tid, "chave": chave, "v": json.dumps(valor)},
        )

    # --- Perfil e segurança ---------------------------------------------------

    async def _admin(self, admin_id: UUID, email: str) -> Any:
        r = (await self._s.execute(
            text("""SELECT id, nome, email, senha_hash, ativo, telefone, creci_uf, creci_numero, foto, created_at
                    FROM tenant_admins WHERE tenant_id = :tid AND (id = :id OR email = :email) ORDER BY (id = :id) DESC LIMIT 1"""),
            {"tid": self._tid, "id": str(admin_id), "email": email},
        )).first()
        if not r:
            raise ConfigErro("Usuário não encontrado.")
        return r

    async def perfil(self, admin_id: UUID, email: str) -> Dict[str, Any]:
        a = await self._admin(admin_id, email)
        return {"id": str(a.id), "nome": a.nome, "email": a.email, "telefone": a.telefone or "", "creci_uf": a.creci_uf or "",
                "creci_numero": a.creci_numero or "", "foto": a.foto, "desde": a.created_at.isoformat()}

    async def salvar_perfil(self, admin_id: UUID, email: str, d: Dict[str, Any]) -> Dict[str, Any]:
        a = await self._admin(admin_id, email)
        nome = (d.get("nome") or "").strip()
        novo_email = (d.get("email") or "").strip().lower()
        if not nome:
            raise ConfigErro("O nome é obrigatório.")
        if "@" not in novo_email or len(novo_email) > 255:
            raise ConfigErro("Informe um e-mail válido.")
        uf = (d.get("creci_uf") or "").strip().upper()
        if uf and not padroes.RE_UF.match(uf):
            raise ConfigErro("UF do CRECI inválida.")
        telefone = padroes.somente_digitos(d.get("telefone"))
        if telefone and not 10 <= len(telefone) <= 13:
            raise ConfigErro("Telefone inválido. Use DDD + número.")
        foto = padroes.validar_imagem(d.get("foto")) if "foto" in d else a.foto
        duplicado = (await self._s.execute(
            text("SELECT 1 FROM tenant_admins WHERE tenant_id = :tid AND email = :e AND id <> :id"),
            {"tid": self._tid, "e": novo_email, "id": str(a.id)},
        )).first()
        if duplicado:
            raise ConfigErro("Já existe outro usuário com este e-mail.")
        await self._s.execute(
            text("""UPDATE tenant_admins SET nome=:nome, email=:email, telefone=:tel, creci_uf=:uf, creci_numero=:num, foto=:foto
                    WHERE id = :id"""),
            {"nome": nome[:255], "email": novo_email, "tel": telefone or None, "uf": uf or None,
             "num": padroes.somente_digitos(d.get("creci_numero"))[:20] or None, "foto": foto, "id": str(a.id)},
        )
        return await self.perfil(a.id, novo_email)

    async def alterar_senha(self, admin_id: UUID, email: str, atual: str, nova: str, confirmar: str) -> datetime:
        a = await self._admin(admin_id, email)
        if not verify_password(atual or "", a.senha_hash):
            raise ConfigErro("A senha atual não confere.")
        if len(nova or "") < 8:
            raise ConfigErro("A nova senha precisa ter pelo menos 8 caracteres.")
        if nova != confirmar:
            raise ConfigErro("A confirmação não é igual à nova senha.")
        if nova == atual:
            raise ConfigErro("A nova senha deve ser diferente da atual.")
        agora = datetime.now(timezone.utc)
        await self._s.execute(
            text("UPDATE tenant_admins SET senha_hash = :h, tokens_validos_apos = :t WHERE id = :id"),
            {"h": hash_password(nova), "t": agora, "id": str(a.id)},
        )
        return agora

    async def confirmar_senha(self, admin_id: UUID, email: str, senha: str) -> None:
        a = await self._admin(admin_id, email)
        if not verify_password(senha or "", a.senha_hash):
            raise ConfigErro("Senha incorreta.")

    async def resetar_crm(self) -> Dict[str, int]:
        """Apaga leads, negócios, agenda e conversas do assistente; mantém corretores, etapas e mensagens."""
        apagados: Dict[str, int] = {}
        for tabela in ("crm_negocio_eventos", "crm_matches", "crm_briefings", "crm_negocios", "crm_atividades", "crm_leads",
                       "conversa_notas", "assistente_conversas"):
            r = await self._s.execute(text(f"DELETE FROM {tabela} WHERE tenant_id = :tid"), {"tid": self._tid})
            apagados[tabela] = r.rowcount or 0
        return apagados

    async def solicitar_exclusao(self, slug_digitado: str) -> None:
        t = await self._tenant()
        if (slug_digitado or "").strip().lower() != t.slug:
            raise ConfigErro("Digite o endereço da imobiliária exatamente como mostrado para confirmar.")
        await self._s.execute(text("UPDATE tenants SET status = 'suspended', updated_at = NOW() WHERE id = :tid"), {"tid": self._tid})
        await self._gravar("exclusao_solicitada_em", datetime.now(timezone.utc).isoformat())

    # --- Dados da imobiliária -----------------------------------------------------

    async def imobiliaria(self) -> Dict[str, Any]:
        t = await self._tenant()
        d = t.dados if isinstance(t.dados, dict) else {}
        im = d.get("imobiliaria") or {}
        return {
            "tipo_conta": im.get("tipo_conta", "imobiliaria"), "nome": t.nome, "documento": im.get("documento", ""),
            "creci_uf": im.get("creci_uf", ""), "creci_numero": im.get("creci_numero", ""), "pais": im.get("pais", "+55"),
            "telefone": im.get("telefone", ""), "email_contato": im.get("email_contato", ""), "site": im.get("site", ""),
            "cidade": im.get("cidade", ""), "uf": im.get("uf", ""), "comissao_padrao": im.get("comissao_padrao", 0),
            "logo": im.get("logo"), "fuso": t.fuso, "horario_inicio": t.horario_inicio.strftime("%H:%M"), "horario_fim": t.horario_fim.strftime("%H:%M"),
            "slug": t.slug,
        }

    async def salvar_imobiliaria(self, d: Dict[str, Any]) -> Dict[str, Any]:
        tipo = d.get("tipo_conta") or "imobiliaria"
        if tipo not in ("imobiliaria", "autonomo"):
            raise ConfigErro("Tipo de conta inválido.")
        nome = (d.get("nome") or "").strip()
        if not nome or len(nome) > 255:
            raise ConfigErro("O nome é obrigatório (até 255 caracteres).")
        uf = (d.get("creci_uf") or "").strip().upper()
        if uf and not padroes.RE_UF.match(uf):
            raise ConfigErro("UF do CRECI inválida.")
        for campo in ("uf",):
            if (d.get(campo) or "") and not padroes.RE_UF.match(d[campo]):
                raise ConfigErro("UF inválida.")
        telefone = padroes.somente_digitos(d.get("telefone"))
        if telefone and not 8 <= len(telefone) <= 13:
            raise ConfigErro("Telefone inválido.")
        email = (d.get("email_contato") or "").strip()
        if email and ("@" not in email or len(email) > 255):
            raise ConfigErro("E-mail de contato inválido.")
        try:
            comissao = float(d.get("comissao_padrao") or 0)
        except (TypeError, ValueError):
            raise ConfigErro("Comissão inválida.")
        if not 0 <= comissao <= 100:
            raise ConfigErro("A comissão deve ficar entre 0% e 100%.")
        try:
            ini = time.fromisoformat(d.get("horario_inicio") or "08:00")
            fim = time.fromisoformat(d.get("horario_fim") or "20:00")
        except ValueError:
            raise ConfigErro("Horário de atendimento inválido.")
        if ini >= fim:
            raise ConfigErro("O início do atendimento deve ser antes do fim.")
        fuso = d.get("fuso") or "America/Sao_Paulo"
        from zoneinfo import ZoneInfo

        try:
            ZoneInfo(fuso)
        except Exception:  # noqa: BLE001 - qualquer falha de zoneinfo é fuso inválido
            raise ConfigErro("Fuso horário inválido.")
        atual = (await self.dados()).get("imobiliaria") or {}
        logo = padroes.validar_imagem(d.get("logo")) if "logo" in d else atual.get("logo")
        await self._s.execute(
            text("UPDATE tenants SET nome = :nome, fuso = :fuso, horario_inicio = :ini, horario_fim = :fim, updated_at = NOW() WHERE id = :tid"),
            {"nome": nome, "fuso": fuso, "ini": ini, "fim": fim, "tid": self._tid},
        )
        await self._gravar("imobiliaria", {
            "tipo_conta": tipo, "documento": padroes.validar_documento(d.get("documento"), tipo), "creci_uf": uf,
            "creci_numero": padroes.somente_digitos(d.get("creci_numero"))[:20], "pais": (d.get("pais") or "+55")[:6],
            "telefone": telefone, "email_contato": email, "site": (d.get("site") or "").strip()[:200],
            "cidade": (d.get("cidade") or "").strip()[:120], "uf": (d.get("uf") or "").upper(),
            "comissao_padrao": round(comissao, 2), "logo": logo,
        })
        novo_site = link.normalizar_base(d.get("site"))
        if novo_site != link.normalizar_base(atual.get("site")):
            await link.aplicar_links(self._s, self._tid, novo_site)  # imóveis em cache passam a apontar para o site informado
        return await self.imobiliaria()

    # --- Equipe -----------------------------------------------------------------------

    async def equipe(self, admin_id: UUID, email: str) -> Dict[str, Any]:
        rows = (await self._s.execute(
            text("SELECT id, nome, email, ativo, created_at, foto FROM tenant_admins WHERE tenant_id = :tid ORDER BY created_at"),
            {"tid": self._tid},
        )).fetchall()
        admins = [
            {"id": str(r.id), "nome": r.nome, "email": r.email, "ativo": r.ativo, "desde": r.created_at.isoformat(), "foto": r.foto,
             "papel": "proprietario" if i == 0 else "admin", "voce": str(r.id) == str(admin_id) or r.email == email}
            for i, r in enumerate(rows)
        ]
        corretores = (await self._s.execute(
            text("SELECT id, nome, telefone, status, created_at, foto_ref, foto_atualizada_em FROM corretores WHERE tenant_id = :tid ORDER BY created_at"),
            {"tid": self._tid},
        )).fetchall()
        return {
            "admins": admins,
            "corretores": [{"id": str(c.id), "nome": c.nome, "telefone_mascarado": mask_phone(c.telefone), "status": c.status, "desde": c.created_at.isoformat(), "foto_url": foto_url(c.id, c.foto_ref, c.foto_atualizada_em)} for c in corretores],
        }

    async def criar_admin(self, nome: str, email: str) -> Dict[str, Any]:
        nome = (nome or "").strip()
        email = (email or "").strip().lower()
        if not nome:
            raise ConfigErro("Informe o nome.")
        if "@" not in email:
            raise ConfigErro("Informe um e-mail válido.")
        if (await self._s.execute(text("SELECT 1 FROM tenant_admins WHERE tenant_id = :tid AND email = :e"), {"tid": self._tid, "e": email})).first():
            raise ConfigErro("Já existe um usuário com este e-mail.")
        senha = secrets.token_urlsafe(9)
        r = (await self._s.execute(
            text("INSERT INTO tenant_admins (tenant_id, nome, email, senha_hash) VALUES (:tid, :nome, :e, :h) RETURNING id"),
            {"tid": self._tid, "nome": nome[:255], "e": email, "h": hash_password(senha)},
        )).first()
        return {"id": str(r.id), "nome": nome, "email": email, "senha_temporaria": senha}

    async def atualizar_admin(self, alvo: UUID, ativo: bool, eu: UUID) -> None:
        if str(alvo) == str(eu) and not ativo:
            raise ConfigErro("Você não pode desativar o próprio acesso.")
        primeiro = (await self._s.execute(text("SELECT id FROM tenant_admins WHERE tenant_id = :tid ORDER BY created_at LIMIT 1"), {"tid": self._tid})).first()
        if primeiro and str(primeiro.id) == str(alvo) and not ativo:
            raise ConfigErro("O proprietário não pode ser desativado.")
        r = await self._s.execute(
            text("UPDATE tenant_admins SET ativo = :a, tokens_validos_apos = NOW() WHERE id = :id AND tenant_id = :tid"),
            {"a": ativo, "id": str(alvo), "tid": self._tid},
        )
        if not r.rowcount:
            raise ConfigErro("Usuário não encontrado.")

    # --- Roleta de leads -------------------------------------------------------------------

    async def roleta(self) -> Dict[str, Any]:
        d = {**padroes.ROLETA_PADRAO, **((await self.dados()).get("roleta") or {})}
        elegiveis = await self._elegiveis(d)
        proximo = padroes.proximo_da_fila([e["id"] for e in elegiveis], d.get("ultimo"))
        return {**d, "elegiveis": elegiveis, "proximo": proximo}

    async def _elegiveis(self, cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
        rows = (await self._s.execute(
            text("SELECT id, nome FROM corretores WHERE tenant_id = :tid AND status = 'active' ORDER BY nome"), {"tid": self._tid})).fetchall()
        todos = [{"id": str(r.id), "nome": r.nome or "Corretor"} for r in rows]
        escolhidos = set(cfg.get("participantes") or [])
        return [c for c in todos if not escolhidos or c["id"] in escolhidos]

    async def salvar_roleta(self, d: Dict[str, Any]) -> Dict[str, Any]:
        atual = (await self.dados()).get("roleta") or {}
        novo = padroes.validar_roleta({**d, "ultimo": atual.get("ultimo")})
        if novo["ativa"] and not await self._elegiveis(novo):
            raise ConfigErro("Não há corretores ativos para participar da roleta.")
        await self._gravar("roleta", novo)
        return await self.roleta()

    async def fila_da_roleta(self) -> List[str]:
        """Corretores do rodízio, já começando por quem vem depois do último atendido."""
        cfg = {**padroes.ROLETA_PADRAO, **((await self.dados()).get("roleta") or {})}
        ordem = sorted(e["id"] for e in await self._elegiveis(cfg))
        if not ordem:
            return []
        ultimo = cfg.get("ultimo")
        inicio = (ordem.index(ultimo) + 1) % len(ordem) if ultimo in ordem else 0
        return ordem[inicio:] + ordem[:inicio]

    async def gravar_ultimo_da_roleta(self, corretor_id: str) -> None:
        cfg = {**padroes.ROLETA_PADRAO, **((await self.dados()).get("roleta") or {})}
        await self._gravar("roleta", {**cfg, "ultimo": corretor_id})

    async def proximo_da_roleta(self) -> Optional[str]:
        """Escolhe e GRAVA o próximo corretor do rodízio (None com a roleta desligada)."""
        await self._s.execute(text("SELECT 1 FROM tenants WHERE id = :tid FOR UPDATE"), {"tid": self._tid})
        cfg = {**padroes.ROLETA_PADRAO, **((await self.dados()).get("roleta") or {})}
        if not cfg["ativa"]:
            return None
        elegiveis = await self._elegiveis(cfg)
        proximo = padroes.proximo_da_fila([e["id"] for e in elegiveis], cfg.get("ultimo"))
        if proximo:
            await self._gravar("roleta", {**cfg, "ultimo": proximo})
        return proximo

    # --- Listas (Campos & Opções) --------------------------------------------------------

    async def listas(self) -> List[Dict[str, Any]]:
        salvas = (await self.dados()).get("listas") or {}
        padrao = padroes.listas_padrao()
        return [
            {"chave": chave, "titulo": meta["titulo"], "descricao": meta["descricao"], "custo": meta["custo"],
             "itens": salvas.get(chave, padrao[chave])}
            for chave, meta in padroes.LISTAS_PADRAO.items()
        ]

    async def salvar_lista(self, chave: str, itens: Any) -> List[Dict[str, Any]]:
        validos = padroes.validar_lista(chave, itens)
        salvas = (await self.dados()).get("listas") or {}
        salvas[chave] = validos
        await self._gravar("listas", salvas)
        return validos

    # --- Localidades -------------------------------------------------------------------------

    async def cidades(self, busca: Optional[str], arquivadas: bool) -> List[Dict[str, Any]]:
        rows = (await self._s.execute(
            text("""SELECT c.id, c.nome, c.uf, c.arquivada,
                           (SELECT COUNT(*) FROM localidades_bairros b WHERE b.cidade_id = c.id AND NOT b.arquivado) AS bairros
                    FROM localidades_cidades c
                    WHERE c.tenant_id = :tid AND c.arquivada = :arq AND (CAST(:q AS text) IS NULL OR c.nome ILIKE :like)
                    ORDER BY c.nome"""),
            {"tid": self._tid, "arq": arquivadas, "q": busca or None, "like": f"%{(busca or '').strip()}%"},
        )).fetchall()
        return [{"id": str(r.id), "nome": r.nome, "uf": r.uf, "arquivada": r.arquivada, "bairros": r.bairros} for r in rows]

    async def criar_cidade(self, nome: str, uf: Optional[str]) -> Dict[str, Any]:
        nome = " ".join((nome or "").split())
        uf = (uf or "").strip().upper() or None
        if not nome or len(nome) > 120:
            raise ConfigErro("Informe o nome da cidade.")
        if uf and not padroes.RE_UF.match(uf):
            raise ConfigErro("UF inválida.")
        try:
            r = (await self._s.execute(
                text("INSERT INTO localidades_cidades (tenant_id, nome, uf) VALUES (:tid, :n, :uf) RETURNING id"),
                {"tid": self._tid, "n": nome, "uf": uf},
            )).first()
        except Exception as e:  # noqa: BLE001
            if "uq_localidades_cidade" in str(e):
                raise ConfigErro("Esta cidade já está cadastrada.")
            raise
        return {"id": str(r.id), "nome": nome, "uf": uf, "arquivada": False, "bairros": 0}

    async def atualizar_cidade(self, cid: UUID, nome: Optional[str], uf: Optional[str], arquivada: Optional[bool]) -> None:
        sets, params = [], {"id": str(cid), "tid": self._tid}
        if nome is not None:
            if not nome.strip():
                raise ConfigErro("O nome não pode ficar vazio.")
            sets.append("nome = :nome"); params["nome"] = nome.strip()[:120]
        if uf is not None:
            sets.append("uf = :uf"); params["uf"] = uf.strip().upper()[:2] or None
        if arquivada is not None:
            sets.append("arquivada = :arq"); params["arq"] = arquivada
        if not sets:
            return
        r = await self._s.execute(text(f"UPDATE localidades_cidades SET {', '.join(sets)} WHERE id = :id AND tenant_id = :tid"), params)
        if not r.rowcount:
            raise ConfigErro("Cidade não encontrada.")

    async def excluir_cidade(self, cid: UUID) -> None:
        await self._s.execute(text("DELETE FROM localidades_cidades WHERE id = :id AND tenant_id = :tid"), {"id": str(cid), "tid": self._tid})

    async def bairros(self, cid: UUID) -> List[Dict[str, Any]]:
        rows = (await self._s.execute(
            text("SELECT id, nome, arquivado FROM localidades_bairros WHERE cidade_id = :cid AND tenant_id = :tid ORDER BY nome"),
            {"cid": str(cid), "tid": self._tid})).fetchall()
        return [{"id": str(r.id), "nome": r.nome, "arquivado": r.arquivado} for r in rows]

    async def criar_bairro(self, cid: UUID, nome: str) -> Dict[str, Any]:
        nome = " ".join((nome or "").split())
        if not nome or len(nome) > 120:
            raise ConfigErro("Informe o nome do bairro.")
        if not (await self._s.execute(text("SELECT 1 FROM localidades_cidades WHERE id = :id AND tenant_id = :tid"), {"id": str(cid), "tid": self._tid})).first():
            raise ConfigErro("Cidade não encontrada.")
        try:
            r = (await self._s.execute(
                text("INSERT INTO localidades_bairros (tenant_id, cidade_id, nome) VALUES (:tid, :cid, :n) RETURNING id"),
                {"tid": self._tid, "cid": str(cid), "n": nome})).first()
        except Exception as e:  # noqa: BLE001
            if "uq_localidades_bairro" in str(e):
                raise ConfigErro("Este bairro já existe nesta cidade.")
            raise
        return {"id": str(r.id), "nome": nome, "arquivado": False}

    async def atualizar_bairro(self, bid: UUID, nome: Optional[str], arquivado: Optional[bool]) -> None:
        sets, params = [], {"id": str(bid), "tid": self._tid}
        if nome is not None:
            if not nome.strip():
                raise ConfigErro("O nome não pode ficar vazio.")
            sets.append("nome = :nome"); params["nome"] = nome.strip()[:120]
        if arquivado is not None:
            sets.append("arquivado = :arq"); params["arq"] = arquivado
        if sets:
            await self._s.execute(text(f"UPDATE localidades_bairros SET {', '.join(sets)} WHERE id = :id AND tenant_id = :tid"), params)

    async def excluir_bairro(self, bid: UUID) -> None:
        await self._s.execute(text("DELETE FROM localidades_bairros WHERE id = :id AND tenant_id = :tid"), {"id": str(bid), "tid": self._tid})

    async def importar_localidades(self) -> Dict[str, int]:
        """Cria cidades e bairros a partir do cache de imóveis do Imoview (só o que ainda não existe)."""
        pares = (await self._s.execute(
            text("SELECT DISTINCT TRIM(cidade) AS cidade, TRIM(bairro) AS bairro FROM imoveis_cache WHERE tenant_id = :tid AND cidade IS NOT NULL AND TRIM(cidade) <> ''"),
            {"tid": self._tid})).fetchall()
        novas = novos = 0
        ids: Dict[str, str] = {}
        for p in pares:
            chave = p.cidade.lower()
            if chave not in ids:
                r = (await self._s.execute(
                    text("""INSERT INTO localidades_cidades (tenant_id, nome) VALUES (:tid, :n)
                            ON CONFLICT (tenant_id, lower(nome), COALESCE(uf, '')) DO NOTHING RETURNING id"""),
                    {"tid": self._tid, "n": p.cidade})).first()
                if r:
                    novas += 1
                    ids[chave] = str(r.id)
                else:
                    ids[chave] = str((await self._s.execute(
                        text("SELECT id FROM localidades_cidades WHERE tenant_id = :tid AND lower(nome) = :n AND uf IS NULL LIMIT 1"),
                        {"tid": self._tid, "n": chave})).scalar() or "")
            if p.bairro and ids.get(chave):
                r = await self._s.execute(
                    text("""INSERT INTO localidades_bairros (tenant_id, cidade_id, nome) VALUES (:tid, :cid, :n)
                            ON CONFLICT (cidade_id, lower(nome)) DO NOTHING"""),
                    {"tid": self._tid, "cid": ids[chave], "n": p.bairro})
                novos += r.rowcount or 0
        return {"cidades": novas, "bairros": novos}

    # --- Tipos de atividade --------------------------------------------------------------------

    async def tipos_atividade(self) -> List[Dict[str, Any]]:
        salvos = (await self.dados()).get("tipos_atividade")
        base = {t["chave"]: t for t in padroes.tipos_atividade_padrao()}
        if not salvos:
            return list(base.values())
        ordenados = [{**base.get(t["chave"], {}), **t} for t in salvos]
        faltando = [t for k, t in base.items() if k not in {x["chave"] for x in ordenados}]
        return ordenados + faltando

    async def usos_de_tipos(self) -> Dict[str, int]:
        rows = (await self._s.execute(text("SELECT tipo, COUNT(*) AS n FROM crm_atividades WHERE tenant_id = :tid GROUP BY tipo"), {"tid": self._tid})).fetchall()
        return {r.tipo: r.n for r in rows}

    async def salvar_tipos_atividade(self, itens: Any) -> List[Dict[str, Any]]:
        validos = padroes.validar_tipos_atividade(itens, await self.usos_de_tipos())
        await self._gravar("tipos_atividade", validos)
        return await self.tipos_atividade()

    async def tipo_existe(self, chave: str) -> bool:
        return chave in padroes.CHAVES_SISTEMA or any(t["chave"] == chave for t in await self.tipos_atividade())

    # --- Lembretes -----------------------------------------------------------------------------------

    async def lembretes(self) -> List[Dict[str, Any]]:
        salvos = (await self.dados()).get("lembretes")
        return salvos if isinstance(salvos, list) else padroes.lembretes_padrao()

    async def salvar_lembretes(self, regras: Any) -> List[Dict[str, Any]]:
        tipos = [t["chave"] for t in await self.tipos_atividade()]
        validas = padroes.validar_lembretes(regras, tipos)
        await self._gravar("lembretes", validas)
        return validas

    # --- Resumo para o menu -----------------------------------------------------------------------------

    async def resumo(self) -> Dict[str, Any]:
        d = await self.dados()
        wa = (await self._s.execute(text("SELECT status FROM whatsapp_sessions WHERE tenant_id = :tid AND tipo = 'agente' LIMIT 1"), {"tid": self._tid})).first()
        admins = (await self._s.execute(text("SELECT COUNT(*) FROM tenant_admins WHERE tenant_id = :tid AND ativo"), {"tid": self._tid})).scalar() or 0
        corretores = (await self._s.execute(text("SELECT COUNT(*) FROM corretores WHERE tenant_id = :tid AND status = 'active'"), {"tid": self._tid})).scalar() or 0
        regras = d.get("lembretes") if isinstance(d.get("lembretes"), list) else padroes.lembretes_padrao()
        return {
            "slug": (await self._tenant()).slug,
            "whatsapp": wa.status if wa else "not_provisioned",
            "equipe_ativos": admins + corretores,
            "roleta_ativa": bool((d.get("roleta") or {}).get("ativa")),
            "lembretes_ligados": sum(1 for r in regras if r.get("ligada")),
        }
