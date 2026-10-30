"use client";

import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Brain, ChevronDown, Cpu, MessageSquare, Mic, Send, Sparkles, Wrench, Zap } from "lucide-react";
import { MensagemChat } from "../ChatMensagens";

export interface PassoIA {
  etapa: string;
  detalhe?: string;
  ms?: number;
  ferramenta?: string;
  argumentos?: Record<string, unknown>;
  resultado?: string;
  motivo?: string;
  tipo?: string;
}

export interface ProcessoDaIA {
  rota: string;
  modelo?: string | null;
  total_ms?: number | null;
  passos: PassoIA[];
}

const ROTAS: Record<string, { rotulo: string; cor: string }> = {
  gemini: { rotulo: "IA (Gemini)", cor: "var(--accent-text)" },
  ollama: { rotulo: "IA local", cor: "var(--accent-text)" },
  ia: { rotulo: "IA", cor: "var(--accent-text)" },
  regras: { rotulo: "Regras, sem IA", cor: "var(--info)" },
  fallback: { rotulo: "Resposta de segurança", cor: "var(--warn)" },
};

export const rotuloRota = (rota: string) => ROTAS[rota] || ROTAS.ia;

export function duracao(ms?: number | null): string {
  if (ms === undefined || ms === null) return "";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1).replace(".", ",")} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

function iconeDaEtapa(etapa: string): React.ReactNode {
  const classe = "w-3.5 h-3.5";
  if (/receb/i.test(etapa)) return <MessageSquare className={classe} aria-hidden />;
  if (/mem[óo]ria/i.test(etapa)) return <Brain className={classe} aria-hidden />;
  if (/transcri/i.test(etapa)) return <Mic className={classe} aria-hidden />;
  if (/ferramenta/i.test(etapa)) return <Wrench className={classe} aria-hidden />;
  if (/falha|seguran/i.test(etapa)) return <AlertTriangle className={classe} aria-hidden />;
  if (/entrega/i.test(etapa)) return <Send className={classe} aria-hidden />;
  if (/rote/i.test(etapa)) return <Zap className={classe} aria-hidden />;
  if (/interpreta|ia$|resposta direta|reda/i.test(etapa)) return <Sparkles className={classe} aria-hidden />;
  return <Cpu className={classe} aria-hidden />;
}

const corDaEtapa = (etapa: string) =>
  /mem[óo]ria/i.test(etapa) ? "var(--info)" : /falha|seguran/i.test(etapa) ? "var(--warn)" : /ferramenta/i.test(etapa) ? "var(--info)" : /interpreta|reda|resposta direta|^ia$/i.test(etapa) ? "var(--accent)" : "var(--text-3)";

function Detalhe({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="mt-1.5">
      <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-4)" }}>{rotulo}</p>
      <div className="mt-0.5 px-2.5 py-1.5 rounded-lg text-[11.5px] leading-relaxed font-mono whitespace-pre-wrap break-words max-h-32 overflow-y-auto" style={{ background: "var(--card-2)", color: "var(--text-2)" }}>
        {children}
      </div>
    </div>
  );
}

