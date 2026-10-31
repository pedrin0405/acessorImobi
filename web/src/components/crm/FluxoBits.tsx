import React from "react";
import { CalendarCheck, FileText, MessageSquare, ShieldCheck } from "lucide-react";
import { Selo } from "@/components/configuracoes/ui";
import { brl, Negocio } from "@/lib/crm";
import { ROTULO_VALOR } from "@/components/crm/lead/util";

const TOM: Record<string, "perigo" | "aviso" | "info"> = { Quente: "perigo", Morno: "aviso", Frio: "info" };

/** Selo de termômetro do Imoview; "Indefinido" e vazio não aparecem. */
export function TermometroSelo({ valor }: { valor?: string | null }) {
  const tom = valor ? TOM[valor] : undefined;
  return tom ? <Selo tom={tom}>{valor}</Selo> : null;
}

export function tempoAtras(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 31) return `há ${d} d`;
  const m = Math.floor(d / 30);
  return m < 12 ? `há ${m} ${m === 1 ? "mês" : "meses"}` : `há ${Math.floor(m / 12)} a`;
}

export const ROTULO_ESTAGIO: Record<string, string> = {
  lead: "Novo lead", contato: "Em contato", qualificado: "Qualificado", visita_agendada: "Visita agendada",
  visita_realizada: "Visita realizada", proposta: "Proposta", negociacao: "Negociação",
};

/** Linhas extras do cartão do Fluxo com o que vem do atendimento no Imoview. */
export function ResumoImoview({ nv }: { nv: Negocio }) {
  const origem = [nv.im_midia, nv.im_campanha].filter(Boolean).join(" · ");
  const contadores = [
    { Icone: MessageSquare, n: nv.im_n_interacoes, titulo: "interações" },
    { Icone: CalendarCheck, n: nv.im_n_visitas, titulo: "visitas" },
    { Icone: FileText, n: nv.im_n_propostas, titulo: "propostas" },
  ].filter((c) => (c.n ?? 0) > 0);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <TermometroSelo valor={nv.im_termometro} />
        {nv.im_qualificado && <Selo tom="ok"><ShieldCheck className="w-3 h-3 mr-1" aria-hidden />Qualificado</Selo>}
      </div>
      {origem && <p className="text-[11px] truncate" style={{ color: "var(--text-3)" }} title={origem}>{origem}</p>}
      {(contadores.length > 0 || nv.im_ultima_interacao) && (
        <div className="flex items-center justify-between gap-2 text-[11px]" style={{ color: "var(--text-3)" }}>
          <span className="flex items-center gap-2">
            {contadores.map(({ Icone, n, titulo }) => (
              <span key={titulo} className="inline-flex items-center gap-0.5 tabular-nums" title={`${n} ${titulo}`}><Icone className="w-3 h-3" aria-hidden />{n}</span>
            ))}
          </span>
          {nv.im_ultima_interacao && <span className="truncate">Contato {tempoAtras(nv.im_ultima_interacao)}</span>}
        </div>
      )}
    </div>
  );
}

interface ComValor { valor: number; valor_manual?: boolean; im_valor_tipo?: string | null; im_comissao?: number | null }

/** De onde vem o valor do negócio: digitado no portal ("Manual") ou deduzido do CRM do Imoview. */
export function rotuloValor(nv: Pick<ComValor, "valor_manual" | "im_valor_tipo">): string | null {
  if (nv.valor_manual) return "Manual";
  return nv.im_valor_tipo ? ROTULO_VALOR[nv.im_valor_tipo] ?? null : null;
}

/** Valor em R$ com a origem logo abaixo (e a comissão, quando o Imoview a informa). */
export function ValorNegocio({ nv, alinhar = "right", comissao = true }: { nv: ComValor; alinhar?: "right" | "left"; comissao?: boolean }) {
  const origem = rotuloValor(nv);
  const cls = alinhar === "right" ? "text-right" : "text-left";
  if (!(nv.valor > 0)) return <span className={`block text-xs ${cls}`} style={{ color: "var(--text-4)" }}>Sem valor</span>;
  return (
    <span className={`block ${cls} leading-tight`}>
      <span className="block text-xs font-semibold tabular-nums" style={{ color: "var(--text-2)" }}>{brl(nv.valor)}</span>
      {origem && <span className="block text-[10px]" style={{ color: "var(--text-4)" }}>{origem}</span>}
      {comissao && nv.im_comissao ? <span className="block text-[10px] tabular-nums" style={{ color: "var(--accent-text)" }}>comissão {brl(nv.im_comissao)}</span> : null}
    </span>
  );
}
