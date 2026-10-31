"""
Assistente de IA do portal da imobiliária (caixa "Pergunte ao Acessor" do Início).

Responde ao administrador com os dados da imobiliária inteira: um resumo do dia
(agenda, funil, leads quentes, conversas sem resposta) vai no prompt, e três
ferramentas de leitura buscam o que passar disso. O assistente não grava nada:
cadastrar e agendar continuam sendo feitos pelo agente do WhatsApp.
"""
import base64
import binascii
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.conversa.service import ConversaService
from app.domain.crm.service import CrmService, resumo_perfil
from app.domain.book import servico as servico_book
from app.domain.imovel import consulta as consulta_imoveis
from app.domain.imovel.service import ImovelService
from app.integration.llm.gemini import GeminiClient, GeminiError
from app.shared.config import get_settings
from app.shared.storage import guardar_midia, ler_midia

log = structlog.get_logger()
settings = get_settings()

TITULO_PADRAO = "Nova conversa"
MAX_TEXTO = 4000
MAX_ANEXOS = 3
MAX_BYTES_ANEXO = 4 * 1024 * 1024
MAX_TEXTO_ARQUIVO = 20_000
MIMES_INLINE = {"image/png", "image/jpeg", "image/webp", "application/pdf"}
MIMES_TEXTO = {"text/plain", "text/csv", "text/markdown"}
JANELA_HISTORICO = 12

_DIAS = ("segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo")


class AssistenteErro(Exception):
    """Erro de uso (conversa inexistente, anexo inválido) ou IA indisponível."""

    def __init__(self, mensagem: str, status: int = 400):
        super().__init__(mensagem)
        self.status = status


