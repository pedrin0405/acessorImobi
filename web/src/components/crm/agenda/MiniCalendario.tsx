"use client";

import React, { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { dia0, mesmoDia, somarDias } from "./util";

const SIGLAS = ["D", "S", "T", "Q", "Q", "S", "S"];

/** Mês com 6 semanas. Clique escolhe um dia; arrastar entre dois dias escolhe um período. */
export default function MiniCalendario({ mes, onMes, visiveis, onEscolher }: {
  mes: Date; onMes: (d: Date) => void; visiveis: Date[];
  onEscolher: (ini: Date, fim: Date) => void;
}) {
  const hoje = dia0(new Date());
  const primeiro = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const inicio = somarDias(primeiro, -primeiro.getDay());
  const dias = Array.from({ length: 42 }, (_, i) => somarDias(inicio, i));
  const [arrasto, setArrasto] = useState<{ de: Date; ate: Date } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const diaSob = (x: number, y: number): Date | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const v = el?.closest<HTMLElement>("[data-dia]")?.dataset.dia;
    return v ? new Date(v + "T00:00:00") : null;
  };
  const faixa = arrasto ? [arrasto.de, arrasto.ate].sort((a, b) => +a - +b) : null;
  const noIntervalo = (d: Date) => (faixa ? d >= faixa[0] && d <= faixa[1] : visiveis.some((v) => mesmoDia(v, d)));

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-medium first-letter:uppercase" style={{ color: "var(--text)" }}>{mes.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</h2>
        <span className="flex gap-1">
          <button type="button" aria-label="Mês anterior" onClick={() => onMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))} className="p-1.5 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}><ChevronLeft className="w-4 h-4" /></button>
          <button type="button" aria-label="Próximo mês" onClick={() => onMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))} className="p-1.5 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}><ChevronRight className="w-4 h-4" /></button>
        </span>
      </div>
      <div ref={ref} role="grid" aria-label="Mini calendário" className="grid grid-cols-7 gap-y-1 text-center select-none" style={{ touchAction: "none" }}
        onPointerMove={(e) => { if (!arrasto) return; const d = diaSob(e.clientX, e.clientY); if (d && !mesmoDia(d, arrasto.ate)) setArrasto({ ...arrasto, ate: d }); }}
        onPointerUp={() => { if (!arrasto) return; const [a, b] = [arrasto.de, arrasto.ate].sort((x, y) => +x - +y); setArrasto(null); onEscolher(a, b); }}
        onPointerCancel={() => setArrasto(null)}>
        {SIGLAS.map((s, i) => <span key={i} className="text-[11px] py-1" style={{ color: "var(--text-3)" }}>{s}</span>)}
        {dias.map((d) => {
          const fora = d.getMonth() !== mes.getMonth();
          const ehHoje = mesmoDia(d, hoje);
          const dentro = noIntervalo(d);
          return (
            <button key={+d} type="button" role="gridcell" data-dia={`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`}
              aria-label={d.toLocaleDateString("pt-BR", { dateStyle: "full" })} aria-current={ehHoje ? "date" : undefined}
              onPointerDown={(e) => { (e.currentTarget.parentElement as HTMLElement).releasePointerCapture?.(e.pointerId); e.currentTarget.releasePointerCapture?.(e.pointerId); setArrasto({ de: d, ate: d }); }}
              className="mx-auto w-8 h-8 rounded-full text-[13px] tabular-nums transition-colors"
              style={{ background: ehHoje ? "var(--accent-strong)" : dentro ? "var(--hover-solid)" : "transparent", color: ehHoje ? "#fff" : fora ? "var(--text-4)" : "var(--text-2)", fontWeight: ehHoje ? 600 : 400 }}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs leading-snug" style={{ color: "var(--text-3)" }}>Arraste entre dois dias para ver um período.</p>
    </div>
  );
}
