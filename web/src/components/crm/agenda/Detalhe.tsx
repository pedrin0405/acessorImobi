"use client";

import React, { useState } from "react";
import { Check, Clock, MapPin, User, Home, UserRound } from "lucide-react";
import { Botao, Entrada, Selo } from "@/components/configuracoes/ui";
import Janela from "./Janela";
import { Ativ, COR_PADRAO, TipoAgenda, hhmm, iso } from "./util";

export default function Detalhe({ a, tipo, onFechar, onStatus, onRemarcar }: {
  a: Ativ; tipo?: TipoAgenda; onFechar: () => void;
  onStatus: (a: Ativ, s: "concluida" | "cancelada") => void; onRemarcar: (a: Ativ, data: string, hora: string) => void;
}) {
  const ini = a.inicio ? new Date(a.inicio) : null;
  const [data, setData] = useState(ini ? iso(ini) : "");
  const [hora, setHora] = useState(ini ? hhmm(ini) : "09:00");
  const cor = tipo?.cor || COR_PADRAO;
  const linha = (Ic: React.ComponentType<{ className?: string }>, t: string | null | undefined) => t ? <li className="flex items-center gap-2"><Ic className="w-4 h-4 shrink-0" />{t}</li> : null;
  return (
    <Janela titulo={a.titulo} onFechar={onFechar}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full" style={{ background: `color-mix(in srgb, ${cor} 20%, var(--card))`, color: "var(--text)", border: `1px solid ${cor}` }}>{tipo?.nome || a.tipo}</span>
        {a.atrasada && <Selo tom="perigo">Atrasada</Selo>}
      </div>
      <ul className="space-y-2 text-sm" style={{ color: "var(--text-2)" }}>
        {linha(Clock, ini ? `${ini.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })} às ${hhmm(ini)}${a.duracao_min ? ` · ${a.duracao_min} min` : ""}` : "Sem data")}
        {linha(User, a.corretor_nome && `Corretor: ${a.corretor_nome}`)}
        {linha(UserRound, a.lead_nome && `Cliente: ${a.lead_nome}`)}
        {linha(MapPin, a.local)}
        {linha(Home, a.imovel_codigo ? `Imóvel ${a.imovel_codigo}` : null)}
      </ul>
      <div className="pt-3 space-y-2" style={{ borderTop: "1px solid var(--line)" }}>
        <p className="text-xs" style={{ color: "var(--text-3)" }}>Remarcar</p>
        <div className="flex gap-2"><Entrada type="date" aria-label="Nova data" value={data} onChange={(e) => setData(e.target.value)} /><Entrada type="time" aria-label="Nova hora" value={hora} onChange={(e) => setHora(e.target.value)} className="!w-32" /><Botao onClick={() => onRemarcar(a, data, hora)} disabled={!data}>Remarcar</Botao></div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Botao variante="fantasma" onClick={() => onStatus(a, "cancelada")}>Cancelar atividade</Botao>
        <Botao variante="primario" onClick={() => onStatus(a, "concluida")}><Check className="w-4 h-4" aria-hidden /> Concluir</Botao>
      </div>
    </Janela>
  );
}
