"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, FileText, Loader2, Lock, Mic, Pause, Play, UserRound, Workflow, X } from "lucide-react";
import CartaoImovelBase from "./imoveis/CartaoImovel";
import { fetchApi } from "@/lib/api";

export interface MensagemChat {
  id: string;
  direcao: "inbound" | "outbound" | string;
  tipo: string;
  conteudo: string | null;
  status: string;
  created_at: string | null;
  midia?: string | null;
  /** 'bot' (agente), 'humano' (equipe pelo portal) ou 'nota' (nota interna); vazio = corretor. */
  origem?: string | null;
  autor?: string | null;
  /** Como a IA respondeu; vem só na primeira mensagem de cada resposta do agente. */
  /** Ficha enviada pela equipe como ação rápida (hoje só de lead). */
  cartao?: { tipo: string; lead?: Record<string, unknown>; titulo?: string; modelo?: string; imoveis?: { codigo: number; tipo?: string | null; bairro?: string | null; foto_url?: string | null }[]; arquivo?: string } | null;
  processo?: { rota: string; modelo?: string | null; total_ms?: number | null; passos: Record<string, unknown>[] } | null;
}

type Item =
  | { tipo: "dia"; chave: string; rotulo: string }
  | { tipo: "msg"; chave: string; m: MensagemChat; primeira: boolean; ultima: boolean }
  | { tipo: "imoveis"; chave: string; itens: MensagemChat[] };

const JANELA_AGRUPAR_MS = 5 * 60 * 1000;

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";

function rotuloDia(d: Date): string {
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return "Hoje";
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: d.getFullYear() === hoje.getFullYear() ? undefined : "numeric" });
}

function montarItens(mensagens: MensagemChat[]): Item[] {
  const itens: Item[] = [];
  let diaAtual = "";
  let anterior: MensagemChat | null = null;

  for (const m of mensagens) {
    const quando = m.created_at ? new Date(m.created_at) : null;
    const dia = quando ? quando.toDateString() : "";
    if (quando && dia !== diaAtual) {
      diaAtual = dia;
      itens.push({ tipo: "dia", chave: `d-${dia}`, rotulo: rotuloDia(quando) });
      anterior = null;
    }

    // Fotos de imóveis enviadas em sequência viram um único cartão.
    if (m.direcao === "outbound" && m.tipo === "image") {
      const ultimo = itens[itens.length - 1];
      if (ultimo && ultimo.tipo === "imoveis" && ultimo.itens[0].origem === m.origem) ultimo.itens.push(m);
      else itens.push({ tipo: "imoveis", chave: `i-${m.id}`, itens: [m] });
      anterior = m;
      continue;
    }

    const proximoDoMesmo =
      anterior &&
      anterior.direcao === m.direcao &&
      anterior.tipo !== "image" &&
      quando &&
      anterior.created_at &&
      quando.getTime() - new Date(anterior.created_at).getTime() < JANELA_AGRUPAR_MS;

    itens.push({ tipo: "msg", chave: m.id, m, primeira: !proximoDoMesmo, ultima: true });
    const ult = itens.length >= 2 ? itens[itens.length - 2] : null;
    if (proximoDoMesmo && ult && ult.tipo === "msg") ult.ultima = false;
    anterior = m;
  }
  return itens;
}

/* ---------- texto com *negrito* estilo WhatsApp ---------- */
function Formatado({ texto }: { texto: string }) {
  const partes = texto.split(/(\*[^*\n]+\*)/g);
  return (
    <>
      {partes.map((p, i) =>
        p.length > 2 && p.startsWith("*") && p.endsWith("*") ? <strong key={i}>{p.slice(1, -1)}</strong> : <React.Fragment key={i}>{p}</React.Fragment>
      )}
    </>
  );
}

/* ---------- cartão de imóvel ---------- */
interface ImovelParse {
  titulo: string;
  specs: { quartos?: string; vagas?: string; area?: string };
  rotuloPreco: string;
  preco: string;
  codigo: string;
}