/** Linha do tempo do que a IA fez, etapa por etapa, com a duração de cada uma. */
export function LinhaDoTempo({ processo }: { processo: ProcessoDaIA }) {
  const maior = Math.max(...processo.passos.map((p) => p.ms || 0), 1);
  return (
    <ol className="relative">
      {processo.passos.map((p, i) => {
        const cor = corDaEtapa(p.etapa);
        const ultimo = i === processo.passos.length - 1;
        return (
          <li key={i} className="relative pl-8 pb-4 last:pb-0">
            {!ultimo && <span aria-hidden className="absolute left-[11px] top-6 bottom-0 w-px" style={{ background: "var(--line-2)" }} />}
            <span className="absolute left-0 top-0.5 w-[23px] h-[23px] rounded-full flex items-center justify-center" style={{ background: "var(--card-2)", color: cor, border: "1px solid var(--line-2)" }}>
              {iconeDaEtapa(p.etapa)}
            </span>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[13px] font-medium" style={{ color: "var(--text)" }}>{p.etapa}</p>
              {p.ms !== undefined && <span className="text-[11px] tabular-nums shrink-0" style={{ color: "var(--text-3)" }}>{duracao(p.ms)}</span>}
            </div>
            {p.detalhe && <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "var(--text-3)" }}>{p.detalhe}</p>}
            {p.ms !== undefined && p.ms > 0 && (
              <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: "var(--card-2)" }} aria-hidden>
                <div className="h-full rounded-full" style={{ width: `${Math.max(3, (p.ms / maior) * 100)}%`, background: cor, opacity: 0.8 }} />
              </div>
            )}
            {p.ferramenta && p.argumentos && Object.keys(p.argumentos).length > 0 && (
              <Detalhe rotulo="Parâmetros">{JSON.stringify(p.argumentos, null, 1).replace(/^\{\n?|\n?\}$/g, "").trim()}</Detalhe>
            )}
            {p.resultado && <Detalhe rotulo="Resultado">{p.resultado}</Detalhe>}
            {p.motivo && <Detalhe rotulo="Motivo">{p.motivo}</Detalhe>}
          </li>
        );
      })}
    </ol>
  );
}

const trecho = (t: string | null | undefined, n = 70) => {
  const limpo = (t || "").replace(/[*_]/g, "").replace(/\s+/g, " ").replace(/^[^A-Za-z0-9À-ÿ]+/, "").trim();
  return limpo.length > n ? `${limpo.slice(0, n).trimEnd()}…` : limpo;
};

const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "");

/** Aba "IA": cada resposta do agente com o seu processo; a escolhida na conversa abre direto. */
export default function ListaProcessos({ mensagens, focoId }: { mensagens: MensagemChat[]; focoId: string | null }) {
  const [aberta, setAberta] = useState<string | null>(focoId);
  const foco = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (focoId) {
      setAberta(focoId);
      requestAnimationFrame(() => foco.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    }
  }, [focoId]);

  const respostas = mensagens
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.processo)
    .reverse()
    .slice(0, 25);

  if (respostas.length === 0) {
    return <p className="px-1 py-8 text-center text-sm" style={{ color: "var(--text-3)" }}>Ainda não há respostas do agente com o processo registrado nesta conversa.</p>;
  }

  return (
    <ul className="space-y-2">
      {respostas.map(({ m, i }) => {
        const proc = m.processo as unknown as ProcessoDaIA;
        const rota = rotuloRota(proc.rota);
        const aberto = aberta === m.id;
        const pergunta = [...mensagens.slice(0, i)].reverse().find((x) => x.direcao === "inbound");
        return (
          <li key={m.id} ref={m.id === focoId ? foco : undefined} className="rounded-xl" style={{ background: "var(--card-2)", border: `1px solid ${m.id === focoId ? "var(--accent)" : "var(--line)"}` }}>
            <button type="button" onClick={() => setAberta(aberto ? null : m.id)} aria-expanded={aberto} className="w-full flex items-start gap-2 px-3 py-2.5 text-left">
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text-4)" }}>
                  <span className="tabular-nums">{hora(m.created_at)}</span>
                  <span className="font-medium" style={{ color: rota.cor }}>{rota.rotulo}</span>
                  {proc.total_ms ? <span className="tabular-nums">· {duracao(proc.total_ms)}</span> : null}
                </span>
                <span className="block text-[13px] mt-0.5 truncate" style={{ color: "var(--text)" }}>{trecho(m.conteudo) || "Resposta do agente"}</span>
                {pergunta && <span className="block text-[11.5px] truncate" style={{ color: "var(--text-3)" }}>Pergunta: {trecho(pergunta.conteudo, 60)}</span>}
              </span>
              <ChevronDown className={`w-4 h-4 mt-1 shrink-0 transition-transform ${aberto ? "rotate-180" : ""}`} style={{ color: "var(--text-3)" }} aria-hidden />
            </button>
            {aberto && (
              <div className="assist-fade px-3 pb-3 pt-1">
                {proc.modelo && <p className="text-[11px] mb-3" style={{ color: "var(--text-4)" }}>Modelo: {proc.modelo}</p>}
                <LinhaDoTempo processo={proc} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
