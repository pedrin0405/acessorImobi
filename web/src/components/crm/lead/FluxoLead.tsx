"use client";

import React from "react";
import { Handshake } from "lucide-react";
import { brl } from "@/lib/crm";
import { Botao, Selo } from "@/components/configuracoes/ui";
import AvatarDoCorretor from "@/components/corretor/AvatarDoCorretor";
import type { EventoLead, NegocioLead } from "@/components/crm/FichaCliente";
import { rotuloValor } from "@/components/crm/FluxoBits";
import { dataCurta, diaHora, EVENTO_FUNIL, Painel, Vazio } from "./util";

const STATUS: Record<string, { rotulo: string; tom: "info" | "ok" | "perigo" }> = { aberto: { rotulo: "Em aberto", tom: "info" }, ganho: { rotulo: "Ganho", tom: "ok" }, perdido: { rotulo: "Perdido", tom: "perigo" } };

export default function FluxoLead({ negocios, historico, onAbrirNegocio }: { negocios: NegocioLead[]; historico: (EventoLead & { titulo?: string })[]; onAbrirNegocio?: (id: string) => void }) {
  return (
    <div className="space-y-4">
      <Painel titulo={`Negócios no Fluxo (${negocios.length})`}>
        {negocios.length === 0 ? <Vazio icone={Handshake} texto="Este cliente ainda não tem negócio no Fluxo." /> : (
          <ul className="space-y-2.5">
            {negocios.map((n) => {
              const st = STATUS[n.status] ?? STATUS.aberto;
              return (
                <li key={n.id} className="rounded-xl p-3.5 flex flex-wrap items-center gap-x-4 gap-y-2" style={{ background: "var(--card-2)", border: "1px solid var(--line)" }}>
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium" style={{ color: "var(--text)" }}>{n.etapa_nome}<Selo tom={st.tom}>{st.rotulo}</Selo>{n.automatico && <Selo>Automático</Selo>}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "var(--text-3)" }}>
                      {n.corretor_nome ? <span className="inline-flex items-center gap-1.5"><AvatarDoCorretor id={n.corretor_id} nome={n.corretor_nome} tamanho={18} />{n.corretor_nome}</span> : <span>Sem responsável</span>}
                      {n.status === "aberto" && <span>{n.dias_na_etapa} d na etapa</span>}
                      <span>Aberto em {dataCurta(n.created_at)}</span>
                      {n.fechamento_previsto && <span>Previsão {dataCurta(n.fechamento_previsto)}</span>}
                      {n.motivo_perda && <span>Motivo: {n.motivo_perda}</span>}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-base font-semibold tabular-nums" style={{ color: "var(--text)" }}>{n.valor > 0 ? brl(n.valor) : "Sem valor"}</p>
                    <p className="text-[11px]" style={{ color: "var(--text-4)" }}>{n.valor > 0 ? rotuloValor(n) ?? "" : ""}{n.im_comissao ? ` · comissão ${brl(n.im_comissao)}` : ""}</p>
                  </div>
                  {onAbrirNegocio && <Botao onClick={() => onAbrirNegocio(n.id)}>Abrir card</Botao>}
                </li>
              );
            })}
          </ul>
        )}
      </Painel>

      <Painel titulo="Movimentos no Fluxo">
        {historico.length === 0 ? <p className="text-sm" style={{ color: "var(--text-3)" }}>Nenhum movimento registrado.</p> : (
          <ol className="divide-y divide-[color:var(--line)]">
            {historico.map((e, i) => (
              <li key={i} className="py-2.5 flex justify-between gap-3 text-sm">
                <span style={{ color: "var(--text-2)" }}>{EVENTO_FUNIL[e.tipo] ?? e.tipo}{e.para && e.tipo !== "perdido" ? ` · ${e.de ? `${e.de} → ` : ""}${e.para}` : ""}{e.tipo === "perdido" && e.para ? ` · ${e.para}` : ""}</span>
                <span className="text-xs shrink-0 tabular-nums" style={{ color: "var(--text-4)" }}>{diaHora(e.created_at)}</span>
              </li>
            ))}
          </ol>
        )}
      </Painel>
    </div>
  );
}
