"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Info, Loader2, MessageSquare, MoreHorizontal, RefreshCw, Sparkles } from "lucide-react";
import { fetchApi } from "@/lib/api";
import ChatMensagens, { MensagemChat } from "../ChatMensagens";
import CompositorConversa, { ModoCompositor } from "./CompositorConversa";
import { useEhCorretor } from "@/components/portal/papel";
import AcoesRapidas, { TipoAcao } from "./AcoesRapidas";
import CompositorAtendimento, { ID_CAMPO_ATENDIMENTO } from "./CompositorAtendimento";
import ListaConversas, { Avatar, Filtro } from "./ListaConversas";
import PainelAtendimento, { AbaAtendimento } from "./PainelAtendimento";
import PainelDetalhes, { AbaDetalhes, ResumoEstado } from "./PainelDetalhes";
import type { AtendimentoDetalhe, AtendimentoItem, ConversaResumo } from "./tipos";

class ErroApi extends Error {}

const detalheDoErro = (dados: { detail?: unknown }, padrao: string) => (typeof dados.detail === "string" ? dados.detail : padrao);

/** Atendimentos: a mesma tela de Conversas, mas a lista são os clientes do corretor no WhatsApp pessoal. */
export interface FonteAtendimentos {
  itens: AtendimentoItem[];
  /** Inclui conversas que o Acessor não classificou como de imobiliária. */
  todos: boolean;
  onTodos: (v: boolean) => void;
  /** Id do corretor logado: as ações rápidas mandam o material para o WhatsApp dele. */
  meuId: string;
  onAbrirCliente?: (leadId: string) => void;
  /** Texto e ação da lista vazia (explica o motivo: assistente desligado, WhatsApp desconectado, nada lido ainda). */
  vazio?: { titulo: string; detalhe: string; acao?: { rotulo: string; onClick: () => void; ocupado?: boolean } };
}

const FILTROS_ATENDIMENTO: { id: Filtro; rotulo: string }[] = [
  { id: "todas", rotulo: "Todas" },
  { id: "sem-resposta", rotulo: "Sem resposta" },
  { id: "hoje", rotulo: "Hoje" },
];

type MensagemAt = { id: string; autor: string; tipo: string; conteudo: string | null; transcricao: string | null; created_at: string | null };
const mensagemDoAtendimento = (m: MensagemAt): MensagemChat => ({
  id: m.id, direcao: m.autor === "corretor" ? "outbound" : "inbound", tipo: m.tipo, status: "sent", created_at: m.created_at,
  conteudo: m.tipo === "audio" ? (m.transcricao || m.conteudo) : (m.conteudo || m.transcricao), origem: null,
} as MensagemChat);

