"use client";

import React, { useEffect, useRef, useState } from "react";
import { ICONES_ATIVIDADE } from "@/components/configuracoes/secoes/Personalizacao";
import { ALTURA_HORA, Ativ, COR_PADRAO, TipoAgenda, disporColunas, fundoTipo, hhmm, mesmoDia } from "./util";
import { ListChecks } from "lucide-react";

const HORAS = Array.from({ length: 24 }, (_, i) => i);

export default function Grade({ dias, atividades, tipos, onAbrir, onCriar }: {
  dias: Date[]; atividades: Ativ[]; tipos: Map<string, TipoAgenda>;
  onAbrir: (a: Ativ) => void; onCriar: (dia: Date, hora: string) => void;
}) {
  const rolagem = useRef<HTMLDivElement>(null);
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setAgora(new Date()), 60000); return () => clearInterval(t); }, []);
  useEffect(() => { if (rolagem.current) rolagem.current.scrollTop = ALTURA_HORA * 7 - 8; }, []);

  const hoje = new Date();
  const colunas = `3.75rem repeat(${dias.length}, minmax(${dias.length > 3 ? "7.5rem" : "0"}, 1fr))`;
  const minLargura = dias.length > 3 ? 60 + dias.length * 120 : undefined;
  const topoAgora = (agora.getHours() + agora.getMinutes() / 60) * ALTURA_HORA;

  return (
    <div ref={rolagem} className="flex-1 min-h-0 overflow-auto" role="grid" aria-label="Agenda por horário">
      <div style={{ minWidth: minLargura }}>
        <div className="sticky top-0 z-20 grid" style={{ gridTemplateColumns: colunas, background: "var(--bg)", borderBottom: "1px solid var(--line)" }}>
          <span />
          {dias.map((d) => {
            const ehHoje = mesmoDia(d, hoje);
            return (
              <div key={+d} className="py-3 text-center" style={{ borderLeft: "1px solid var(--line)" }}>
                <p className="text-[11px] tracking-wide uppercase" style={{ color: ehHoje ? "var(--accent-text)" : "var(--text-3)" }}>{d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}</p>
                <span className="mt-1 inline-flex w-10 h-10 items-center justify-center rounded-full text-[22px] font-medium tabular-nums" style={{ background: ehHoje ? "var(--accent-strong)" : "transparent", color: ehHoje ? "#fff" : "var(--text)" }}>{d.getDate()}</span>
              </div>
            );
          })}
        </div>

        <div className="relative grid" style={{ gridTemplateColumns: colunas, height: ALTURA_HORA * 24 }}>
          <div className="relative">
            {HORAS.map((h) => (
              <span key={h} className="absolute right-2 text-[11px] tabular-nums -translate-y-1/2" style={{ top: h * ALTURA_HORA, color: "var(--text-3)", display: h === 0 ? "none" : undefined }}>{String(h).padStart(2, "0")}:00</span>
            ))}
          </div>
          {dias.map((d) => {
            const doDia = atividades.filter((a) => a.inicio && mesmoDia(new Date(a.inicio), d));
            const disp = disporColunas(doDia);
            const ehHoje = mesmoDia(d, hoje);
            return (
              <div key={+d} className="relative cursor-cell" style={{ borderLeft: "1px solid var(--line)", background: ehHoje ? "color-mix(in srgb, var(--text) 3%, transparent)" : undefined }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("[data-bloco]")) return;
                  const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                  const h = Math.min(23, Math.max(0, Math.floor(y / ALTURA_HORA)));
                  onCriar(d, `${String(h).padStart(2, "0")}:00`);
                }}>
                {HORAS.map((h) => <div key={h} className="absolute inset-x-0 pointer-events-none" style={{ top: h * ALTURA_HORA, borderTop: h ? "1px solid var(--line)" : undefined }} />)}
                {doDia.map((a) => {
                  const ini = new Date(a.inicio!);
                  const t = tipos.get(a.tipo);
                  const cor = t?.cor || COR_PADRAO;
                  const Icone = ICONES_ATIVIDADE[t?.icone || ""] || ListChecks;
                  const p = disp.get(a.id) || { col: 0, cols: 1 };
                  const top = (ini.getHours() + ini.getMinutes() / 60) * ALTURA_HORA;
                  const alt = Math.max(26, ((a.duracao_min || 60) / 60) * ALTURA_HORA - 2);
                  return (
                    <button key={a.id} type="button" data-bloco onClick={() => onAbrir(a)}
                      className="absolute z-10 text-left overflow-hidden rounded-lg px-2 py-1 text-xs hover:brightness-125 transition focus-visible:outline focus-visible:outline-2"
                      style={{ top, height: alt, left: `calc(${(p.col / p.cols) * 100}% + 2px)`, width: `calc(${100 / p.cols}% - 4px)`, background: fundoTipo(cor), borderLeft: `3px solid ${cor}`, color: "var(--text)", opacity: a.atrasada ? 0.75 : 1, outlineColor: cor }}
                      aria-label={`${t?.nome || a.tipo}: ${a.titulo}, ${hhmm(ini)}`}>
                      <span className="flex items-center gap-1 font-medium truncate"><Icone className="w-3 h-3 shrink-0" style={{ color: cor }} />{a.titulo}</span>
                      {alt > 40 && <span className="block truncate" style={{ color: "var(--text-3)" }}>{hhmm(ini)}{a.lead_nome ? ` · ${a.lead_nome}` : ""}</span>}
                    </button>
                  );
                })}
                {ehHoje && (
                  <div className="absolute inset-x-0 z-10 pointer-events-none" style={{ top: topoAgora }} aria-hidden>
                    <span className="absolute -left-1 -top-[4px] w-2 h-2 rounded-full" style={{ background: "var(--danger)" }} />
                    <div style={{ borderTop: "1px solid var(--danger)" }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
