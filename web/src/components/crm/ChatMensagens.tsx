"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { BedDouble, Car, Check, CheckCheck, Home, Loader2, Mic, Pause, Play, Ruler, X } from "lucide-react";
import { fetchApi } from "@/lib/api";

export interface MensagemChat {
  id: string;
  direcao: "inbound" | "outbound" | string;
  tipo: string;
  conteudo: string | null;
  status: string;
  created_at: string | null;
  midia?: string | null;
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
      if (ultimo && ultimo.tipo === "imoveis") ultimo.itens.push(m);
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
  const [falhou, setFalhou] = useState(false);
  const foto = m.midia && !falhou ? m.midia : null;

  return (
    <article className="rounded-2xl overflow-hidden border border-[var(--line)] bg-[var(--card)] flex flex-col">
      {foto ? (
        <button type="button" onClick={() => onAbrir(foto)} className="relative block aspect-[4/3] w-full bg-[var(--card-2)] group" aria-label={`Ampliar foto: ${d.titulo}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={foto}
            alt={d.titulo}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFalhou(true)}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
          {d.preco && (
            <span className="absolute left-2 bottom-2 px-2 py-0.5 rounded-lg bg-black/70 text-white text-xs font-semibold backdrop-blur-sm">
              {d.preco}
            </span>
          )}
        </button>
      ) : (
        <div className="relative aspect-[4/3] w-full bg-[var(--card-2)] flex items-center justify-center text-[var(--text-4)]">
          <Home className="w-8 h-8" aria-hidden />
          {d.preco && (
            <span className="absolute left-2 bottom-2 px-2 py-0.5 rounded-lg bg-[var(--accent-soft)] text-[var(--accent-text)] text-xs font-semibold">
              {d.preco}
            </span>
          )}
        </div>
      )}
      <div className="p-3 space-y-2">
        <h4 className="text-[13px] font-semibold leading-snug text-[var(--text)] line-clamp-2">{d.titulo}</h4>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-3)]">
          {d.specs.quartos && (
            <span className="inline-flex items-center gap-1"><BedDouble className="w-3.5 h-3.5" aria-hidden />{d.specs.quartos}</span>
          )}
          {d.specs.vagas && (
            <span className="inline-flex items-center gap-1"><Car className="w-3.5 h-3.5" aria-hidden />{d.specs.vagas}</span>
          )}
          {d.specs.area && (
            <span className="inline-flex items-center gap-1"><Ruler className="w-3.5 h-3.5" aria-hidden />{d.specs.area} m²</span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-4)]">
          <span>{d.rotuloPreco}</span>
          {d.codigo && <span className="font-mono">Cód. {d.codigo}</span>}
        </div>
      </div>
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

/* ---------- balão ---------- */
function Balao({ item, onAbrir }: { item: Extract<Item, { tipo: "msg" }>; onAbrir: (src: string) => void }) {
  const { m, primeira, ultima } = item;
  const saida = m.direcao === "outbound";
  const eAudio = m.tipo === "audio";
  const texto = m.conteudo || (eAudio ? "" : m.tipo === "image" ? "Foto" : m.tipo === "document" ? "Documento" : "(mensagem sem texto)");
  const arredonda = saida
    ? `rounded-2xl ${primeira ? "rounded-tr-md" : ""}`
    : `rounded-2xl ${primeira ? "rounded-tl-md" : ""}`;

  return (
    <div className={`flex ${saida ? "justify-end" : "justify-start"} ${primeira ? "mt-3" : "mt-0.5"}`}>
      <div
        className={`relative max-w-[min(78%,34rem)] px-3 py-2 text-sm leading-relaxed text-[var(--text)] border ${arredonda} ${
          saida ? "bg-[var(--accent-soft)] border-[var(--line-2)]" : "bg-[var(--card)] border-[var(--line)]"
        }`}
      >
        {primeira && (
          <div className={`flex items-center gap-1.5 text-[11px] font-semibold mb-1 ${saida ? "text-[var(--accent-text)]" : "text-[var(--info)]"}`}>
            {eAudio && <Mic className="w-3 h-3" aria-hidden />}
            {saida ? "Acessor" : "Corretor"}
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
          <div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-[var(--text-4)]">
            <span>{hora(m.created_at)}</span>
            {saida && (m.status === "sent" ? <CheckCheck className="w-3.5 h-3.5 text-[var(--accent)]" aria-label="Enviada" /> : <Check className="w-3.5 h-3.5" aria-label="Na fila" />)}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- conversa ---------- */
export default function ChatMensagens({ mensagens }: { mensagens: MensagemChat[] }) {
  const itens = useMemo(() => montarItens(mensagens), [mensagens]);
  const [ampliada, setAmpliada] = useState<string | null>(null);

  return (
    <div className="px-3 sm:px-6 pb-4">
      {itens.map((it) => {
        if (it.tipo === "dia") {
          return (
            <div key={it.chave} className="sticky top-2 z-10 flex justify-center my-4">
              <span className="px-3 py-1 rounded-full text-[11px] font-medium bg-[var(--card)] border border-[var(--line)] text-[var(--text-3)] shadow-sm">
                {it.rotulo}
              </span>
            </div>
          );
        }
        if (it.tipo === "imoveis") {
          const ultima = it.itens[it.itens.length - 1];
          return (
            <div key={it.chave} className="flex justify-end mt-3">
              <div className="w-full max-w-[min(92%,44rem)] rounded-2xl border border-[var(--line-2)] bg-[var(--accent-soft)] p-3">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-[11px] font-semibold text-[var(--accent-text)]">
                    Acessor · {it.itens.length} {it.itens.length === 1 ? "imóvel" : "imóveis"}
                  </span>
                </div>
                <div className={`grid gap-2.5 ${it.itens.length === 1 ? "grid-cols-1 max-w-xs" : "grid-cols-2 lg:grid-cols-3"}`}>
                  {it.itens.map((m) => (
                    <CartaoImovel key={m.id} m={m} onAbrir={setAmpliada} />
                  ))}
                </div>
                <div className="flex items-center justify-end gap-1 mt-2 text-[10px] text-[var(--text-4)]">
                  <span>{hora(ultima.created_at)}</span>
                  <CheckCheck className="w-3.5 h-3.5 text-[var(--accent)]" aria-label="Enviadas" />
                </div>
              </div>
            </div>
          );
        }
        return <Balao key={it.chave} item={it} onAbrir={setAmpliada} />;
      })}
      {ampliada && <Visualizador src={ampliada} onFechar={() => setAmpliada(null)} />}
    </div>
  );
}
