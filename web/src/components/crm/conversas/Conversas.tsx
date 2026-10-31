"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Info, Loader2, MessageSquare, MoreHorizontal, RefreshCw, Sparkles } from "lucide-react";
import { fetchApi } from "@/lib/api";
import ChatMensagens, { MensagemChat } from "../ChatMensagens";
import CompositorConversa, { ModoCompositor } from "./CompositorConversa";
import { useEhCorretor } from "@/components/portal/papel";
import AcoesRapidas, { TipoAcao } from "./AcoesRapidas";
import ListaConversas, { Avatar } from "./ListaConversas";
import PainelDetalhes, { AbaDetalhes, ResumoEstado } from "./PainelDetalhes";
import type { ConversaResumo } from "./tipos";

class ErroApi extends Error {}

const detalheDoErro = (dados: { detail?: unknown }, padrao: string) => (typeof dados.detail === "string" ? dados.detail : padrao);

export default function Conversas({
  conversas,
  carregando,
  onRecarregar,
  onAuthError,
  onIr,
  corretorInicial,
}: {
  conversas: ConversaResumo[];
  carregando: boolean;
  onRecarregar: () => void;
  onAuthError: (e: unknown) => boolean;
  onIr: (tab: string) => void;
  /** Corretor a abrir assim que a lista carregar (vem do painel do corretor). */
  corretorInicial?: string | null;
}) {
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

  const rolagem = useRef<HTMLDivElement | null>(null);
  const perto = useRef(true);
  const forcarFim = useRef(true);
  const selRef = useRef<string | null>(null);
  selRef.current = selId;

  const sel = conversas.find((c) => c.corretor_id === selId) || null;

  // O painel de detalhes abre por padrão em telas largas; em telas menores é uma gaveta.
  useEffect(() => {
    setDetalhesAberto(window.matchMedia("(min-width: 1280px)").matches);
  }, []);

  const carregarWhatsapp = useCallback(async () => {
    if (ehCorretor) return;  // o estado do WhatsApp do agente é da gestão
    try {
      const res = await fetchApi("/admin/whatsapp");
      if (res.ok) setOnline((await res.json()).status === "connected");
    } catch (e) {
      onAuthError(e);
    }
  }, [onAuthError, ehCorretor]);

  useEffect(() => {
    carregarWhatsapp();
    const id = setInterval(carregarWhatsapp, 30000);
    return () => clearInterval(id);
  }, [carregarWhatsapp]);

  const buscarMensagens = useCallback(
    async (id: string, silencioso: boolean) => {
      if (!silencioso) setCarregandoMsgs(true);
      try {
        const res = await fetchApi(`/admin/conversas/${id}/mensagens?limit=200`);
        if (!res.ok) throw new ErroApi("Não foi possível carregar as mensagens desta conversa.");
        const dados = await res.json();
        if (selRef.current !== id) return;
        const novas: MensagemChat[] = (dados.mensagens || []).filter((m: MensagemChat) => !ehCorretor || m.origem !== "nota");
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
    [onAuthError, ehCorretor]
  );

  const abrir = (c: ConversaResumo) => {
    if (c.corretor_id !== selId) {
      setSelId(c.corretor_id);
      setMensagens([]);
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

  const gerarResumo = async () => {
    if (!selId) return;
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
            <span className="truncate">Nenhum número de WhatsApp conectado. As mensagens do agente não serão entregues.</span>
          </span>
          <button type="button" onClick={() => onIr("whatsapp")} className="shrink-0 font-medium hover:underline" style={{ color: "var(--text)" }}>Reconectar</button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Lista */}
        <div className={`${sel ? "hidden lg:block" : "block"} w-full lg:w-[340px] xl:w-[360px] shrink-0 min-h-0`} style={{ borderRight: "1px solid var(--line)" }}>
          <ListaConversas conversas={conversas} carregando={carregando} ativaId={selId} online={online} onAbrir={abrir} onAtualizar={atualizar} />
        </div>

        {/* Conversa */}
        <section className={`${sel ? "flex" : "hidden lg:flex"} flex-1 min-w-0 flex-col`} aria-label="Conversa aberta">
          {!sel ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
              <span className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "var(--card-2)", color: "var(--text-3)" }}>
                <MessageSquare className="w-6 h-6" aria-hidden />
              </span>
              <h2 className="mt-4 text-base font-medium" style={{ color: "var(--text)" }}>Escolha uma conversa</h2>
              <p className="mt-1 max-w-xs text-sm" style={{ color: "var(--text-3)" }}>
                As mensagens, o contexto do corretor e o que o agente fez para responder aparecem aqui.
              </p>
            </div>
          ) : (
            <>
              <header className="shrink-0 flex items-center gap-3 px-4 h-[60px]" style={{ borderBottom: "1px solid var(--line)" }}>
                <button type="button" onClick={() => setSelId(null)} aria-label="Voltar para as conversas" className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}>
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <Avatar nome={sel.corretor_nome} id={sel.corretor_id} tamanho={38} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold" style={{ color: "var(--text)" }}>{sel.corretor_nome || "Corretor"}</p>
                  <p className="truncate text-xs" style={{ color: "var(--text-3)" }}>
                    WhatsApp · {sel.telefone_mascarado}
                    {sel.corretor_status !== "active" && <span className="ml-2 uppercase" style={{ color: "var(--warn)" }}>{sel.corretor_status}</span>}
                  </p>
                </div>
                <button type="button" onClick={gerarResumo} disabled={resumo.estado === "carregando"} className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] hover:bg-[var(--hover-solid)] disabled:opacity-60" style={{ color: "var(--text-2)" }}>
                  {resumo.estado === "carregando" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" style={{ color: "var(--accent)" }} aria-hidden />}
                  Resumir
                </button>
                <button type="button" onClick={() => setDetalhesAberto((v) => !v)} aria-pressed={detalhesAberto} aria-label="Detalhes do corretor" className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--hover-solid)]" style={{ color: detalhesAberto ? "var(--accent)" : "var(--text-3)", background: detalhesAberto ? "var(--hover-solid)" : undefined }}>
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
                  <div className="h-full flex items-center justify-center text-sm" style={{ color: "var(--text-3)" }}>Nenhuma mensagem nesta conversa.</div>
                ) : (
                  <ChatMensagens mensagens={mensagens} onProcesso={verProcesso} />
                )}
              </div>

              <div className="shrink-0" style={{ borderTop: "1px solid var(--line)", background: "var(--bg)" }}>
                <CompositorConversa modo={modo} onModo={(m) => { setModo(m); setErroEnvio(null); }} texto={texto} onTexto={setTexto} onEnviar={enviar} enviando={enviando} semWhatsapp={online === false} erro={erroEnvio} onAcao={setAcao} somenteAcoes={ehCorretor} />
              </div>
            </>
          )}
        </section>

        {/* Detalhes */}
        {sel && detalhesAberto && (
          <>
            <button type="button" aria-label="Fechar detalhes" onClick={() => setDetalhesAberto(false)} className="xl:hidden fixed inset-0 z-30 bg-black/50 assist-fade" />
            <div className="fixed inset-y-0 right-0 z-40 w-full max-w-sm shadow-2xl assist-slide-left xl:static xl:z-auto xl:max-w-none xl:w-[360px] xl:shrink-0 xl:shadow-none xl:animate-none min-h-0" style={{ borderLeft: "1px solid var(--line)" }}>
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
            </div>
          </>
        )}
      </div>
      {acao && sel && (
        <AcoesRapidas
          corretorId={sel.corretor_id}
          corretorNome={sel.corretor_nome || "o corretor"}
          tipoInicial={acao}
          onFechar={() => setAcao(null)}
          onAuthError={onAuthError}
          onEnviado={(novas, falhas) => {
            forcarFim.current = true;
            setMensagens((m) => [...m, ...novas]);
            setVersao((v) => v + 1);
            onRecarregar();
            if (falhas) setErroEnvio(`${falhas} ${falhas === 1 ? "mensagem não foi entregue" : "mensagens não foram entregues"}. As demais foram enviadas.`);
          }}
        />
      )}
    </div>
  );
}
