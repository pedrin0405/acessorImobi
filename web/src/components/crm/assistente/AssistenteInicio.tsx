"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, FileText, History, MessageCircle, RotateCw } from "lucide-react";
import { fetchApi } from "@/lib/api";
import LogoAcessor from "@/components/shell/LogoAcessor";
import Compositor, { CompositorRef, mimeDoArquivo } from "./Compositor";
import Gaveta, { ConversaIA, rotuloDia } from "./Gaveta";
import RespostaIA from "./RespostaIA";
import Simbolo from "./Simbolo";

interface AnexoMeta {
  nome: string;
  tipo: string;
}

interface MensagemIA {
  id: string;
  papel: "user" | "assistant";
  conteudo: string;
  anexos: AnexoMeta[];
  animar?: boolean;
}

interface Pendente {
  texto: string;
  arquivos: File[];
  /** A pergunta já está na tela (nova tentativa depois de um erro). */
  jaMostrada: boolean;
}

const paraBase64 = (f: File) =>
  new Promise<string>((ok, falhou) => {
    const leitor = new FileReader();
    leitor.onload = () => ok(String(leitor.result).split(",")[1] || "");
    leitor.onerror = () => falhou(new Error("leitura"));
    leitor.readAsDataURL(f);
  });

const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

class ErroApi extends Error {}

