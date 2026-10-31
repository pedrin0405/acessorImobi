"use client";

import React from "react";
import { CalendarDays } from "lucide-react";
import { Selo } from "@/components/configuracoes/ui";
import AvatarDoCorretor from "@/components/corretor/AvatarDoCorretor";
import type { AtividadeLead } from "@/components/crm/FichaCliente";
import { diaHora, Painel, TIPO_ATIV, Vazio } from "./util";

type Atividade = AtividadeLead & { corretor_id?: string | null; local?: string | null; imovel_codigo?: number | null };

function Item({ a }: { a: Atividade }) {
  const feita = a.status === "concluida", cancelada = a.status === "cancelada";
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: a.atrasada ? "color-mix(in srgb, var(--warn) 16%, transparent)" : "var(--card-2)", color: a.atrasada ? "var(--warn)" : "var(--text-3)" }}><CalendarDays className="w-4 h-4" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium break-words" style={{ color: "var(--text)", textDecoration: feita || cancelada ? "line-through" : undefined }}>{a.titulo}</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>{TIPO_ATIV[a.tipo] ?? a.tipo} · {a.inicio ? diaHora(a.inicio) : "sem data"}{a.local ? ` · ${a.local}` : ""}{a.imovel_codigo ? ` · imóvel ${a.imovel_codigo}` : ""}</p>
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          {a.atrasada && <Selo tom="aviso">Atrasada</Selo>}
          {feita && <Selo tom="ok">Concluída</Selo>}
          {cancelada && <Selo>Cancelada</Selo>}
          {a.status === "aberta" && !a.atrasada && <Selo tom="info">Agendada</Selo>}
          {a.corretor_nome && <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--text-2)" }}><AvatarDoCorretor id={a.corretor_id} nome={a.corretor_nome} tamanho={18} />{a.corretor_nome}</span>}
        </div>
      </div>
    </li>
  );
}

export default function AgendaLead({ atividades }: { atividades: Atividade[] }) {
  const atrasadas = atividades.filter((a) => a.status === "aberta" && a.atrasada);
  const proximas = atividades.filter((a) => a.status === "aberta" && !a.atrasada);
  const passadas = atividades.filter((a) => a.status !== "aberta");
  if (!atividades.length) return <Painel><Vazio icone={CalendarDays} texto="Nenhum compromisso agendado com este cliente." /></Painel>;
  return (
    <div className="space-y-4">
      {[["Atrasadas", atrasadas], ["Próximos compromissos", proximas], ["Concluídas e canceladas", passadas]].map(([titulo, lista]) => {
        const itens = lista as Atividade[];
        return itens.length > 0 ? (
          <Painel key={titulo as string} titulo={`${titulo} (${itens.length})`}>
            <ul className="divide-y divide-[color:var(--line)]">{itens.map((a) => <Item key={a.id} a={a} />)}</ul>
          </Painel>
        ) : null;
      })}
    </div>
  );
}
