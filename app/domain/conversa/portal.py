"""
Conversa vista pelo portal da imobiliária: mensagens com origem e processo da IA,
envio pela equipe, notas internas, ficha do corretor e resumo.
"""
import json
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.crm.service import CrmService, resumo_perfil
from app.integration.llm.gemini import GeminiClient, GeminiError
from app.domain.conversa import acoes_rapidas
from app.domain.imovel import consulta as consulta_imoveis
from app.integration.whatsapp.evolution import EvolutionClient
from app.shared.security import mask_phone

log = structlog.get_logger()

MAX_TEXTO = 4000


class PortalErro(Exception):
    def __init__(self, mensagem: str, status: int = 400):
        super().__init__(mensagem)
        self.status = status


def _ms(trace: Dict[str, Any], inicio: str, fim: str) -> Optional[int]:
    if inicio in trace and fim in trace:
        return max(0, round((trace[fim] - trace[inicio]) * 1000))
    return None


def processo_do_trace(trace: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Linha do tempo do que a IA fez para responder, montada do `trace` da mensagem."""
    if not trace or "ia_inicio" not in trace:
        return None
    proc = trace.get("processo") or {}
    audio = "transcricao_inicio" in trace
    passos: List[Dict[str, Any]] = [
        {"etapa": "Mensagem recebida", "detalhe": "Áudio do corretor" if audio else "Texto do corretor"}
    ]
    if audio:
        passos.append({"etapa": "Transcrição", "detalhe": "O áudio foi transcrito para texto", "ms": _ms(trace, "transcricao_inicio", "transcricao_fim")})
    n = proc.get("contexto_msgs")
    passos.append({
        "etapa": "Contexto",
        "detalhe": f"Reuniu as {n} mensagens mais recentes da conversa" if n else "Reuniu o histórico recente da conversa",
        "ms": _ms(trace, "contexto_inicio", "contexto_fim"),
    })
    if proc.get("passos"):
        passos += proc["passos"]
    else:
        passos.append({"etapa": "IA", "detalhe": "Gerou a resposta", "ms": _ms(trace, "ia_inicio", "ia_fim")})
    canal = proc.get("canal")
    if canal:
        passos.append({"etapa": "Entrega", "detalhe": "Enviou como mensagem de voz" if canal == "audio" else "Enviou como texto"})
    return {
        "rota": proc.get("rota") or "ia",
        "modelo": proc.get("modelo"),
        "total_ms": _ms(trace, "inicio", "ia_fim"),
        "passos": [{k: v for k, v in p.items() if v is not None} for p in passos],
    }


def descrever_acao(acao: str, payload: Optional[Dict[str, Any]]) -> str:
    p = payload or {}
    cliente = p.get("nome") or p.get("cliente") or ""
    if acao == "crm_registrar_lead":
        return f"Anotou o cliente {cliente}".strip()
    if acao == "crm_atualizar_lead":
        return f"Atualizou o cliente {cliente}".strip()
    if acao == "crm_criar_negocio":
        return f"Abriu um negócio para {cliente}".strip()
    if acao == "crm_mover_negocio":
        destino = p.get("status") or p.get("etapa") or ""
        return "Moveu um negócio" + (f" de {cliente}" if cliente else "") + (f" para {destino}" if destino else "")
    if acao == "crm_atualizar_atividade":
        return "Atualizou uma atividade da agenda"
    if acao == "crm_agendar":
        quando = f" em {p['data']}" + (f" às {p['hora']}" if p.get("hora") else "") if p.get("data") else ""
        return f"Agendou {p.get('tipo') or 'atividade'}" + (f" com {cliente}" if cliente else "") + quando
    if acao == "criar_cliente":
        return f"Cadastrou {p.get('nome') or 'um cliente'} no Imoview"
    return acao.replace("_", " ").capitalize()


class ConversaPortalService:
    def __init__(self, session: AsyncSession, tenant_id: UUID):
        self._session = session
        self._tenant_id = tenant_id

    # --- Mensagens ----------------------------------------------------------

    async def mensagens(self, corretor_id: UUID, limit: int = 200) -> List[Dict[str, Any]]:
        rows = await self._session.execute(
            text("""
                SELECT id, direcao, tipo, conteudo, transcricao, status, midia_url, trace, created_at
                FROM mensagens
                WHERE tenant_id = :tid AND corretor_id = :cid
                ORDER BY created_at DESC LIMIT :limit
            """),
            {"tid": str(self._tenant_id), "cid": str(corretor_id), "limit": min(limit, 200)},
        )
        itens: List[Dict[str, Any]] = []
        for r in rows.fetchall():
            trace = r.trace if isinstance(r.trace, dict) else {}
            humano = trace.get("origem") == "humano"
            itens.append({
                "id": str(r.id),
                "direcao": r.direcao,
                "tipo": r.tipo,
                "conteudo": r.transcricao if r.transcricao else r.conteudo,
                "status": r.status,
                "midia_url": r.midia_url,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "origem": "humano" if humano else ("bot" if r.direcao == "outbound" else None),
                "autor": trace.get("autor") if humano else None,
                "cartao": trace.get("cartao") if humano else None,
                "processo": None if humano or r.direcao != "outbound" else processo_do_trace(trace),
                "_grupo": trace.get("inicio"),
            })
        itens.reverse()

        notas = await self._session.execute(
            text("""
                SELECT id, autor, texto, created_at FROM conversa_notas
                WHERE tenant_id = :tid AND corretor_id = :cid ORDER BY created_at DESC LIMIT 100
            """),
            {"tid": str(self._tenant_id), "cid": str(corretor_id)},
        )
        for n in notas.fetchall():
            itens.append({
                "id": str(n.id), "direcao": "nota", "tipo": "nota", "conteudo": n.texto, "status": "nota",
                "midia_url": None, "created_at": n.created_at.isoformat(), "origem": "nota", "autor": n.autor,
                "processo": None, "_grupo": None,
            })
        itens.sort(key=lambda m: m["created_at"] or "")

        # O processo aparece uma vez por resposta (as fotos e o áudio de uma mesma resposta compartilham o trace).
        vistos = set()
        for m in itens:
            if m["processo"] is None:
                continue
            if m["_grupo"] in vistos:
                m["processo"] = None
            else:
                vistos.add(m["_grupo"])
        for m in itens:
            m.pop("_grupo", None)
        return itens

    async def enviar_humano(self, corretor, texto: str, autor: str) -> Dict[str, Any]:
        texto = (texto or "").strip()
        if not texto:
            raise PortalErro("Escreva a mensagem antes de enviar.")
        if len(texto) > MAX_TEXTO:
            raise PortalErro(f"A mensagem passa de {MAX_TEXTO} caracteres.")
        row = await self._session.execute(
            text("SELECT instance_id FROM whatsapp_sessions WHERE tenant_id = :tid AND tipo = 'agente' AND status = 'connected' LIMIT 1"),
            {"tid": str(self._tenant_id)},
        )
        sessao = row.first()
        if not sessao:
            raise PortalErro("O WhatsApp do agente não está conectado. Conecte o número para enviar mensagens.", 503)
        try:
            await EvolutionClient().send_text(instance_id=sessao.instance_id, to=corretor.telefone, text=texto)
        except Exception as e:  # noqa: BLE001
            log.warning("envio_humano_falhou", error=str(e)[:200])
            raise PortalErro("Não consegui entregar a mensagem agora. Tente de novo em instantes.", 502)

        r = await self._session.execute(
            text("""
                INSERT INTO mensagens (tenant_id, corretor_id, message_id, direcao, tipo, conteudo, status, trace)
                VALUES (:tid, :cid, :mid, 'outbound', 'text', :texto, 'sent', CAST(:trace AS jsonb))
                RETURNING id, created_at
            """),
            {
                "tid": str(self._tenant_id), "cid": str(corretor.id),
                "mid": f"out_{int(time.time() * 1000)}_{uuid4().hex[:6]}", "texto": texto,
                "trace": json.dumps({"origem": "humano", "autor": autor}),
            },
        )
        linha = r.first()
        return {
            "id": str(linha.id), "direcao": "outbound", "tipo": "text", "conteudo": texto, "status": "sent",
            "midia_url": None, "created_at": linha.created_at.isoformat(), "origem": "humano", "autor": autor, "processo": None,
        }

    # --- Ações rápidas (imóveis e ficha de lead) ---------------------------------

    async def _instancia(self) -> str:
        sessao = (await self._session.execute(
            text("SELECT instance_id FROM whatsapp_sessions WHERE tenant_id = :tid AND tipo = 'agente' AND status = 'connected' LIMIT 1"),
            {"tid": str(self._tenant_id)},
        )).first()
        if not sessao:
            raise PortalErro("O WhatsApp do agente não está conectado. Conecte o número para enviar mensagens.", 503)
        return sessao.instance_id

    async def montar_acao(self, tipo: str, codigos: List[int], lead_id: Optional[UUID], mensagem: str = "") -> List[Dict[str, Any]]:
        """Mensagens que a ação rápida enviará, na ordem. Serve à prévia e ao envio."""
        saida: List[Dict[str, Any]] = []
        mensagem = (mensagem or "").strip()
        if mensagem:
            saida.append({"tipo": "text", "texto": mensagem, "foto_url": None, "cartao": None})
        if tipo == "imoveis":
            codigos = list(dict.fromkeys(codigos))[: acoes_rapidas.MAX_IMOVEIS]
            itens = await consulta_imoveis.obter_itens(self._session, self._tenant_id, codigos)
            if not itens:
                raise PortalErro("Escolha ao menos um imóvel da carteira.")
            for item in itens:
                saida.append({"tipo": "image", "texto": acoes_rapidas.texto_imovel(item), "foto_url": item.get("foto_url"), "cartao": None, "codigo": item["codigo"]})
        elif tipo == "lead":
            if not lead_id:
                raise PortalErro("Escolha o cliente que será enviado.")
            row = (await self._session.execute(
                text("""SELECT l.*, c.nome AS corretor_nome FROM crm_leads l
                        LEFT JOIN corretores c ON c.id = l.corretor_id
                        WHERE l.tenant_id = :tid AND l.id = :id"""),
                {"tid": str(self._tenant_id), "id": str(lead_id)},
            )).first()
            if not row:
                raise PortalErro("Cliente não encontrado.", 404)
            ficha = acoes_rapidas.ficha_do_lead(dict(row._mapping))
            saida.append({"tipo": "text", "texto": acoes_rapidas.texto_lead(ficha), "foto_url": None, "cartao": {"tipo": "lead", "lead": ficha}})
        else:
            raise PortalErro("Ação rápida desconhecida.")
        return saida

    async def enviar_acao(self, corretor, tipo: str, codigos: List[int], lead_id: Optional[UUID], mensagem: str, autor: str) -> Dict[str, Any]:
        partes = await self.montar_acao(tipo, codigos, lead_id, mensagem)
        instancia = await self._instancia()
        cliente = EvolutionClient()
        enviadas: List[Dict[str, Any]] = []
        for parte in partes:
            foto = parte["foto_url"]
            try:
                if foto:
                    try:
                        await cliente.send_media(instance_id=instancia, to=corretor.telefone, media_url=foto, caption=parte["texto"][:1000], file_name=f"imovel-{parte.get('codigo', 'foto')}.jpg")
                    except Exception as e:  # noqa: BLE001
                        log.warning("acao_rapida_foto_falhou", error=str(e)[:200])
                        await cliente.send_text(instance_id=instancia, to=corretor.telefone, text=parte["texto"])
                else:
                    await cliente.send_text(instance_id=instancia, to=corretor.telefone, text=parte["texto"])
            except Exception as e:  # noqa: BLE001
                log.warning("acao_rapida_falhou", error=str(e)[:200])
                break
            trace: Dict[str, Any] = {"origem": "humano", "autor": autor}
            if parte["cartao"]:
                trace["cartao"] = parte["cartao"]
            linha = (await self._session.execute(
                text("""
                    INSERT INTO mensagens (tenant_id, corretor_id, message_id, direcao, tipo, conteudo, midia_url, status, trace, created_at)
                    VALUES (:tid, :cid, :mid, 'outbound', :tipo, :texto, :midia, 'sent', CAST(:trace AS jsonb), clock_timestamp())
                    RETURNING id, created_at
                """),
                {
                    "tid": str(self._tenant_id), "cid": str(corretor.id), "mid": f"out_{int(time.time() * 1000)}_{uuid4().hex[:6]}",
                    "tipo": parte["tipo"], "texto": parte["texto"], "midia": foto, "trace": json.dumps(trace),
                },
            )).first()
            enviadas.append({
                "id": str(linha.id), "direcao": "outbound", "tipo": parte["tipo"], "conteudo": parte["texto"], "status": "sent",
                "midia": foto, "created_at": linha.created_at.isoformat(), "origem": "humano", "autor": autor,
                "cartao": parte["cartao"], "processo": None,
            })
        if not enviadas:
            raise PortalErro("Não consegui entregar a mensagem agora. Tente de novo em instantes.", 502)
        return {"mensagens": enviadas, "falhas": len(partes) - len(enviadas)}

    async def criar_nota(self, corretor_id: UUID, texto: str, autor: str) -> Dict[str, Any]:
        texto = (texto or "").strip()
        if not texto:
            raise PortalErro("Escreva a nota antes de salvar.")
        if len(texto) > MAX_TEXTO:
            raise PortalErro(f"A nota passa de {MAX_TEXTO} caracteres.")
        r = await self._session.execute(
            text("""
                INSERT INTO conversa_notas (tenant_id, corretor_id, autor, texto)
                VALUES (:tid, :cid, :autor, :texto) RETURNING id, created_at
            """),
            {"tid": str(self._tenant_id), "cid": str(corretor_id), "autor": autor[:255], "texto": texto},
        )
        linha = r.first()
        return {
            "id": str(linha.id), "direcao": "nota", "tipo": "nota", "conteudo": texto, "status": "nota",
            "midia_url": None, "created_at": linha.created_at.isoformat(), "origem": "nota", "autor": autor,
            "processo": None,
        }

    # --- Ficha do corretor ----------------------------------------------------

    async def detalhes(self, corretor) -> Dict[str, Any]:
        tid, cid = str(self._tenant_id), str(corretor.id)
        crm = CrmService(self._session)

        resumo = (await self._session.execute(
            text("""
                SELECT COUNT(*) AS total,
                       COUNT(*) FILTER (WHERE direcao = 'inbound') AS recebidas,
                       COUNT(*) FILTER (WHERE direcao = 'outbound') AS enviadas,
                       COUNT(*) FILTER (WHERE tipo = 'audio') AS audios,
                       COUNT(*) FILTER (WHERE tipo = 'image') AS fotos,
                       COUNT(*) FILTER (WHERE trace->'processo'->>'rota' = 'fallback') AS fallbacks,
                       COUNT(*) FILTER (WHERE trace->>'origem' = 'humano') AS da_equipe,
                       MIN(created_at) AS primeira, MAX(created_at) AS ultima
                FROM mensagens WHERE tenant_id = :tid AND corretor_id = :cid
            """),
            {"tid": tid, "cid": cid},
        )).first()

        leads = await crm.listar_leads(self._tenant_id, corretor_id=corretor.id, limit=8)
        negocios = await crm.listar_negocios(self._tenant_id, corretor.id, status="aberto")
        agora = datetime.now(timezone.utc)
        agenda = await crm.agenda(self._tenant_id, corretor.id, de=agora, ate=agora + timedelta(days=7))

        acoes_rows = await self._session.execute(
            text("""
                SELECT acao, payload_depois, origem, created_at FROM auditoria
                WHERE tenant_id = :tid AND corretor_id = :cid ORDER BY created_at DESC LIMIT 15
            """),
            {"tid": tid, "cid": cid},
        )
        acoes = [
            {"acao": a.acao, "descricao": descrever_acao(a.acao, a.payload_depois), "origem": a.origem, "quando": a.created_at.isoformat()}
            for a in acoes_rows.fetchall()
        ]

        return {
            "corretor": {
                "id": cid, "nome": corretor.nome, "telefone_mascarado": mask_phone(corretor.telefone),
                "email": corretor.email, "status": corretor.status,
                "cadastrado_em": corretor.created_at.isoformat() if corretor.created_at else None,
            },
            "atendimento": {
                "iniciado_em": resumo.primeira.isoformat() if resumo.primeira else None,
                "ultima_em": resumo.ultima.isoformat() if resumo.ultima else None,
                "mensagens": resumo.total, "recebidas": resumo.recebidas, "enviadas": resumo.enviadas,
                "audios": resumo.audios, "fotos": resumo.fotos, "fallbacks": resumo.fallbacks, "da_equipe": resumo.da_equipe,
            },
            "carteira": [
                {"id": l["id"], "nome": l["nome"], "temperatura": l.get("temperatura"), "perfil": resumo_perfil(l.get("perfil") or {}),
                 "negocios_abertos": l.get("negocios_abertos") or 0}
                for l in leads
            ],
            "negocios": [
                {"id": n["id"], "cliente": n["lead_nome"], "etapa": n["etapa_nome"], "valor": n["valor"], "dias": n["dias_na_etapa"], "travado": bool(n["travado"])}
                for n in negocios[:6]
            ],
            "negocios_abertos": len(negocios),
            "atividades": [
                {"id": a["id"], "titulo": a["titulo"], "inicio": a["inicio"], "tipo": a.get("tipo"), "atrasada": bool(a.get("atrasada"))}
                for a in agenda[:6]
            ],
            "acoes": acoes,
        }

    async def resumir(self, corretor_id: UUID) -> str:
        rows = await self._session.execute(
            text("""
                SELECT direcao, tipo, conteudo, transcricao FROM mensagens
                WHERE tenant_id = :tid AND corretor_id = :cid
                ORDER BY created_at DESC LIMIT 40
            """),
            {"tid": str(self._tenant_id), "cid": str(corretor_id)},
        )
        linhas = []
        for m in reversed(rows.fetchall()):
            corpo = (m.transcricao or m.conteudo or "").strip().replace("\n", " ")
            if m.tipo == "image":
                corpo = "[enviou a foto de um imóvel] " + corpo[:80]
            if corpo:
                linhas.append(f"{'Corretor' if m.direcao == 'inbound' else 'Acessor'}: {corpo[:400]}")
        if not linhas:
            raise PortalErro("Ainda não há mensagens para resumir.")
        try:
            resposta = await GeminiClient().gerar(
                "Você resume conversas de WhatsApp entre um corretor de imóveis e o assistente Acessor, "
                "para o gestor da imobiliária. Escreva em português, em 4 a 6 linhas curtas, sem enfeite: "
                "o que o corretor pediu, o que o assistente fez, o que ficou pendente e o próximo passo sugerido. "
                "Não invente nada que não esteja na conversa.",
                [{"role": "user", "content": "\n".join(linhas)}],
                temperature=0.3, max_tokens=500,
            )
        except GeminiError as e:
            log.warning("resumo_gemini_falhou", error=str(e)[:200])
            raise PortalErro("A IA está indisponível no momento. Tente de novo em instantes.", 503)
        texto = (resposta.get("text") or "").strip()
        if not texto:
            raise PortalErro("Não consegui resumir agora. Tente de novo.", 502)
        return texto
