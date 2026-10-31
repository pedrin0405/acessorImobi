"use client";

import React, { useEffect, useState } from "react";
import { Check, Pencil, RotateCcw, Trophy, UserRound, XCircle } from "lucide-react";
import { brl, Etapa, Negocio } from "@/lib/crm";
import { Botao, Entrada, Selo } from "@/components/configuracoes/ui";
import { ROTULO_ESTAGIO, rotuloValor, TermometroSelo } from "@/components/crm/FluxoBits";
import { dataCurta, ORIGENS } from "../util";

const Bloco = ({ titulo, acao, children }: { titulo: string; acao?: React.ReactNode; children: React.ReactNode }) => (
  <section className="py-4 first:pt-0 last:pb-0">
    <div className="flex items-center justify-between gap-2 mb-2">
      <h3 className="text-xs font-medium" style={{ color: "var(--text-3)" }}>{titulo}</h3>
      {acao}
    </div>
    {children}
  </section>
);

const Lapis = ({ onClick, rotulo }: { onClick: () => void; rotulo: string }) => (
  <button type="button" onClick={onClick} aria-label={rotulo} title={rotulo} className="p-2 -m-1 rounded-lg hover:bg-[var(--hover-solid)] transition-colors duration-150" style={{ color: "var(--text-3)" }}>
    <Pencil className="w-4 h-4" aria-hidden />
  </button>
);

/** Edição inline de um campo: mostra o valor com um lápis; ao editar troca por input + Salvar/Cancelar. */
function CampoEditavel({ rotulo, editar, children, tipo, valorInicial, desabilitado, onSalvar, dica, min, step, largura }: {
  rotulo: string; editar: string; children: React.ReactNode; tipo: "number" | "date"; valorInicial: string; desabilitado: boolean;
  onSalvar: (v: string) => Promise<boolean>; dica?: string; min?: number; step?: string; largura?: string;
}) {
  const [editando, setEditando] = useState(false);
  const [v, setV] = useState(valorInicial);
  useEffect(() => { if (!editando) setV(valorInicial); }, [valorInicial, editando]);
  const salvar = async () => { if (await onSalvar(v)) setEditando(false); };
  if (!editando) return <><div className="min-w-0 flex-1">{children}</div><Lapis onClick={() => setEditando(true)} rotulo={editar} /></>;
  return (
    <div className="w-full space-y-2">
      <label className="block">
        <span className="block text-xs mb-1" style={{ color: "var(--text-3)" }}>{rotulo}</span>
        <Entrada autoFocus type={tipo} min={min} step={step} value={v} onChange={(e) => setV(e.target.value)} className={largura ?? "w-full"} aria-label={rotulo}
          onKeyDown={(e) => { if (e.key === "Enter" && v) salvar(); if (e.key === "Escape") { e.stopPropagation(); setEditando(false); } }} />
      </label>
      {dica && <p className="text-[11.5px] leading-snug" style={{ color: "var(--text-4)" }}>{dica}</p>}
      <div className="flex gap-2">
        <Botao variante="primario" disabled={desabilitado || !v || v === valorInicial} onClick={salvar}><Check className="w-4 h-4" aria-hidden />Salvar</Botao>
        <Botao variante="fantasma" onClick={() => setEditando(false)}>Cancelar</Botao>
      </div>
    </div>
  );
}