ASSISTENTE_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "buscar_leads",
            "description": "Busca clientes (leads) da carteira de qualquer corretor da imobiliária pelo nome ou telefone.",
            "parameters": {
                "type": "object",
                "properties": {"termo": {"type": "string", "description": "Nome ou parte do nome."}},
                "required": ["termo"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "buscar_imoveis",
            "description": "Busca imóveis disponíveis da imobiliária para aluguel ou venda. Nunca invente imóveis: use esta ferramenta.",
            "parameters": {
                "type": "object",
                "properties": {
                    "finalidade": {"type": "string", "enum": ["aluguel", "venda"]},
                    "bairro": {"type": "string"},
                    "tipo": {"type": "string", "description": "apartamento, casa, lote..."},
                    "quartos": {"type": "integer", "description": "Mínimo de quartos."},
                    "valor_max": {"type": "number", "description": "Valor máximo em reais."},
                    "limite": {"type": "integer", "description": "Quantidade (padrão 5, máximo 8)."},
                    "formato": {
                        "type": "string", "enum": ["cards", "book"],
                        "description": "'cards' (padrão): cartões com foto, dados e link. 'book': PDF profissional com todas as fotos; use quando pedirem pdf, book, catálogo ou apresentação.",
                    },
                    "titulo": {"type": "string", "description": "Título da capa do book (ex.: 'Imóveis na Orla'). Opcional."},
                },
                "required": ["finalidade"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "match_lead",
            "description": "Mostra imóveis da carteira que combinam com o perfil de busca de um cliente.",
            "parameters": {
                "type": "object",
                "properties": {"cliente": {"type": "string", "description": "Nome do cliente."}},
                "required": ["cliente"],
            },
        },
    },
]


def _reais(valor: Any) -> str:
    try:
        return "R$ " + f"{float(valor):,.0f}".replace(",", ".")
    except (TypeError, ValueError):
        return "R$ 0"


def _linha_imovel(im: Dict[str, Any]) -> str:
    partes = [f"cód. {im.get('codigo')}", im.get("tipo") or "Imóvel", im.get("bairro") or "bairro n/i"]
    if im.get("quartos"):
        partes.append(f"{im['quartos']} quartos")
    if im.get("vagas"):
        partes.append(f"{im['vagas']} vagas")
    if im.get("area_m2"):
        partes.append(f"{float(im['area_m2']):.0f} m²")
    if im.get("valor"):
        partes.append(_reais(im["valor"]))
    return "- " + " · ".join(str(p) for p in partes)


def preparar_anexos(brutos: List[Dict[str, Any]]) -> Tuple[List[Dict[str, str]], str, List[Dict[str, str]]]:
    """
    Valida os anexos. Devolve (inline para o Gemini, texto extraído de arquivos
    de texto, metadados para o histórico). Nada do conteúdo é guardado.
    """
    if len(brutos) > MAX_ANEXOS:
        raise AssistenteErro(f"Envie no máximo {MAX_ANEXOS} arquivos por mensagem.")
    inline: List[Dict[str, str]] = []
    textos: List[str] = []
    meta: List[Dict[str, str]] = []
    for a in brutos:
        nome = (a.get("nome") or "arquivo")[:120]
        mime = (a.get("mime") or "").lower()
        if mime not in MIMES_INLINE and mime not in MIMES_TEXTO:
            raise AssistenteErro(f"Tipo de arquivo não suportado: {nome}. Use imagem, PDF, TXT ou CSV.")
        try:
            dados = base64.b64decode(a.get("dados") or "", validate=True)
        except (binascii.Error, ValueError):
            raise AssistenteErro(f"Não consegui ler o arquivo {nome}.")
        if not dados or len(dados) > MAX_BYTES_ANEXO:
            raise AssistenteErro(f"O arquivo {nome} passa de {MAX_BYTES_ANEXO // (1024 * 1024)} MB ou está vazio.")
        if mime in MIMES_INLINE:
            inline.append({"mime": mime, "dados": base64.b64encode(dados).decode()})
        else:
            conteudo = dados.decode("utf-8", errors="replace")[:MAX_TEXTO_ARQUIVO]
            textos.append(f"[Arquivo {nome}]\n{conteudo}")
        meta.append({"nome": nome, "tipo": mime})
    return inline, "\n\n".join(textos), meta


def titulo_da_conversa(texto: str) -> str:
    limpo = re.sub(r"\s+", " ", texto or "").strip()
    if not limpo:
        return TITULO_PADRAO
    if len(limpo) <= 60:
        return limpo
    return limpo[:60].rsplit(" ", 1)[0].rstrip(",.;:") + "…"


class AssistenteService:
    def __init__(self, session: AsyncSession, tenant_id: UUID, admin_id: UUID):
        self._session = session
        self._tenant_id = tenant_id
        self._admin_id = admin_id
        self._blocos: List[Dict[str, Any]] = []
        self._crm = CrmService(session)

    # --- Conversas ----------------------------------------------------------

    async def listar(self, busca: Optional[str] = None, limite: int = 60) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {"tid": str(self._tenant_id), "aid": str(self._admin_id), "limite": limite}
        filtro = ""
        if busca and busca.strip():
            params["q"] = f"%{busca.strip()}%"
            filtro = """AND (c.titulo ILIKE :q OR EXISTS (
                SELECT 1 FROM assistente_mensagens m WHERE m.conversa_id = c.id AND m.conteudo ILIKE :q))"""
        rows = await self._session.execute(
            text(f"""
                SELECT c.id, c.titulo, c.updated_at FROM assistente_conversas c
                WHERE c.tenant_id = :tid AND c.admin_id = :aid {filtro}
                ORDER BY c.updated_at DESC LIMIT :limite
            """),
            params,
        )
        return [
            {"id": str(r.id), "titulo": r.titulo, "atualizada_em": r.updated_at.isoformat()}
            for r in rows.fetchall()
        ]

    async def criar(self, titulo: str = TITULO_PADRAO) -> Dict[str, Any]:
        row = await self._session.execute(
            text("""
                INSERT INTO assistente_conversas (tenant_id, admin_id, titulo)
                VALUES (:tid, :aid, :titulo) RETURNING id, titulo, updated_at
            """),
            {"tid": str(self._tenant_id), "aid": str(self._admin_id), "titulo": titulo[:120]},
        )
        r = row.first()
        return {"id": str(r.id), "titulo": r.titulo, "atualizada_em": r.updated_at.isoformat()}

    async def _conversa(self, conversa_id: UUID) -> Dict[str, Any]:
        row = await self._session.execute(
            text("""
                SELECT id, titulo FROM assistente_conversas
                WHERE id = :id AND tenant_id = :tid AND admin_id = :aid
            """),
            {"id": str(conversa_id), "tid": str(self._tenant_id), "aid": str(self._admin_id)},
        )
        r = row.first()
        if not r:
            raise AssistenteErro("Conversa não encontrada.", status=404)
        return {"id": str(r.id), "titulo": r.titulo}

    async def mensagens(self, conversa_id: UUID) -> List[Dict[str, Any]]:
        await self._conversa(conversa_id)
        rows = await self._session.execute(
            text("""
                SELECT id, papel, conteudo, anexos, blocos, created_at FROM assistente_mensagens
                WHERE conversa_id = :cid ORDER BY created_at
            """),
            {"cid": str(conversa_id)},
        )
        return [
            {
                "id": str(r.id), "papel": r.papel, "conteudo": r.conteudo,
                "anexos": r.anexos or [], "blocos": self._publicar_blocos(str(r.id), r.blocos or []),
                "criada_em": r.created_at.isoformat(),
            }
            for r in rows.fetchall()
        ]

    async def excluir(self, conversa_id: UUID) -> None:
        await self._conversa(conversa_id)
        await self._session.execute(
            text("DELETE FROM assistente_conversas WHERE id = :id AND tenant_id = :tid"),
            {"id": str(conversa_id), "tid": str(self._tenant_id)},
        )

    async def _salvar(
        self, conversa_id: UUID, papel: str, conteudo: str, anexos: Optional[List[Dict[str, str]]] = None,
        blocos: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        import json

        row = await self._session.execute(
            text("""
                INSERT INTO assistente_mensagens (tenant_id, conversa_id, papel, conteudo, anexos, blocos)
                VALUES (:tid, :cid, :papel, :conteudo, CAST(:anexos AS jsonb), CAST(:blocos AS jsonb))
                RETURNING id, created_at
            """),
            {
                "tid": str(self._tenant_id), "cid": str(conversa_id), "papel": papel,
                "conteudo": conteudo, "anexos": json.dumps(anexos or []), "blocos": json.dumps(blocos or []),
            },
        )
        r = row.first()
        return {
            "id": str(r.id), "papel": papel, "conteudo": conteudo,
            "anexos": anexos or [], "blocos": self._publicar_blocos(str(r.id), blocos or []), "criada_em": r.created_at.isoformat(),
        }

    @staticmethod
    def _publicar_blocos(mensagem_id: str, blocos: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Blocos como o portal os vê: o PDF vira um endereço da API (a referência do storage nunca sai)."""
        saida = []
        for b in blocos:
            if b.get("tipo") == "book":
                b = {k: v for k, v in b.items() if k != "ref"}
                b["url"] = f"/admin/assistente/mensagens/{mensagem_id}/book"
            saida.append(b)
        return saida

    async def arquivo_do_book(self, mensagem_id: UUID) -> Optional[Tuple[bytes, str, str]]:
        r = (await self._session.execute(
            text("SELECT blocos FROM assistente_mensagens WHERE id = :id AND tenant_id = :tid"),
            {"id": str(mensagem_id), "tid": str(self._tenant_id)},
        )).first()
        for b in (r.blocos if r else None) or []:
            if b.get("tipo") == "book" and b.get("ref"):
                lido = await ler_midia(b["ref"])
                if lido:
                    return lido[0], lido[1], b.get("arquivo") or "book.pdf"
        return None

    # --- Contexto -----------------------------------------------------------

    async def _tenant(self) -> Tuple[str, ZoneInfo]:
        row = await self._session.execute(
            text("SELECT nome, agent_config FROM tenants WHERE id = :tid"), {"tid": str(self._tenant_id)}
        )
        r = row.first()
        cfg = (r.agent_config if r else None) or {}
        fuso = ZoneInfo(cfg.get("fuso") or settings.usage_timezone or "America/Sao_Paulo")
        return (r.nome if r else "a imobiliária"), fuso

    async def _contexto(self, fuso: ZoneInfo) -> str:
        """Resumo curto do estado da imobiliária; evita uma ida ao banco por pergunta comum."""
        agora = datetime.now(fuso)
        inicio = agora.replace(hour=0, minute=0, second=0, microsecond=0)
        linhas: List[str] = []

        def quando(iso: Optional[str]) -> str:
            if not iso:
                return "sem data"
            d = datetime.fromisoformat(iso).astimezone(fuso)
            return f"{_DIAS[d.weekday()][:3]} {d:%d/%m %H:%M}"

        try:
            agenda = await self._crm.agenda(self._tenant_id, None, de=inicio, ate=inicio + timedelta(days=2))
            atrasadas = [a for a in agenda if a.get("atrasada")]
            proximas = [a for a in agenda if a.get("inicio") and not a.get("atrasada")]
            linhas.append(f"Agenda de hoje e amanhã ({len(proximas)}):")
            linhas += [f"- {quando(a['inicio'])} {a['titulo']} ({a.get('corretor_nome') or '?'})" for a in proximas[:8]] or ["- nada marcado"]
            if atrasadas:
                linhas.append(f"Atividades atrasadas ({len(atrasadas)}):")
                linhas += [f"- {a['titulo']} ({a.get('corretor_nome') or '?'}) era {quando(a['inicio'])}" for a in atrasadas[:5]]

            previsao = await self._crm.forecast(self._tenant_id)
            linhas.append(
                f"Funil: {previsao['quantidade']} negócios abertos, {_reais(previsao['total'])} no total, "
                f"{_reais(previsao['esperado'])} previstos (valor × probabilidade)."
            )
            linhas += [
                f"- {e['etapa']}: {e['quantidade']} negócios, {_reais(e['total'])}" + (f", {e['travados']} travados" if e["travados"] else "")
                for e in previsao["etapas"] if e["quantidade"]
            ]
            travados = [n for n in await self._crm.listar_negocios(self._tenant_id, status="aberto") if n.get("travado")]
            if travados:
                linhas.append("Negócios travados:")
                linhas += [
                    f"- {n['lead_nome']} em {n['etapa_nome']} há {n['dias_na_etapa']} dias ({_reais(n['valor'])}, {n.get('corretor_nome') or '?'})"
                    for n in travados[:6]
                ]

            leads = await self._crm.listar_leads(self._tenant_id, limit=200)
            quentes = [l for l in leads if l.get("temperatura") == "quente"]
            linhas.append(f"Carteira: {len(leads)} clientes, {len(quentes)} quentes.")
            linhas += [
                f"- {l['nome']} ({l.get('corretor_nome') or '?'}): {resumo_perfil(l.get('perfil') or {})}" for l in quentes[:6]
            ]

            conversas = await ConversaService(self._session).listar_conversas(self._tenant_id)
            sem_resposta = [c for c in conversas if c.get("nao_respondidas")]
            if sem_resposta:
                linhas.append("Conversas com o agente aguardando resposta:")
                linhas += [f"- {c.get('corretor_nome') or 'corretor'}: {c['nao_respondidas']} mensagens" for c in sem_resposta[:5]]
        except Exception as e:  # noqa: BLE001 - sem o resumo o assistente ainda responde, com ferramentas
            log.warning("assistente_contexto_falhou", error=str(e)[:200])
            linhas.append("(não consegui carregar o resumo da imobiliária agora)")
        return "\n".join(linhas)

    async def _prompt_sistema(self) -> str:
        nome, fuso = await self._tenant()
        agora = datetime.now(fuso)
        contexto = await self._contexto(fuso)
        return (
            f"Você é o Acessor, o assistente de IA do portal da imobiliária {nome}. Quem fala com você "
            "é o administrador/gestor, que acompanha a equipe de corretores.\n\n"
            f"Agora é {_DIAS[agora.weekday()]}-feira, {agora:%d/%m/%Y %H:%M}.\n\n"
            "## Como responder\n"
            "- Português do Brasil, direto e útil, como um colega de confiança. Respostas curtas; só alongue "
            "quando pedirem relatório, diagnóstico ou texto para copiar.\n"
            "- Use os dados abaixo e as ferramentas. Nunca invente nomes, valores, imóveis ou números. Se o dado "
            "não existe, diga isso e sugira o próximo passo.\n"
            "- Formatação permitida: **negrito**, listas com '-' e títulos curtos com '##'. Sem tabelas.\n"
            "- Para imóveis, use sempre buscar_imoveis ou match_lead: os cartões com foto e link aparecem sozinhos abaixo da sua resposta. "
            "Se pedirem PDF, book, catálogo ou apresentação, use buscar_imoveis com formato 'book'. Para clientes, buscar_leads.\n"
            "- Você só lê dados: não cadastra, não agenda e não envia mensagens. Se pedirem isso, explique que o "
            "corretor faz pelo WhatsApp com o agente, ou pelo portal.\n"
            "- Quando pedirem rascunho para um cliente (WhatsApp, objeção, tradução), escreva o texto pronto para "
            "copiar, no tom da imobiliária.\n"
            "- Perguntas sobre como usar a plataforma: o portal tem Início, Visão Geral, Conversas (o que o agente "
            "trocou com os corretores), Clientes, Negociações (funil), Agenda, Corretores, WhatsApp (conectar o "
            "número do agente), Agente (persona, tom, voz e confirmação de ações) e Auditoria.\n\n"
            f"## Situação da imobiliária agora\n{contexto}"
        )

    # --- Ferramentas --------------------------------------------------------

    async def _anexar_imoveis(self, codigos: List[int], book: bool, titulo: Optional[str]) -> str:
        """Guarda os blocos que a resposta mostrará (cartões ou book em PDF) e devolve a nota para a IA."""
        itens = await consulta_imoveis.obter_itens(self._session, self._tenant_id, codigos)
        cartoes = [
            {k: i.get(k) for k in ("codigo", "titulo", "finalidade", "tipo", "bairro", "cidade", "valor", "quartos", "suites", "vagas", "area_m2", "foto_url", "link")}
            for i in itens
        ]
        if book and cartoes:
            try:
                r = await servico_book.gerar_book(self._session, self._tenant_id, [c["codigo"] for c in cartoes], None, titulo, None)
                ref = await guardar_midia(self._tenant_id, self._admin_id or self._tenant_id, r["pdf"], "pdf", "application/pdf")
                if ref:
                    self._blocos.append({
                        "tipo": "book", "titulo": r["titulo"], "modelo": r["modelo"], "arquivo": r["arquivo"], "ref": ref,
                        "imoveis": cartoes,
                    })
                    return "\n[O book em PDF com esses imóveis já foi gerado e aparece anexado abaixo da sua resposta.]"
            except Exception as e:  # noqa: BLE001 - sem o PDF a resposta ainda leva os cartões
                log.warning("assistente_book_falhou", error=str(e)[:200])
        if cartoes:
            self._blocos.append({"tipo": "imoveis", "titulo": titulo, "imoveis": cartoes})
            if book:
                return "\n[ATENÇÃO: não foi possível gerar o PDF agora; no lugar, os cartões com foto e link aparecem abaixo. Avise o administrador disso.]"
            return "\n[Os cartões com foto, dados e link desses imóveis aparecem abaixo da sua resposta.]"
        return ""

    async def _executar(self, nome: str, args: Dict[str, Any]) -> str:
        if nome == "buscar_leads":
            leads = await self._crm.listar_leads(self._tenant_id, termo=args.get("termo"), limit=10, incluir_sem_responsavel=True)
            if not leads:
                return f"Nenhum cliente encontrado para '{args.get('termo', '')}'."
            return "\n".join(
                f"- {l['nome']} ({l.get('temperatura')}, corretor {l.get('corretor_nome') or '?'})"
                f" — {resumo_perfil(l.get('perfil') or {})}"
                + (f" · {l['negocios_abertos']} negócio(s) aberto(s)" if l.get("negocios_abertos") else "")
                for l in leads
            )
        if nome == "buscar_imoveis":
            try:
                limite = max(1, min(int(args.get("limite") or 5), 8))
            except (TypeError, ValueError):
                limite = 5
            imoveis = await ImovelService(self._session).buscar(
                tenant_id=self._tenant_id,
                finalidade=args.get("finalidade", "aluguel"),
                bairro=args.get("bairro"),
                tipo=args.get("tipo"),
                quartos_min=args.get("quartos"),
                valor_max=args.get("valor_max"),
                limit=limite,
            )
            if not imoveis:
                return "Nenhum imóvel encontrado com esses critérios."
            texto = "\n".join(_linha_imovel(i) for i in imoveis)
            return texto + await self._anexar_imoveis(
                [i["codigo"] for i in imoveis], args.get("formato") == "book", (args.get("titulo") or "").strip()[:80] or None,
            )
        if nome == "match_lead":
            leads = await self._crm.listar_leads(self._tenant_id, termo=args.get("cliente"), limit=1, incluir_sem_responsavel=True)
            if not leads:
                return f"Não achei o cliente '{args.get('cliente', '')}'."
            lead = leads[0]
            if not lead.get("perfil"):
                return f"{lead['nome']} ainda não tem perfil de busca registrado."
            imoveis = await self._crm.match(self._tenant_id, lead)
            cabecalho = f"Perfil de {lead['nome']}: {resumo_perfil(lead['perfil'])}"
            texto = cabecalho + "\n" + ("\n".join(_linha_imovel(i) for i in imoveis) or "Nada na carteira combina hoje.")
            if imoveis:
                texto += await self._anexar_imoveis([i["codigo"] for i in imoveis], False, None)
            return texto
        return "Ferramenta desconhecida."

    # --- Resposta -----------------------------------------------------------

    async def responder(self, conversa_id: UUID, texto: str, anexos_brutos: List[Dict[str, Any]]) -> Dict[str, Any]:
        conversa = await self._conversa(conversa_id)
        texto = (texto or "").strip()[:MAX_TEXTO]
        inline, texto_arquivos, meta = preparar_anexos(anexos_brutos)
        if not texto and not meta:
            raise AssistenteErro("Escreva uma pergunta ou anexe um arquivo.")

        self._blocos = []
        historico = await self.mensagens(conversa_id)
        pergunta = await self._salvar(conversa_id, "user", texto or "(arquivo anexado)", meta)

        titulo = conversa["titulo"]
        if titulo == TITULO_PADRAO:
            titulo = titulo_da_conversa(texto or meta[0]["nome"])

        system = await self._prompt_sistema()
        conteudo = "\n\n".join(p for p in (texto, texto_arquivos) if p) or "Analise o arquivo anexado."
        messages: List[Dict[str, Any]] = [{"role": "system", "content": system}]
        messages += [{"role": h["papel"], "content": h["conteudo"]} for h in historico[-JANELA_HISTORICO:]]
        messages.append({"role": "user", "content": conteudo, "anexos": inline})

        try:
            cliente = GeminiClient()
            resposta = await cliente.gerar(system, messages, tools=ASSISTENTE_TOOLS, temperature=0.5, max_tokens=1500)
            chamada = resposta.get("function_call")
            if chamada:
                resultado = await self._executar(chamada["name"], chamada.get("args") or {})
                natural = await cliente.gerar_apos_ferramenta(
                    system_prompt=system, messages=messages, nome_funcao=chamada["name"],
                    argumentos=chamada.get("args") or {}, resultado=resultado,
                    instrucao=(
                        "Responda ao administrador com base no resultado acima, sem inventar dados e sem "
                        "repetir a lista bruta: destaque o que importa e sugira o próximo passo. Se o resultado "
                        "diz que cartões ou um book foram anexados, não liste os imóveis em texto: comente em "
                        "uma ou duas frases o que foi encontrado e diga que estão logo abaixo; se foram cartões, "
                        "ofereça montar o book em PDF."
                    ),
                    function_call_part=resposta.get("function_call_part"), temperature=0.5, max_tokens=1500,
                )
                resposta_texto = natural or resultado
            else:
                resposta_texto = resposta.get("text") or ""
        except GeminiError as e:
            log.warning("assistente_gemini_falhou", error=str(e)[:200])
            raise AssistenteErro("A IA está indisponível no momento. Tente de novo em instantes.", status=503)

        resposta_texto = resposta_texto.strip()
        if not resposta_texto:
            raise AssistenteErro("Não consegui formular uma resposta. Pode reformular a pergunta?", status=502)

        resposta_msg = await self._salvar(conversa_id, "assistant", resposta_texto, None, self._blocos)
        await self._session.execute(
            text("UPDATE assistente_conversas SET titulo = :t, updated_at = NOW() WHERE id = :id"),
            {"t": titulo, "id": str(conversa_id)},
        )
        return {"titulo": titulo, "pergunta": pergunta, "resposta": resposta_msg}
