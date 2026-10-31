"use client";

import React from "react";
import { MessageCircle, Sparkles } from "lucide-react";
import { BalaoMensagem } from "./LinhaDoTempo";
import { dia, EventoTempo, Painel, ResumoTempo, rotuloDia, Vazio } from "./util";

/** A conversa do corretor com o cliente (WhatsApp pessoal) em ordem de leitura, com as análises da IA. */
export default function ConversaLead({ eventos, resumo }: { eventos: EventoTempo[]; resumo: ResumoTempo }) {
  const itens = eventos.filter((e) => e.categoria === "conversa" || e.categoria === "analise").slice().reverse();
  if (!itens.length) return <Painel><Vazio icone={MessageCircle} texto="Nenhuma conversa do WhatsApp pessoal vinculada a este cliente ainda. Ela aparece quando o corretor conecta o WhatsApp e o cliente é reconhecido." /></Painel>;
  let ultimoDia = "";
  const analises = itens.filter((e) => e.categoria === "analise").length;
  return (
    <Painel titulo="Conversa no WhatsApp" acao={<span className="text-xs tabular-nums" style={{ color: "var(--text-3)" }}>{resumo.mensagens_corretor} do corretor · {resumo.mensagens_cliente} do cliente{analises ? ` · ${analises} ${analises === 1 ? "análise" : "análises"}` : ""}</span>}>
      <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
        {itens.map((e) => {
          const chave = new Date(e.em).toDateString();
          const separador = chave !== ultimoDia ? <p className="text-center text-[11px] py-2 first-letter:uppercase" style={{ color: "var(--text-4)" }}>{rotuloDia(e.em)}</p> : null;
          ultimoDia = chave;
          return (
            <React.Fragment key={e.id}>
              {separador}
              {e.categoria === "analise" ? (
                <div className="mx-auto max-w-[90%] rounded-xl px-3 py-2 text-[12.5px]" style={{ background: "color-mix(in srgb, var(--info) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--info) 28%, transparent)", color: "var(--text-2)" }}>
                  <p className="flex items-center gap-1.5 text-[11px] font-medium mb-0.5" style={{ color: "var(--info)" }}><Sparkles className="w-3 h-3" aria-hidden />Análise da IA · {dia(e.em)}{e.meta.temperatura ? ` · ${String(e.meta.temperatura)}` : ""}</p>
                  {e.detalhe}
                </div>
              ) : <BalaoMensagem e={e} />}
            </React.Fragment>
          );
        })}
      </div>
    </Painel>
  );
}
