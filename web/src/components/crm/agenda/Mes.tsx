"use client";

import React from "react";
import { Ativ, COR_PADRAO, TipoAgenda, dia0, hhmm, mesmoDia, somarDias } from "./util";

export default function Mes({ mes, atividades, tipos, onAbrir, onDia, onCriar }: {
  mes: Date; atividades: Ativ[]; tipos: Map<string, TipoAgenda>;
  onAbrir: (a: Ativ) => void; onDia: (d: Date) => void; onCriar: (d: Date, hora: string) => void;
}) {
  const primeiro = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const inicio = somarDias(primeiro, -primeiro.getDay());
  const dias = Array.from({ length: 42 }, (_, i) => somarDias(inicio, i));
  const hoje = dia0(new Date());
  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="min-w-[640px] h-full flex flex-col">
        <div className="grid grid-cols-7 sticky top-0 z-10" style={{ background: "var(--bg)", borderBottom: "1px solid var(--line)" }}>
          {dias.slice(0, 7).map((d) => <span key={+d} className="py-2.5 text-center text-[11px] uppercase tracking-wide" style={{ color: "var(--text-3)" }}>{d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}</span>)}
        </div>
        <div className="grid grid-cols-7 grid-rows-6 flex-1 min-h-[34rem]">
          {dias.map((d) => {
            const itens = atividades.filter((a) => a.inicio && mesmoDia(new Date(a.inicio), d)).sort((x, y) => +new Date(x.inicio!) - +new Date(y.inicio!));
            const ehHoje = mesmoDia(d, hoje);
            return (
              <div key={+d} className="p-1.5 min-w-0 cursor-cell" style={{ borderLeft: "1px solid var(--line)", borderBottom: "1px solid var(--line)", opacity: d.getMonth() === mes.getMonth() ? 1 : 0.5 }}
                onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) onCriar(d, "09:00"); }}>
                <button type="button" onClick={() => onDia(d)} className="w-7 h-7 rounded-full text-[13px] tabular-nums hover:bg-[var(--hover-solid)]" style={{ background: ehHoje ? "var(--accent-strong)" : undefined, color: ehHoje ? "#fff" : "var(--text-2)" }} aria-label={`Abrir ${d.toLocaleDateString("pt-BR", { dateStyle: "long" })}`}>{d.getDate()}</button>
                <ul className="mt-1 space-y-0.5">
                  {itens.slice(0, 3).map((a) => {
                    const cor = tipos.get(a.tipo)?.cor || COR_PADRAO;
                    return <li key={a.id}><button type="button" onClick={() => onAbrir(a)} className="w-full text-left truncate rounded px-1.5 py-0.5 text-[11px] hover:brightness-125" style={{ background: `color-mix(in srgb, ${cor} 20%, var(--card))`, borderLeft: `2px solid ${cor}`, color: "var(--text)" }}>{hhmm(new Date(a.inicio!))} {a.titulo}</button></li>;
                  })}
                  {itens.length > 3 && <li><button type="button" onClick={() => onDia(d)} className="text-[11px] px-1.5" style={{ color: "var(--text-3)" }}>+{itens.length - 3} mais</button></li>}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