export default function PainelDecisao({
  nv, etapas, ocupado, agir, onAbrirCliente, previsaoCrm,
}: {
  nv: Negocio; etapas: Etapa[]; ocupado: boolean; agir: (corpo: Record<string, unknown>) => Promise<boolean>;
  onAbrirCliente?: (leadId: string) => void; previsaoCrm?: string | null;
}) {
  const aberto = nv.status === "aberto";
  const origem = rotuloValor(nv);
  const [perdendo, setPerdendo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const posAtual = etapas.findIndex((e) => e.id === nv.etapa_id);
  const confirmarPerda = async () => { if (await agir({ status: "perdido", motivo_perda: motivo.trim() })) { setPerdendo(false); setMotivo(""); } };
  const previsao = nv.fechamento_previsto ? dataCurta(nv.fechamento_previsto) : previsaoCrm ? dataCurta(previsaoCrm) : null;

  return (
    <div className="divide-y divide-[color:var(--line)]">
      <Bloco titulo="Situação">
        <div className="flex flex-wrap items-center gap-1.5">
          <Selo tom={nv.status === "ganho" ? "ok" : nv.status === "perdido" ? "perigo" : "info"}>{nv.status === "aberto" ? "Em aberto" : nv.status === "ganho" ? "Ganho" : "Perdido"}</Selo>
          <TermometroSelo valor={nv.im_termometro} />
          {nv.im_qualificado && <Selo tom="ok">Qualificado</Selo>}
          {nv.lead_origem && <Selo tom={nv.lead_origem === "imoview" ? "info" : "neutro"}>{ORIGENS[nv.lead_origem] ?? nv.lead_origem}</Selo>}
          {nv.imoview_estagio && ROTULO_ESTAGIO[nv.imoview_estagio] && <Selo>Imoview · {ROTULO_ESTAGIO[nv.imoview_estagio]}</Selo>}
        </div>
        {nv.status === "perdido" && nv.motivo_perda && <p className="mt-2 text-[13px]" style={{ color: "var(--text-2)" }}>Motivo: {nv.motivo_perda}</p>}
      </Bloco>

      <Bloco titulo="Valor">
        <div className="flex items-start justify-between gap-2">
          <CampoEditavel
            rotulo="Valor do negócio (R$)" editar="Editar valor" tipo="number" min={0} step="1000" valorInicial={nv.valor > 0 ? String(Math.round(nv.valor)) : ""}
            desabilitado={ocupado} onSalvar={(v) => agir({ valor: Number(v) })}
            dica={nv.valor_manual ? "Valor manual: o CRM do Imoview deixou de sobrescrevê-lo." : "Ao editar, o valor passa a ser manual e o CRM não o sobrescreve."}
          >
            <div className="min-w-0">
              <p className="text-[28px] leading-tight font-semibold tabular-nums" style={{ color: "var(--text)" }}>{nv.valor > 0 ? brl(nv.valor) : "Sem valor"}</p>
              {nv.valor > 0 && (
                <p className="mt-1 text-xs flex flex-wrap items-center gap-x-2 gap-y-1" style={{ color: "var(--text-3)" }}>
                  {nv.valor_manual ? <Selo>Manual</Selo> : origem ? <span>{origem}</span> : null}
                  {nv.im_comissao ? <span className="tabular-nums" style={{ color: "var(--accent-text)" }}>comissão {brl(nv.im_comissao)}</span> : null}
                </p>
              )}
            </div>
          </CampoEditavel>
        </div>
        {nv.valor > 0 && <p className="mt-2 text-xs tabular-nums" style={{ color: "var(--text-3)" }}>{nv.probabilidade}% de chance · esperado {nv.esperado > 0 ? brl(nv.esperado) : "—"}</p>}
      </Bloco>

      <Bloco titulo="Previsão de fechamento">
        <div className="flex items-center justify-between gap-2">
          <CampoEditavel
            rotulo="Previsão de fechamento" editar="Editar previsão" tipo="date" valorInicial={nv.fechamento_previsto?.slice(0, 10) ?? ""} desabilitado={ocupado}
            onSalvar={(v) => agir({ fechamento_previsto: v })}
          >
            <p className="text-sm tabular-nums" style={{ color: previsao ? "var(--text)" : "var(--text-3)" }}>{previsao ?? "Sem previsão"}{!nv.fechamento_previsto && previsao ? <span className="text-xs" style={{ color: "var(--text-4)" }}> · no CRM</span> : null}</p>
          </CampoEditavel>
        </div>
      </Bloco>

      <Bloco titulo="Etapa">
        {/* Desktop: passos na vertical. Mobile: faixa rolável com alvos de toque de 40px. */}
        <ol className="hidden lg:block" aria-label="Etapa do negócio">
          {etapas.map((e, i) => {
            const atual = e.id === nv.etapa_id;
            const feita = posAtual > -1 && i < posAtual;
            return (
              <li key={e.id} className="relative">
                {i < etapas.length - 1 && <span aria-hidden className="absolute left-[11px] top-7 bottom-[-2px] w-px" style={{ background: feita ? "var(--accent)" : "var(--line-2)" }} />}
                <button type="button" disabled={!aberto || ocupado || atual} onClick={() => agir({ etapa: e.nome })} aria-current={atual ? "step" : undefined}
                  className="relative w-full flex items-center gap-3 py-1.5 text-left text-sm rounded-lg transition-colors duration-150 enabled:hover:bg-[var(--hover-solid)] disabled:cursor-default"
                  style={{ color: atual ? "var(--text)" : feita ? "var(--text-2)" : "var(--text-3)", fontWeight: atual ? 600 : 400, opacity: !aberto && !atual ? 0.6 : 1 }}>
                  <span aria-hidden className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors duration-150"
                    style={{ background: atual ? "var(--accent)" : feita ? "var(--accent-soft)" : "var(--card-2)", border: `1px solid ${atual || feita ? "var(--accent)" : "var(--line-2)"}`, color: atual ? "var(--bg)" : "var(--accent-text)" }}>
                    {feita ? <Check className="w-3.5 h-3.5" /> : atual ? <span className="w-2 h-2 rounded-full" style={{ background: "var(--bg)" }} /> : null}
                  </span>
                  <span className="truncate">{e.nome}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="lg:hidden overflow-x-auto -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Etapa do negócio">
          <div className="flex gap-1.5 w-max">
            {etapas.map((e) => {
              const atual = e.id === nv.etapa_id;
              return (
                <button key={e.id} type="button" disabled={!aberto || ocupado || atual} onClick={() => agir({ etapa: e.nome })} aria-current={atual ? "step" : undefined}
                  className="min-h-10 px-3.5 rounded-full text-sm whitespace-nowrap disabled:cursor-default transition-colors duration-150"
                  style={{ background: atual ? "var(--chip)" : "var(--card-2)", color: atual ? "var(--chip-text)" : "var(--text-2)", border: "1px solid var(--line)", fontWeight: atual ? 600 : 400, opacity: !aberto && !atual ? 0.55 : 1 }}>{e.nome}</button>
              );
            })}
          </div>
        </div>
        {nv.travado && <p className="mt-3 text-xs" style={{ color: "var(--warn)" }}>Parado há {nv.dias_na_etapa} dias: passou do prazo de alerta desta etapa.</p>}
      </Bloco>

      <Bloco titulo="Ações">
        <div className="flex flex-wrap gap-2">
          {aberto && <Botao variante="primario" className="min-h-10 flex-1" disabled={ocupado} onClick={() => agir({ status: "ganho" })}><Trophy className="w-4 h-4" aria-hidden />Ganhar</Botao>}
          {aberto && <Botao variante="perigo" className="min-h-10 flex-1" disabled={ocupado} aria-expanded={perdendo} onClick={() => setPerdendo((x) => !x)}><XCircle className="w-4 h-4" aria-hidden />Perder</Botao>}
          {!aberto && <Botao className="min-h-10 flex-1" disabled={ocupado} onClick={() => agir({ status: "aberto" })}><RotateCcw className="w-4 h-4" aria-hidden />Reabrir</Botao>}
        </div>
        {perdendo && aberto && (
          <div className="mt-3 space-y-2 assist-fade">
            <label className="block">
              <span className="block text-xs mb-1" style={{ color: "var(--text-3)" }}>Motivo da perda</span>
              <Entrada autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: preço, comprou com outro" className="w-full"
                onKeyDown={(e) => { if (e.key === "Enter" && motivo.trim()) confirmarPerda(); }} />
            </label>
            <div className="flex gap-2">
              <Botao variante="perigo" disabled={!motivo.trim() || ocupado} onClick={confirmarPerda}>Confirmar perda</Botao>
              <Botao variante="fantasma" onClick={() => setPerdendo(false)}>Cancelar</Botao>
            </div>
          </div>
        )}
        {onAbrirCliente && (
          <button type="button" onClick={() => onAbrirCliente(nv.lead_id)} className="mt-3 inline-flex items-center gap-1.5 min-h-10 text-[13px] underline-offset-2 hover:underline" style={{ color: "var(--text-2)" }}>
            <UserRound className="w-4 h-4" aria-hidden />Mais detalhes do cliente
          </button>
        )}
      </Bloco>
    </div>
  );
}