export default function AssistenteInicio({
  saudacao,
  resumo,
  onAuthError,
  children,
}: {
  saudacao: string;
  resumo: React.ReactNode;
  onAuthError: (e: unknown) => boolean;
  /** Conteúdo da tela inicial abaixo da caixa ("Para hoje"). */
  children?: React.ReactNode;
}) {
  const [texto, setTexto] = useState("");
  const [anexos, setAnexos] = useState<File[]>([]);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [titulo, setTitulo] = useState("");
  const [mensagens, setMensagens] = useState<MensagemIA[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [digitandoId, setDigitandoId] = useState<string | null>(null);
  const [pular, setPular] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recentes, setRecentes] = useState<ConversaIA[]>([]);
  const [gaveta, setGaveta] = useState(false);
  const compositor = useRef<CompositorRef | null>(null);
  const fim = useRef<HTMLDivElement | null>(null);
  const ultimo = useRef<Pendente | null>(null);

  const emChat = conversaId !== null || mensagens.length > 0 || enviando;

  const carregarRecentes = useCallback(async () => {
    try {
      const res = await fetchApi("/admin/assistente/conversas");
      if (res.ok) setRecentes(await res.json());
    } catch (e) {
      onAuthError(e);
    }
  }, [onAuthError]);

  useEffect(() => {
    carregarRecentes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const descer = useCallback(() => fim.current?.scrollIntoView({ block: "end" }), []);

  useEffect(() => {
    if (emChat) descer();
  }, [mensagens.length, enviando, erro, emChat, descer]);

  const novaConversa = () => {
    setConversaId(null);
    setTitulo("");
    setMensagens([]);
    setErro(null);
    setDigitandoId(null);
    setTexto("");
    setAnexos([]);
    requestAnimationFrame(() => compositor.current?.focar());
  };

  const abrirConversa = async (c: ConversaIA) => {
    setErro(null);
    setDigitandoId(null);
    setConversaId(c.id);
    setTitulo(c.titulo);
    setMensagens([]);
    try {
      const res = await fetchApi(`/admin/assistente/conversas/${c.id}`);
      if (!res.ok) throw new ErroApi("Não foi possível abrir esta conversa.");
      const dados: { id: string; papel: "user" | "assistant"; conteudo: string; anexos: AnexoMeta[] }[] = await res.json();
      setMensagens(dados.map((m) => ({ id: m.id, papel: m.papel, conteudo: m.conteudo, anexos: m.anexos || [] })));
    } catch (e) {
      if (!onAuthError(e)) setErro(e instanceof ErroApi ? e.message : "Falha de conexão ao abrir a conversa.");
    }
  };

  const processar = async ({ texto: t, arquivos, jaMostrada }: Pendente) => {
    ultimo.current = { texto: t, arquivos, jaMostrada: true };
    setErro(null);
    setEnviando(true);
    const idLocal = `local-${Date.now()}`;
    if (!jaMostrada) {
      setMensagens((m) => [
        ...m,
        { id: idLocal, papel: "user", conteudo: t || "(arquivo anexado)", anexos: arquivos.map((f) => ({ nome: f.name, tipo: mimeDoArquivo(f) })) },
      ]);
    }
    try {
      let id = conversaId;
      if (!id) {
        const criada = await fetchApi("/admin/assistente/conversas", { method: "POST", body: JSON.stringify({}) });
        if (!criada.ok) throw new ErroApi("Não foi possível iniciar a conversa.");
        id = (await criada.json()).id as string;
        setConversaId(id);
      }
      const anexosApi = await Promise.all(arquivos.map(async (f) => ({ nome: f.name, mime: mimeDoArquivo(f), dados: await paraBase64(f) })));
      const res = await fetchApi(`/admin/assistente/conversas/${id}/mensagens`, {
        method: "POST",
        body: JSON.stringify({ texto: t, anexos: anexosApi }),
      });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) throw new ErroApi(typeof dados.detail === "string" ? dados.detail : "Não consegui responder agora.");
      setTitulo(dados.titulo);
      setMensagens((m) => [
        ...m.map((x) => (x.id.startsWith("local-") ? { ...x, id: dados.pergunta.id } : x)),
        { id: dados.resposta.id, papel: "assistant", conteudo: dados.resposta.conteudo, anexos: [], animar: true },
      ]);
      setPular(false);
      setDigitandoId(dados.resposta.id);
      carregarRecentes();
    } catch (e) {
      if (!onAuthError(e)) setErro(e instanceof ErroApi ? e.message : "Falha de conexão. Verifique a internet e tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  const enviar = () => {
    const t = texto.trim();
    if (!t && anexos.length === 0) return;
    const pendente = { texto: t, arquivos: anexos, jaMostrada: false };
    setTexto("");
    setAnexos([]);
    processar(pendente);
  };

  const tentarDeNovo = () => {
    if (ultimo.current) processar(ultimo.current);
  };

  const fimDaResposta = useCallback((id: string) => {
    setDigitandoId((atual) => (atual === id ? null : atual));
    setMensagens((m) => m.map((x) => (x.id === id && x.animar ? { ...x, animar: false } : x)));
  }, []);

  const compor = (
    <Compositor
      ref={compositor}
      texto={texto}
      onTexto={setTexto}
      anexos={anexos}
      onAnexos={setAnexos}
      onEnviar={enviar}
      ocupado={enviando}
      digitando={digitandoId !== null}
      onParar={() => setPular(true)}
      menuAcima={emChat}
      autoFocus
    />
  );

  const botaoHistorico = (
    <button
      type="button"
      onClick={() => setGaveta(true)}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm border hover:bg-[var(--hover-solid)] transition-colors"
      style={{ borderColor: "var(--line-2)", color: "var(--text-2)", background: "var(--card)" }}
    >
      <History className="w-4 h-4" aria-hidden /> Histórico
    </button>
  );

  return (
    <>
      {!emChat ? (
        <div className="max-w-3xl mx-auto">
          <div className="flex justify-end">{botaoHistorico}</div>
          <div className="pt-4 lg:pt-10 space-y-10">
            <div className="text-center space-y-3 assist-rise">
              <div className="flex justify-center"><Simbolo tamanho={72} /></div>
              <h1 className="text-3xl lg:text-[44px] leading-tight font-semibold tracking-tight" style={{ color: "var(--text)" }}>{saudacao}</h1>
              <p className="text-sm" style={{ color: "var(--text-3)" }}>{resumo}</p>
            </div>

            <div className="assist-rise relative z-20" style={{ animationDelay: "80ms" }}>{compor}</div>

            <div className="space-y-10 assist-rise" style={{ animationDelay: "160ms" }}>
              {children}
              {recentes.length > 0 && (
                <section className="space-y-3" aria-label="Continuar de onde parou">
                  <div className="flex items-center justify-between px-1">
                    <h2 className="text-sm" style={{ color: "var(--text-3)" }}>Continuar de onde parou</h2>
                    <button type="button" onClick={() => setGaveta(true)} className="text-sm hover:underline" style={{ color: "var(--text-3)" }}>Ver todas</button>
                  </div>
                  <ul>
                    {recentes.slice(0, 3).map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => abrirConversa(c)}
                          className="w-full flex items-center gap-3 px-1 py-3 text-left rounded-xl hover:bg-[var(--hover-solid)] transition-colors"
                        >
                          <MessageCircle className="w-[18px] h-[18px] shrink-0" style={{ color: "var(--text-3)" }} aria-hidden />
                          <span className="flex-1 min-w-0 truncate text-[15px]" style={{ color: "var(--text)" }}>{c.titulo}</span>
                          <span className="text-xs tabular-nums shrink-0 pr-2" style={{ color: "var(--text-4)" }}>
                            {rotuloDia(c.atualizada_em) === "Hoje" ? hora(c.atualizada_em) : rotuloDia(c.atualizada_em)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="max-w-3xl mx-auto flex flex-col min-h-[calc(100dvh-7rem)]">
          <div className="flex items-center justify-between gap-3 pb-4">
            <button type="button" onClick={novaConversa} className="inline-flex items-center gap-2 px-3 py-2 -ml-3 rounded-xl text-sm hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}>
              <ArrowLeft className="w-4 h-4" aria-hidden /> Início
            </button>
            <h1 className="flex-1 min-w-0 truncate text-center text-sm font-medium" style={{ color: "var(--text-2)" }}>{titulo || "Nova conversa"}</h1>
            {botaoHistorico}
          </div>

          <div className="flex-1 space-y-7 pb-6" aria-live="polite">
            {mensagens.map((m) =>
              m.papel === "user" ? (
                <div key={m.id} className="assist-rise flex flex-col items-end gap-2">
                  {m.anexos.length > 0 && (
                    <ul className="flex flex-wrap justify-end gap-2">
                      {m.anexos.map((a, i) => (
                        <li key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs max-w-[16rem]" style={{ background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--text-2)" }}>
                          <FileText className="w-3.5 h-3.5 shrink-0" aria-hidden />
                          <span className="truncate">{a.nome}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-tr-md whitespace-pre-wrap break-words text-[15px] leading-relaxed" style={{ background: "var(--accent-soft)", border: "1px solid var(--line-2)", color: "var(--text)" }}>
                    {m.conteudo}
                  </p>
                </div>
              ) : (
                <div key={m.id} className="assist-rise flex gap-3">
                  <span className="mt-0.5 w-7 h-7 shrink-0 overflow-hidden rounded-lg flex items-center justify-center">
                    <LogoAcessor className="w-7 h-7" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <RespostaIA
                      texto={m.conteudo}
                      animar={!!m.animar}
                      pular={pular && digitandoId === m.id}
                      onFim={() => fimDaResposta(m.id)}
                      onCresce={descer}
                    />
                  </div>
                </div>
              )
            )}

            {enviando && (
              <div className="assist-rise flex items-center gap-3" role="status" aria-label="O Acessor está pensando">
                <Simbolo tamanho={28} pensando />
                <span className="flex items-center gap-1" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="assist-dot w-1.5 h-1.5 rounded-full" style={{ background: "var(--text-3)", animationDelay: `${i * 0.16}s` }} />
                  ))}
                </span>
              </div>
            )}

            {erro && (
              <div role="alert" className="assist-pop flex items-start justify-between gap-3 px-4 py-3 rounded-2xl text-sm" style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)", color: "var(--danger)" }}>
                <span>{erro}</span>
                {ultimo.current && !enviando && (
                  <button type="button" onClick={tentarDeNovo} className="shrink-0 inline-flex items-center gap-1.5 font-medium underline underline-offset-2">
                    <RotateCw className="w-3.5 h-3.5" aria-hidden /> Tentar de novo
                  </button>
                )}
              </div>
            )}
            <div ref={fim} />
          </div>

          <div className="sticky bottom-0 pt-3 pb-4" style={{ background: "linear-gradient(to top, var(--bg) 70%, transparent)" }}>
            {compor}
          </div>
        </div>
      )}

      <Gaveta
        aberta={gaveta}
        ativaId={conversaId}
        onFechar={() => setGaveta(false)}
        onAbrir={abrirConversa}
        onNova={novaConversa}
        onExcluida={(id) => {
          if (id === conversaId) novaConversa();
          carregarRecentes();
        }}
        onAuthError={onAuthError}
      />
    </>
  );
}