export default function Conversas({
  conversas,
  carregando,
  onRecarregar,
  onAuthError,
  onIr,
  corretorInicial,
  atendimentos,
}: {
  conversas: ConversaResumo[];
  carregando: boolean;
  onRecarregar: () => void;
  onAuthError: (e: unknown) => boolean;
  onIr: (tab: string) => void;
  /** Corretor a abrir assim que a lista carregar (vem do painel do corretor). */
  corretorInicial?: string | null;
  /** Presente = a lista é de atendimentos (portal do corretor) em vez das conversas com o agente. */
  atendimentos?: FonteAtendimentos;
}) {
  const modoAt = !!atendimentos;
  const [selId, setSelId] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<MensagemChat[]>([]);
  const [carregandoMsgs, setCarregandoMsgs] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);

  const [detalhesAberto, setDetalhesAberto] = useState(false);
  const [aba, setAba] = useState<AbaDetalhes>("info");
  const [foco, setFoco] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [resumo, setResumo] = useState<ResumoEstado>({ estado: "ocioso", texto: "" });

  const ehCorretor = useEhCorretor();  // o corretor só conversa com o agente: sem intervenção da equipe nem notas internas
  const [modo, setModo] = useState<ModoCompositor>("mensagem");
  const [acao, setAcao] = useState<TipoAcao | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [detalheAt, setDetalheAt] = useState<AtendimentoDetalhe | null>(null);
  const [abaAt, setAbaAt] = useState<AbaAtendimento>("info");
  const [reanalisando, setReanalisando] = useState(false);
  const [erroAnalise, setErroAnalise] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [jaSugeriu, setJaSugeriu] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const rolagem = useRef<HTMLDivElement | null>(null);
  const perto = useRef(true);
  const forcarFim = useRef(true);
  const selRef = useRef<string | null>(null);
  selRef.current = selId;

  // Atendimento reclassificado como pessoal sai da lista, mas continua aberto até o usuário sair dele.
  const ultimo = useRef<{ id: string; conversa: ConversaResumo; item: AtendimentoItem | null } | null>(null);
  const achada = conversas.find((c) => c.corretor_id === selId) || null;
  if (achada && selId) ultimo.current = { id: selId, conversa: achada, item: modoAt ? atendimentos!.itens.find((a) => a.id === selId) || null : null };
  const sel = achada || (modoAt && ultimo.current?.id === selId ? ultimo.current.conversa : null);
  // Alterações feitas no painel (tipo, foto, nome) valem na hora, antes de a lista recarregar.
  const [ajustes, setAjustes] = useState<Record<string, Partial<AtendimentoItem>>>({});
  const selBase = modoAt ? (atendimentos!.itens.find((a) => a.id === selId) || (ultimo.current?.id === selId ? ultimo.current.item : null)) : null;
  const selAt = selBase ? { ...selBase, ...(ajustes[selBase.id] ?? {}) } : null;

  // O painel de detalhes abre por padrão em telas largas; em telas menores é uma gaveta.
  useEffect(() => {
    setDetalhesAberto(window.matchMedia("(min-width: 1280px)").matches);
  }, []);

  const carregarWhatsapp = useCallback(async () => {
    if (ehCorretor && !modoAt) return;  // o estado do WhatsApp do agente é da gestão
    try {
      const res = await fetchApi(modoAt ? "/corretor/whatsapp" : "/admin/whatsapp");
      if (res.ok) setOnline((await res.json()).status === "connected");
    } catch (e) {
      onAuthError(e);
    }
  }, [onAuthError, ehCorretor, modoAt]);

  useEffect(() => {
    carregarWhatsapp();
    const id = setInterval(carregarWhatsapp, 30000);
    return () => clearInterval(id);
  }, [carregarWhatsapp]);

  const buscarMensagens = useCallback(
    async (id: string, silencioso: boolean) => {
      if (!silencioso) setCarregandoMsgs(true);
      try {
        const res = await fetchApi(modoAt ? `/corretor/atendimentos/${id}` : `/admin/conversas/${id}/mensagens?limit=200`);
        if (!res.ok) throw new ErroApi("Não foi possível carregar as mensagens desta conversa.");
        const dados = await res.json();
        if (selRef.current !== id) return;
        if (modoAt) setDetalheAt(dados as AtendimentoDetalhe);
        const bruto: MensagemChat[] = modoAt
          ? (dados as AtendimentoDetalhe).mensagens.map(mensagemDoAtendimento)
          : dados.mensagens || [];
        const novas: MensagemChat[] = bruto.filter((m: MensagemChat) => !ehCorretor || m.origem !== "nota");
        setMensagens((antes) => {
          const mesma = antes.length === novas.length && antes[antes.length - 1]?.id === novas[novas.length - 1]?.id;
          return mesma ? antes : novas;
        });
        setErro(null);
      } catch (e) {
        if (silencioso) return;
        if (!onAuthError(e)) setErro(e instanceof ErroApi ? e.message : "Falha de comunicação com a API.");
        setMensagens([]);
      } finally {
        if (!silencioso) setCarregandoMsgs(false);
      }
    },
    [onAuthError, ehCorretor, modoAt]
  );

  const abrir = (c: ConversaResumo) => {
    if (c.corretor_id !== selId) {
      setSelId(c.corretor_id);
      setMensagens([]);
      setDetalheAt(null);
      setAbaAt("info");
      setErroAnalise(null);
      setJaSugeriu(false);
      setInfo(null);
      setResumo({ estado: "ocioso", texto: "" });
      setFoco(null);
      setTexto("");
      setErroEnvio(null);
      setMenu(false);
      forcarFim.current = true;
    }
    buscarMensagens(c.corretor_id, false);
  };

  const iniciado = useRef<string | null>(null);
  useEffect(() => {
    if (!corretorInicial || iniciado.current === corretorInicial) return;
    const alvo = conversas.find((c) => c.corretor_id === corretorInicial);
    if (alvo) { iniciado.current = corretorInicial; abrir(alvo); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corretorInicial, conversas]);

  // Mensagens novas chegam sem recarregar a tela (a aba parada não consulta).
  useEffect(() => {
    if (!selId) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") buscarMensagens(selId, true);
    }, 6000);
    return () => clearInterval(id);
  }, [selId, buscarMensagens]);

  // Só desce a tela quando a pessoa já estava no fim (ou acabou de abrir/enviar).
  useEffect(() => {
    const el = rolagem.current;
    if (!el) return;
    if (forcarFim.current || perto.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: forcarFim.current ? "auto" : "smooth" });
      if (mensagens.length) forcarFim.current = false;
    }
  }, [mensagens]);

  const aoRolar = () => {
    const el = rolagem.current;
    if (el) perto.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };

  // Sugestão de resposta gerada na hora pela IA a partir da conversa; vai para o campo, editável, sem enviar sozinha.
  const sugerir = async (instrucao?: string) => {
    if (!selId || gerando) return;
    const id = selId;
    setGerando(true);
    setErroEnvio(null);
    try {
      const res = await fetchApi(`/corretor/atendimentos/${id}/sugerir-resposta`, { method: "POST", body: JSON.stringify(instrucao ? { instrucao } : {}) });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) throw new ErroApi(detalheDoErro(dados, "Não consegui sugerir uma resposta agora."));
      if (selRef.current !== id) return;
      setTexto(String(dados.texto ?? ""));
      setJaSugeriu(true);
      requestAnimationFrame(() => document.getElementById(ID_CAMPO_ATENDIMENTO)?.focus());
    } catch (e) {
      if (!onAuthError(e)) setErroEnvio(e instanceof ErroApi ? e.message : "Falha de conexão ao gerar a sugestão.");
    } finally {
      setGerando(false);
    }
  };

  const enviarAoCliente = async () => {
    const conteudo = texto.trim();
    if (!conteudo || !selId || enviando) return;
    setEnviando(true);
    setErroEnvio(null);
    try {
      const res = await fetchApi(`/corretor/atendimentos/${selId}/enviar`, { method: "POST", body: JSON.stringify({ texto: conteudo }) });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) throw new ErroApi(detalheDoErro(dados, "Não foi possível enviar agora."));
      forcarFim.current = true;
      setMensagens((m) => [...m, mensagemDoAtendimento(dados)]);
      setTexto("");
      onRecarregar();
    } catch (e) {
      if (!onAuthError(e)) setErroEnvio(e instanceof ErroApi ? e.message : "Falha de conexão. Sua mensagem continua no campo; tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  const enviar = async () => {
    const conteudo = texto.trim();
    if (!conteudo || !selId || enviando) return;
    setEnviando(true);
    setErroEnvio(null);
    try {
      const res = await fetchApi(`/admin/conversas/${selId}/${modo === "nota" ? "notas" : "enviar"}`, {
        method: "POST",
        body: JSON.stringify({ texto: conteudo }),
      });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) throw new ErroApi(detalheDoErro(dados, "Não foi possível enviar agora."));
      forcarFim.current = true;
      setMensagens((m) => [...m, dados]);
      setTexto("");
      setVersao((v) => v + 1);
      onRecarregar();
    } catch (e) {
      if (!onAuthError(e)) setErroEnvio(e instanceof ErroApi ? e.message : "Falha de conexão. Sua mensagem continua no campo; tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  // A análise roda na hora (alguns segundos) e responde com o resultado ou com o motivo da falha.
  const reanalisar = async () => {
    if (!selId || reanalisando) return;
    const id = selId;
    setReanalisando(true);
    setErroAnalise(null);
    setDetalhesAberto(true);
    setAbaAt("info");
    try {
      const res = await fetchApi(`/corretor/atendimentos/${id}/analisar`, { method: "POST" });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) throw new ErroApi(detalheDoErro(dados, "Não foi possível analisar agora."));
      if (selRef.current === id) { await buscarMensagens(id, true); onRecarregar(); }
    } catch (e) {
      if (!onAuthError(e)) setErroAnalise(e instanceof ErroApi ? e.message : "Falha de conexão ao analisar. Tente de novo.");
    } finally {
      setReanalisando(false);
    }
  };

  const ligarAssistente = async () => {
    try {
      const atual = await fetchApi("/corretor/assistente");
      const prefs = atual.ok ? await atual.json() : { avisos: true, carteira_auto: true };
      const res = await fetchApi("/corretor/assistente", { method: "PUT", body: JSON.stringify({ ...prefs, ativo: true }) });
      if (!res.ok) throw new ErroApi("Não foi possível ligar o assistente agora.");
      await reanalisar();
    } catch (e) {
      if (!onAuthError(e)) setErroAnalise(e instanceof ErroApi ? e.message : "Falha de conexão.");
    }
  };

  const gerarResumo = async () => {
    if (!selId) return;
    if (modoAt) {
      setDetalhesAberto(true);
      setAbaAt("info");
      if (!selAt?.resumo && !(detalheAt?.analise as { resumo?: string } | null)?.resumo) reanalisar();
      return;  // já analisado: o resumo está no painel (com "Reanalisar" para atualizar)
    }
    setDetalhesAberto(true);
    setAba("info");
    setResumo({ estado: "carregando", texto: "" });
    try {
      const res = await fetchApi(`/admin/conversas/${selId}/resumo`, { method: "POST" });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) throw new ErroApi(detalheDoErro(dados, "Não consegui resumir agora."));
      if (selRef.current === selId) setResumo({ estado: "ok", texto: dados.resumo });
    } catch (e) {
      if (!onAuthError(e)) setResumo({ estado: "erro", texto: e instanceof ErroApi ? e.message : "Falha de conexão ao gerar o resumo." });
    }
  };

  const verProcesso = (id: string) => {
    setFoco(id);
    setAba("ia");
    setDetalhesAberto(true);
  };

  const atualizar = () => {
    onRecarregar();
    if (selId) buscarMensagens(selId, false);
    setVersao((v) => v + 1);
    setMenu(false);
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] min-h-0">
      {online === false && (
        <div role="alert" className="shrink-0 flex items-center justify-between gap-3 px-5 py-2.5 text-[13px]" style={{ background: "color-mix(in srgb, var(--warn) 12%, var(--bg))", borderBottom: "1px solid var(--line)", color: "var(--text-2)" }}>
          <span className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "var(--warn)" }} aria-hidden />
            <span className="truncate">{modoAt ? "Seu WhatsApp pessoal não está conectado: o Acessor não vê suas conversas com os clientes." : "Nenhum número de WhatsApp conectado. As mensagens do agente não serão entregues."}</span>
          </span>
          <button type="button" onClick={() => onIr(modoAt ? "configuracoes" : "whatsapp")} className="shrink-0 font-medium hover:underline" style={{ color: "var(--text)" }}>{modoAt ? "Conectar" : "Reconectar"}</button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Lista */}
        <div className={`${sel ? "hidden lg:block" : "block"} w-full lg:w-[340px] xl:w-[360px] shrink-0 min-h-0`} style={{ borderRight: "1px solid var(--line)" }}>
          <ListaConversas
            titulo={ehCorretor && !modoAt ? "Chat do Acessor" : "Conversas"}
            conversas={conversas} carregando={carregando} ativaId={selId} online={online} onAbrir={abrir} onAtualizar={atualizar}
            {...(modoAt ? {
              rotuloOnline: { on: "WhatsApp pessoal conectado", off: "WhatsApp pessoal desconectado" },
              filtros: FILTROS_ATENDIMENTO,
              semAvatarDoCorretor: true,
              textoVazio: atendimentos!.vazio ?? { titulo: "Nenhum atendimento ainda", detalhe: "Quando você conversar com clientes no seu WhatsApp, o Acessor acompanha e a conversa aparece aqui. Conecte seu WhatsApp em Configurações." },
              extra: (
                <label className="mt-3 flex items-center gap-2 text-xs cursor-pointer" style={{ color: "var(--text-3)" }}>
                  <input type="checkbox" checked={atendimentos!.todos} onChange={(e) => atendimentos!.onTodos(e.target.checked)} />
                  Incluir conversas não imobiliárias
                </label>
              ),
            } : {})}
          />
        </div>

        {/* Conversa */}
        <section className={`${sel ? "flex" : "hidden lg:flex"} flex-1 min-w-0 flex-col`} aria-label="Conversa aberta">
          {!sel ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
              <span className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "var(--card-2)", color: "var(--text-3)" }}>
                <MessageSquare className="w-6 h-6" aria-hidden />
              </span>
              <h2 className="mt-4 text-base font-medium" style={{ color: "var(--text)" }}>{modoAt ? "Escolha um atendimento" : "Escolha uma conversa"}</h2>
              <p className="mt-1 max-w-xs text-sm" style={{ color: "var(--text-3)" }}>
                {modoAt ? "A conversa com o cliente, a análise do Acessor e os dados do CRM aparecem aqui." : "As mensagens, o contexto do corretor e o que o agente fez para responder aparecem aqui."}
              </p>
            </div>
          ) : (
            <>
              <header className="shrink-0 flex items-center gap-3 px-4 h-[60px]" style={{ borderBottom: "1px solid var(--line)" }}>
                <button type="button" onClick={() => setSelId(null)} aria-label="Voltar para as conversas" className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}>
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <Avatar nome={selAt?.nome ?? sel.corretor_nome} id={modoAt ? null : sel.corretor_id} fotoUrl={modoAt ? (detalheAt?.foto_url ?? selAt?.foto_url) : null} tamanho={38} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold" style={{ color: "var(--text)" }}>{(modoAt ? selAt?.nome : null) || sel.corretor_nome || (modoAt ? sel.telefone_mascarado : "Corretor")}</p>
                  <p className="truncate text-xs" style={{ color: "var(--text-3)" }}>
                    WhatsApp · {sel.telefone_mascarado}
                    {!modoAt && sel.corretor_status !== "active" && <span className="ml-2 uppercase" style={{ color: "var(--warn)" }}>{sel.corretor_status}</span>}
                    {modoAt && selAt?.temperatura && <span className="ml-2" style={{ color: selAt.temperatura === "quente" ? "var(--danger)" : selAt.temperatura === "frio" ? "var(--info)" : "var(--warn)" }}>{selAt.temperatura}</span>}
                  </p>
                </div>
                <button type="button" onClick={gerarResumo} disabled={resumo.estado === "carregando" || reanalisando} className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] hover:bg-[var(--hover-solid)] disabled:opacity-60" style={{ color: "var(--text-2)" }}>
                  {resumo.estado === "carregando" || reanalisando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" style={{ color: "var(--accent)" }} aria-hidden />}
                  Resumir
                </button>
                <button type="button" onClick={() => setDetalhesAberto((v) => !v)} aria-pressed={detalhesAberto} aria-label={modoAt ? "Detalhes do atendimento" : "Detalhes do corretor"} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--hover-solid)]" style={{ color: detalhesAberto ? "var(--accent)" : "var(--text-3)", background: detalhesAberto ? "var(--hover-solid)" : undefined }}>
                  <Info className="w-[18px] h-[18px]" />
                </button>
                <div className="relative">
                  <button type="button" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu} aria-label="Mais ações" className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}>
                    <MoreHorizontal className="w-5 h-5" />
                  </button>
                  {menu && (
                    <div role="menu" className="assist-pop absolute right-0 top-full mt-1 z-30 w-52 p-1.5 rounded-xl shadow-2xl" style={{ background: "var(--card)", border: "1px solid var(--line-2)" }} onMouseLeave={() => setMenu(false)}>
                      <button role="menuitem" type="button" onClick={atualizar} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-2)" }}>
                        <RefreshCw className="w-4 h-4" aria-hidden /> Atualizar conversa
                      </button>
                      <button role="menuitem" type="button" onClick={() => { setMenu(false); onIr("leads"); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-2)" }}>
                        <MessageSquare className="w-4 h-4" aria-hidden /> Ver carteira de clientes
                      </button>
                    </div>
                  )}
                </div>
              </header>

              <div ref={rolagem} onScroll={aoRolar} className="flex-1 min-h-0 overflow-y-auto" style={{ backgroundImage: "radial-gradient(var(--line) 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
                {carregandoMsgs && mensagens.length === 0 ? (
                  <div className="h-full flex items-center justify-center gap-2" style={{ color: "var(--text-3)" }}>
                    <Loader2 className="w-5 h-5 animate-spin" /> <span className="text-sm">Carregando mensagens…</span>
                  </div>
                ) : erro ? (
                  <div role="alert" className="m-6 p-4 rounded-xl text-sm" style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)", color: "var(--danger)" }}>{erro}</div>
                ) : mensagens.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm" style={{ color: "var(--text-3)" }}>{modoAt ? "Nenhuma mensagem neste atendimento." : "Nenhuma mensagem nesta conversa."}</div>
                ) : (
                  <ChatMensagens mensagens={mensagens} onProcesso={modoAt ? undefined : verProcesso} rotulos={modoAt ? { saida: "Você", entrada: "Cliente" } : undefined} />
                )}
              </div>

              <div className="shrink-0" style={{ borderTop: "1px solid var(--line)", background: "var(--bg)" }}>
                {modoAt ? (
                  <>
                    {info && <p role="status" className="px-4 pt-3 text-xs" style={{ color: "var(--accent-text)" }}>{info}</p>}
                    <CompositorAtendimento
                      onSugerir={sugerir} gerando={gerando} jaSugeriu={jaSugeriu} temMensagens={mensagens.length > 0}
                      texto={texto} onTexto={setTexto} onEnviar={enviarAoCliente} enviando={enviando} semWhatsapp={online === false}
                      onConectar={() => onIr("configuracoes")} onAcao={(a) => setAcao(a)} erro={erroEnvio}
                      nomeCliente={sel.corretor_nome || sel.telefone_mascarado || "o cliente"}
                    />
                  </>
                ) : (
                <CompositorConversa modo={modo} onModo={(m) => { setModo(m); setErroEnvio(null); }} texto={texto} onTexto={setTexto} onEnviar={enviar} enviando={enviando} semWhatsapp={online === false} erro={erroEnvio} onAcao={setAcao} somenteAcoes={ehCorretor} />
                )}
              </div>
            </>
          )}
        </section>

        {/* Detalhes */}
        {sel && detalhesAberto && (
          <>
            <button type="button" aria-label="Fechar detalhes" onClick={() => setDetalhesAberto(false)} className="xl:hidden fixed inset-0 z-30 bg-black/50 assist-fade" />
            <div className="fixed inset-y-0 right-0 z-40 w-full max-w-sm shadow-2xl assist-slide-left xl:static xl:z-auto xl:max-w-none xl:w-[360px] xl:shrink-0 xl:shadow-none xl:animate-none min-h-0" style={{ borderLeft: "1px solid var(--line)" }}>
              {modoAt && selAt ? (
                <PainelAtendimento
                  item={selAt} detalhe={detalheAt} aba={abaAt} onAba={setAbaAt} onFechar={() => setDetalhesAberto(false)} onIr={onIr}
                  onAbrirCliente={atendimentos!.onAbrirCliente} onReanalisar={reanalisar} reanalisando={reanalisando} onAuthError={onAuthError}
                  erroAnalise={erroAnalise} onLigarAssistente={ligarAssistente}
                  onAlterou={(patch) => { setAjustes((a) => ({ ...a, [selAt.id]: { ...(a[selAt.id] ?? {}), ...patch } })); onRecarregar(); }}
                />
              ) : (
              <PainelDetalhes
                corretorId={sel.corretor_id}
                nome={sel.corretor_nome || "Corretor"}
                versao={versao}
                mensagens={mensagens}
                focoProcesso={foco}
                aba={aba}
                onAba={setAba}
                resumo={resumo}
                onGerarResumo={gerarResumo}
                onFechar={() => setDetalhesAberto(false)}
                onIr={onIr}
                onAuthError={onAuthError}
              />
              )}
            </div>
          </>
        )}
      </div>
      {acao && sel && (
        <AcoesRapidas
          corretorId={modoAt ? atendimentos!.meuId : sel.corretor_id}
          corretorNome={modoAt ? "você" : sel.corretor_nome || "o corretor"}
          {...(modoAt ? {
            base: `/corretor/atendimentos/${sel.corretor_id}/acoes-rapidas`,
            tipos: ["imoveis" as const],
            destino: sel.corretor_nome || sel.telefone_mascarado || "o cliente",
          } : {})}
          tipoInicial={acao}
          onFechar={() => setAcao(null)}
          onAuthError={onAuthError}
          onEnviado={(novas, falhas) => {
            forcarFim.current = true;
            setMensagens((m) => [...m, ...(modoAt ? (novas as unknown as MensagemAt[]).map(mensagemDoAtendimento) : novas)]);
            setVersao((v) => v + 1);
            onRecarregar();
            if (falhas) setErroEnvio(`${falhas} ${falhas === 1 ? "mensagem não foi entregue" : "mensagens não foram entregues"}. As demais foram enviadas.`);
          }}
        />
      )}
    </div>
  );
}