function parseImovel(legenda: string): ImovelParse {
  const linhas = (legenda || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const semEmoji = (s: string) => s.replace(/^[^A-Za-z0-9À-ÿ*]+/, "").replace(/\*/g, "").trim();
  const titulo = semEmoji(linhas[0] || "Imóvel");
  const linhaSpecs = linhas.find((l) => /quarto|vaga|m²/i.test(l)) || "";
  const quartos = linhaSpecs.match(/(\d+)\s*quarto/i)?.[1];
  const vagas = linhaSpecs.match(/(\d+)\s*vaga/i)?.[1];
  const area = linhaSpecs.match(/([\d.,]+)\s*m²/i)?.[1];
  const linhaPreco = linhas.find((l) => /R\$/.test(l)) || "";
  const preco = linhaPreco.match(/R\$\s?[\d.]+(?:,\d{2})?(?:\/m[êe]s)?/i)?.[0] || "";
  const rotuloPreco = /aluguel/i.test(linhaPreco) ? "Aluguel" : /venda/i.test(linhaPreco) ? "Venda" : "";
  const codigo = legenda.match(/C[óo]digo:\s*\*?(\d+)/i)?.[1] || "";
  return { titulo, specs: { quartos, vagas, area }, rotuloPreco, preco, codigo };
}

function CartaoImovel({ m, onAbrir }: { m: MensagemChat; onAbrir: (src: string) => void }) {
  const d = parseImovel(m.conteudo || "");
  return (
    <CartaoImovelBase
      foto={m.midia}
      titulo={d.titulo}
      preco={d.preco}
      rotuloPreco={d.rotuloPreco}
      codigo={d.codigo}
      quartos={d.specs.quartos}
      vagas={d.specs.vagas}
      area={d.specs.area}
      onFoto={onAbrir}
    />
  );
}

const ROTULO_TEMPERATURA: Record<string, string> = { quente: "Quente", morno: "Morno", frio: "Frio" };

/** Ficha de cliente enviada pela equipe como ação rápida. */
function CartaoLead({ m }: { m: MensagemChat }) {
  const l = (m.cartao?.lead || {}) as Record<string, string | null>;
  const linhas: [string, string | null | undefined][] = [
    ["Telefone", l.telefone], ["E-mail", l.email], ["Procura", l.busca], ["Origem", l.origem],
    ["Interesse", l.temperatura ? ROTULO_TEMPERATURA[l.temperatura] || l.temperatura : null],
    ["Responsável", l.responsavel || "ainda sem corretor"], ["Último contato", l.ultimo_contato], ["Observações", l.observacoes],
  ];
  return (
    <article className="rounded-2xl overflow-hidden border border-[var(--line-2)] w-full max-w-[22rem]" style={{ background: "color-mix(in srgb, var(--info) 8%, var(--card))" }}>
      <header className="flex items-center gap-2.5 px-3.5 py-2.5" style={{ borderBottom: "1px solid var(--line)" }}>
        <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--card-2)", color: "var(--text-2)" }}><UserRound className="w-4 h-4" aria-hidden /></span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-4)" }}>Ficha do cliente</p>
          <h4 className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>{l.nome || "Cliente"}</h4>
        </div>
      </header>
      <dl className="px-3.5 py-2.5 space-y-1.5 text-[13px]">
        {linhas.filter(([, v]) => v).map(([r, v]) => (
          <div key={r} className="grid grid-cols-[6.2rem_1fr] gap-2"><dt style={{ color: "var(--text-3)" }}>{r}</dt><dd className="min-w-0 [overflow-wrap:anywhere]" style={{ color: "var(--text)" }}>{v}</dd></div>
        ))}
      </dl>
    </article>
  );
}

