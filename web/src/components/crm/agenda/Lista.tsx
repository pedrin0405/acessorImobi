"use client";

import React, { useMemo } from "react";
import { Check, X, CalendarDays } from "lucide-react";
import { ICONES_ATIVIDADE } from "@/components/configuracoes/secoes/Personalizacao";
import { Ativ, COR_PADRAO, TipoAgenda, hhmm, iso } from "./util";
import { ListChecks } from "lucide-react";

export default function Lista({ atividades, tipos, onAbrir, onStatus, apenasAtrasadas }: {
  atividades: Ativ[]; tipos: Map<string, TipoAgenda>; onAbrir: (a: Ativ) => void;
  onStatus: (a: Ativ, s: "concluida" | "cancelada") => void; apenasAtrasadas: boolean;
}) {
  const grupos = useMemo(() => {
    const base = apenasAtrasadas ? atividades.filter((a) => a.atrasada) : atividades;
    const mapa = new Map<string, Ativ[]>();
    base.forEach((a) => {
      const k = !a.inicio ? "sem" : a.atrasada && !apenasAtrasadas ? "atrasadas" : iso(new Date(a.inicio));
      mapa.set(k, [...(mapa.get(k) || []), a]);
    });
    const ordem = Array.from(mapa.keys()).sort((x, y) => (x === "atrasadas" ? -1 : y === "atrasadas" ? 1 : x === "sem" ? 1 : y === "sem" ? -1 : x.localeCompare(y)));
    return ordem.map((k) => [k, (mapa.get(k) || []).sort((a, b) => +new Date(a.inicio || 0) - +new Date(b.inicio || 0))] as const);
  }, [atividades, apenasAtrasadas]);

  if (!grupos.length) return <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center" style={{ color: "var(--text-3)" }}><CalendarDays className="w-8 h-8" aria-hidden /><p className="text-sm max-w-sm">{apenasAtrasadas ? "Nenhuma atividade atrasada." : "Nada neste período. Os corretores marcam pelo WhatsApp (“marca visita com a Ana amanhã às 10h”) ou use Nova atividade."}</p></div>;
  return (
    <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-6 py-4 space-y-6">
      {grupos.map(([k, itens]) => (
        <section key={k}>
          <h3 className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: k === "atrasadas" ? "var(--danger)" : "var(--text-3)" }}>
            {k === "sem" ? "Sem data" : k === "atrasadas" ? `Atrasadas (${itens.length})` : new Date(k + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
          </h3>
          <ul>
            {itens.map((a) => {
              const t = tipos.get(a.tipo); const cor = t?.cor || COR_PADRAO; const Icone = ICONES_ATIVIDADE[t?.icone || ""] || ListChecks;
              return (
                <li key={a.id} className="flex items-center gap-3 py-2.5" style={{ borderTop: "1px solid var(--line)" }}>
                  <span className="w-14 shrink-0 text-sm tabular-nums" style={{ color: "var(--text-2)" }}>{a.inicio ? hhmm(new Date(a.inicio)) : "—"}</span>
                  <button type="button" onClick={() => onAbrir(a)} className="flex-1 min-w-0 text-left flex items-start gap-3">
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `color-mix(in srgb, ${cor} 20%, var(--card))`, color: cor }}><Icone className="w-4 h-4" /></span>
                    <span className="min-w-0"><span className="block text-sm font-medium truncate" style={{ color: "var(--text)" }}>{a.titulo}</span>
                      <span className="block text-xs truncate" style={{ color: "var(--text-3)" }}>{[t?.nome, a.corretor_nome, a.lead_nome && `cliente ${a.lead_nome}`, a.local, a.imovel_codigo && `imóvel ${a.imovel_codigo}`, a.atrasada && a.inicio && `era ${new Date(a.inicio).toLocaleDateString("pt-BR")}`].filter(Boolean).join(" · ")}</span></span>
                  </button>
                  <button type="button" title="Concluir" aria-label={`Concluir ${a.titulo}`} onClick={() => onStatus(a, "concluida")} className="p-2 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--accent-text)" }}><Check className="w-4 h-4" /></button>
                  <button type="button" title="Cancelar" aria-label={`Cancelar ${a.titulo}`} onClick={() => onStatus(a, "cancelada")} className="p-2 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}><X className="w-4 h-4" /></button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