/** Book em PDF enviado pelo agente ou pela equipe: abre o arquivo com o token (o storage é privado). */
function CartaoBook({ m }: { m: MensagemChat }) {
  const c = m.cartao;
  const total = c?.imoveis?.length || 0;
  const nome = c?.arquivo || "book.pdf";
  const [abrindo, setAbrindo] = useState(false);
  const [erro, setErro] = useState(false);
  const fotos = (c?.imoveis || []).map((i) => i.foto_url).filter(Boolean).slice(0, 3) as string[];
  const abrir = async () => {
    if (!m.midia) return;
    setAbrindo(true); setErro(false);
    try {
      const res = await fetchApi(m.midia);
      if (!res.ok) throw new Error("falha");
      window.open(URL.createObjectURL(await res.blob()), "_blank", "noopener");
    } catch {
      setErro(true);
    } finally {
      setAbrindo(false);
    }
  };
  return (
    <article className="rounded-2xl overflow-hidden border border-[var(--line-2)] w-full max-w-[22rem]" style={{ background: "color-mix(in srgb, var(--info) 8%, var(--card))" }}>
      {fotos.length > 0 && (
        <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${fotos.length}, 1fr)` }}>
          {fotos.map((f, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={f} alt="" referrerPolicy="no-referrer" className="w-full h-24 object-cover" />
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 px-3.5 py-3">
        <span className="w-10 h-12 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--card-2)", color: "var(--danger)" }}><FileText className="w-5 h-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-4)" }}>Book{total ? ` · ${total} ${total === 1 ? "imóvel" : "imóveis"}` : ""}</p>
          <h4 className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>{c?.titulo || m.conteudo || "Book de imóveis"}</h4>
          <p className="text-xs truncate" style={{ color: "var(--text-3)" }}>{nome}{c?.modelo ? ` · ${c.modelo}` : ""}</p>
        </div>
      </div>
      {m.midia && (
        <div className="px-3.5 pb-3">
          <button type="button" onClick={abrir} disabled={abrindo} className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent-text)] hover:underline disabled:opacity-50">
            {abrindo ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <FileText className="w-3.5 h-3.5" aria-hidden />} Abrir PDF
          </button>
          {erro && <span role="alert" className="ml-2 text-[11px]" style={{ color: "var(--danger)" }}>Não foi possível abrir o arquivo.</span>}
        </div>
      )}
    </article>
  );
}

/* ---------- player de áudio ---------- */
function barras(semente: string, n = 32): number[] {
  let h = 2166136261;
  for (let i = 0; i < semente.length; i++) h = Math.imul(h ^ semente.charCodeAt(i), 16777619);
  return Array.from({ length: n }, () => {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    return 0.25 + ((h % 1000) / 1000) * 0.75;
  });
}

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

function PlayerAudio({ m, transcricao }: { m: MensagemChat; transcricao: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);
  const [tocando, setTocando] = useState(false);
  const [tempo, setTempo] = useState(0);
  const [duracao, setDuracao] = useState(0);
  const [velocidade, setVelocidade] = useState(1);
  const [verTexto, setVerTexto] = useState(false);
  const ref = useRef<HTMLAudioElement | null>(null);
  const querTocar = useRef(false);
  const alturas = useMemo(() => barras(m.id), [m.id]);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const temArquivo = !!m.midia;

  const alternar = async () => {
    const audio = ref.current;
    if (!url) {
      if (!m.midia) return;
      setCarregando(true);
      setErro(false);
      querTocar.current = true;
      try {
        // O áudio fica no storage privado: busca com o token e toca por blob.
        const res = await fetchApi(m.midia);
        if (!res.ok) throw new Error("falha");
        setUrl(URL.createObjectURL(await res.blob()));
      } catch {
        setErro(true);
        querTocar.current = false;
      } finally {
        setCarregando(false);
      }
      return;
    }
    if (!audio) return;
    if (audio.paused) await audio.play().catch(() => setErro(true));
    else audio.pause();
  };

  const progresso = duracao > 0 ? tempo / duracao : 0;
  const proximaVelocidade = () => {
    const v = velocidade === 1 ? 1.5 : velocidade === 1.5 ? 2 : 1;
    setVelocidade(v);
    if (ref.current) ref.current.playbackRate = v;
  };

  const buscar = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = ref.current;
    if (!audio || !duracao) return;
    const r = e.currentTarget.getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duracao;
  };

  return (
    <div className="min-w-[230px] max-w-[300px]">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={alternar}
          disabled={!temArquivo || carregando}
          aria-label={tocando ? "Pausar áudio" : "Tocar áudio"}
          className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-[var(--accent-strong)] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition"
        >
          {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : tocando ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>
        <div className="flex-1 min-w-0">
          <div
            role="slider"
            aria-label="Posição do áudio"
            aria-valuemin={0}
            aria-valuemax={Math.round(duracao)}
            aria-valuenow={Math.round(tempo)}
            onClick={buscar}
            className={`flex items-center gap-[2px] h-8 ${url ? "cursor-pointer" : ""}`}
          >
            {alturas.map((a, i) => (
              <span
                key={i}
                className="flex-1 rounded-full transition-colors"
                style={{
                  height: `${Math.round(a * 100)}%`,
                  backgroundColor: i / alturas.length < progresso ? "var(--accent)" : "var(--line-2)",
                }}
              />
            ))}
          </div>
          <div className="flex items-center justify-between text-[10px] text-[var(--text-3)] mt-0.5">
            <span>{url ? `${fmt(tempo)} / ${fmt(duracao)}` : temArquivo ? "Toque para ouvir" : "Arquivo não guardado"}</span>
            {url && (
              <button type="button" onClick={proximaVelocidade} className="px-1.5 rounded bg-[var(--card-2)] text-[var(--text-2)] font-medium">
                {velocidade}x
              </button>
            )}
          </div>
        </div>
      </div>

      {erro && <p className="mt-1 text-[11px] text-[var(--danger)]">Não foi possível carregar o áudio.</p>}

      {url && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio
          ref={ref}
          src={url}
          preload="metadata"
          onLoadedMetadata={(e) => {
            setDuracao(e.currentTarget.duration);
            e.currentTarget.playbackRate = velocidade;
            if (querTocar.current) {
              querTocar.current = false;
              e.currentTarget.play().catch(() => setErro(true));
            }
          }}
          onTimeUpdate={(e) => setTempo(e.currentTarget.currentTime)}
          onPlay={() => setTocando(true)}
          onPause={() => setTocando(false)}
          onEnded={() => { setTocando(false); setTempo(0); }}
        />
      )}

      {transcricao && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setVerTexto((v) => !v)}
            aria-expanded={verTexto}
            className="text-[11px] font-medium text-[var(--accent-text)] hover:underline"
          >
            {verTexto ? "Ocultar transcrição" : "Ver transcrição"}
          </button>
          {verTexto && <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-2)] whitespace-pre-wrap">{transcricao}</p>}
        </div>
      )}
    </div>
  );
}

/* ---------- visualizador de imagem ---------- */
function Visualizador({ src, onFechar }: { src: string; onFechar: () => void }) {
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Foto ampliada" onClick={onFechar} className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <button type="button" onClick={onFechar} aria-label="Fechar" className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white">
        <X className="w-5 h-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Foto do imóvel" referrerPolicy="no-referrer" onClick={(e) => e.stopPropagation()} className="max-h-[88vh] max-w-[92vw] rounded-xl object-contain shadow-2xl" />
    </div>
  );
}

/* ---------- atalho para o processo da IA ---------- */
function LinkProcesso({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-[var(--hover-solid)] hover:text-[var(--accent-text)] transition-colors">
      <Workflow className="w-3 h-3" aria-hidden /> Como a IA respondeu
    </button>
  );
}

/* ---------- balão ---------- */
function Balao({ item, onAbrir, onProcesso }: { item: Extract<Item, { tipo: "msg" }>; onAbrir: (src: string) => void; onProcesso?: (id: string) => void }) {
  const { m, primeira, ultima } = item;
  if (m.origem === "nota") return <NotaInterna m={m} />;
  const saida = m.direcao === "outbound";
  const humano = m.origem === "humano";
  const autor = (m.autor || "").split("@")[0] || "equipe";
  const eAudio = m.tipo === "audio";
  const texto = m.conteudo || (eAudio ? "" : m.tipo === "image" ? "Foto" : m.tipo === "document" ? "Documento" : "(mensagem sem texto)");
  const arredonda = saida
    ? `rounded-2xl ${primeira ? "rounded-tr-md" : ""}`
    : `rounded-2xl ${primeira ? "rounded-tl-md" : ""}`;

  return (
    <div className={`flex ${saida ? "justify-end" : "justify-start"} ${primeira ? "mt-3" : "mt-0.5"}`}>
      <div
        className={`relative max-w-[min(78%,34rem)] px-3 py-2 text-sm leading-relaxed text-[var(--text)] border ${arredonda} ${
          humano ? "border-[var(--line-2)]" : saida ? "bg-[var(--accent-soft)] border-[var(--line-2)]" : "bg-[var(--card)] border-[var(--line)]"
        }`}
        style={humano ? { background: "color-mix(in srgb, var(--info) 11%, var(--card))" } : undefined}
      >
        {primeira && (
          <div className={`flex items-center gap-1.5 text-[11px] font-semibold mb-1 ${humano ? "text-[var(--info)]" : saida ? "text-[var(--accent-text)]" : "text-[var(--text-3)]"}`}>
            {eAudio && <Mic className="w-3 h-3" aria-hidden />}
            {humano ? `Equipe · ${autor}` : saida ? "Acessor" : "Corretor"}
          </div>
        )}
        {eAudio ? (
          <PlayerAudio m={m} transcricao={texto} />
        ) : (
          <p className="whitespace-pre-wrap break-words"><Formatado texto={texto} /></p>
        )}
        {m.tipo === "image" && m.midia && (
          <button type="button" onClick={() => onAbrir(m.midia as string)} className="mt-2 block rounded-xl overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.midia} alt="" loading="lazy" referrerPolicy="no-referrer" className="max-h-64 w-auto object-cover" />
          </button>
        )}
        {ultima && (
          <div className="flex items-center justify-end gap-3 mt-1 text-[10px] text-[var(--text-4)]">
            {m.processo && onProcesso && <LinkProcesso onClick={() => onProcesso(m.id)} />}
            <span>{hora(m.created_at)}</span>
            {saida && (m.status === "sent" ? <CheckCheck className="w-3.5 h-3.5 text-[var(--accent)]" aria-label="Enviada" /> : <Check className="w-3.5 h-3.5" aria-label="Na fila" />)}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- nota interna (só para a equipe) ---------- */
function NotaInterna({ m }: { m: MensagemChat }) {
  const autor = (m.autor || "").split("@")[0] || "equipe";
  return (
    <div className="flex justify-end mt-3">
      <div className="max-w-[min(78%,34rem)] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed" style={{ background: "color-mix(in srgb, var(--warn) 9%, var(--card))", border: "1px dashed color-mix(in srgb, var(--warn) 45%, transparent)", color: "var(--text)" }}>
        <p className="flex items-center gap-1.5 text-[11px] font-semibold mb-1" style={{ color: "var(--warn)" }}>
          <Lock className="w-3 h-3" aria-hidden /> Nota interna · {autor}
        </p>
        <p className="whitespace-pre-wrap break-words">{m.conteudo}</p>
        <p className="mt-1 text-right text-[10px]" style={{ color: "var(--text-4)" }}>{hora(m.created_at)} · só a equipe vê</p>
      </div>
    </div>
  );
}

/* ---------- conversa ---------- */
export default function ChatMensagens({ mensagens, onProcesso }: { mensagens: MensagemChat[]; onProcesso?: (id: string) => void }) {
  const itens = useMemo(() => montarItens(mensagens), [mensagens]);
  // Cada dia é uma seção própria: o chip de data fica preso só dentro do seu dia.
  const secoes = useMemo(() => {
    const out: { chave: string; rotulo: string | null; itens: Exclude<Item, { tipo: "dia" }>[] }[] = [];
    for (const it of itens) {
      if (it.tipo === "dia") out.push({ chave: it.chave, rotulo: it.rotulo, itens: [] });
      else {
        if (!out.length) out.push({ chave: "inicio", rotulo: null, itens: [] });
        out[out.length - 1].itens.push(it);
      }
    }
    return out;
  }, [itens]);
  const [ampliada, setAmpliada] = useState<string | null>(null);

  return (
    <div className="px-3 sm:px-6 pb-4">
      {secoes.map((sec) => (
        <section key={sec.chave} aria-label={sec.rotulo || undefined}>
          {sec.rotulo && (
            <div className="sticky top-2 z-10 flex justify-center my-4">
              <span className="px-3 py-1 rounded-full text-[11px] font-medium bg-[var(--card)] border border-[var(--line)] text-[var(--text-3)] shadow-sm">
                {sec.rotulo}
              </span>
            </div>
          )}
          {sec.itens.map((it) => {
        if (it.tipo === "imoveis") {
          const ultima = it.itens[it.itens.length - 1];
          const comProcesso = it.itens.find((m) => m.processo);
          return (
            <div key={it.chave} className="flex justify-end mt-3">
              <div className="w-full max-w-[min(94%,46rem)]">
                <p className="px-1 pb-2 text-[11px] font-semibold" style={{ color: "var(--accent-text)" }}>
                  {it.itens[0].origem === "humano" ? `Equipe · ${it.itens[0].autor || "portal"}` : "Acessor"} · {it.itens.length} {it.itens.length === 1 ? "imóvel" : "imóveis"}
                </p>
                <div className={`grid gap-3 ${it.itens.length === 1 ? "grid-cols-1 max-w-[16rem]" : "grid-cols-2 xl:grid-cols-3"}`}>
                  {it.itens.map((m) => (
                    <CartaoImovel key={m.id} m={m} onAbrir={setAmpliada} />
                  ))}
                </div>
                <div className="flex items-center justify-end gap-3 mt-2 px-1 text-[10px]" style={{ color: "var(--text-4)" }}>
                  {comProcesso && onProcesso && <LinkProcesso onClick={() => onProcesso(comProcesso.id)} />}
                  <span className="flex items-center gap-1">
                    {hora(ultima.created_at)}
                    <CheckCheck className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} aria-label="Enviadas" />
                  </span>
                </div>
              </div>
            </div>
          );
        }
        if (it.tipo === "msg" && it.m.direcao === "outbound" && (it.m.cartao?.tipo === "book" || it.m.tipo === "document")) {
          return (
            <div key={it.chave} className="flex justify-end mt-3">
              <div>
                {it.m.origem === "humano" && <p className="px-1 pb-2 text-[11px] font-semibold" style={{ color: "var(--info)" }}>Equipe · {it.m.autor || "portal"}</p>}
                <CartaoBook m={it.m} />
                <div className="flex items-center justify-end gap-1 mt-2 px-1 text-[10px]" style={{ color: "var(--text-4)" }}>
                  {hora(it.m.created_at)}<CheckCheck className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} aria-label="Enviado" />
                </div>
              </div>
            </div>
          );
        }
        if (it.tipo === "msg" && it.m.cartao?.tipo === "lead") {
          return (
            <div key={it.chave} className="flex justify-end mt-3">
              <div>
                <p className="px-1 pb-2 text-[11px] font-semibold" style={{ color: "var(--info)" }}>Equipe · {it.m.autor || "portal"}</p>
                <CartaoLead m={it.m} />
                <div className="flex items-center justify-end gap-1 mt-2 px-1 text-[10px]" style={{ color: "var(--text-4)" }}>
                  {hora(it.m.created_at)}<CheckCheck className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} aria-label="Enviada" />
                </div>
              </div>
            </div>
          );
        }
        return <Balao key={it.chave} item={it as Extract<Item, { tipo: "msg" }>} onAbrir={setAmpliada} onProcesso={onProcesso} />;
          })}
        </section>
      ))}
      {ampliada && <Visualizador src={ampliada} onFechar={() => setAmpliada(null)} />}
    </div>
  );
}
