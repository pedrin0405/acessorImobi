"use client";

import React from "react";
import { Home } from "lucide-react";
import { resumoPerfil } from "@/lib/crm";
import type { Ficha } from "@/components/crm/FichaCliente";
import { tempoAtras } from "@/components/crm/FluxoBits";
import { Negocio } from "@/lib/crm";
import { Campos, diaHora, dia, LinhaDoTempoDados, SeloAutor, TIPO_ATIV } from "../util";

const Secao = ({ titulo, acao, children }: { titulo: string; acao?: React.ReactNode; children: React.ReactNode }) => (
  <section className="py-5 first:pt-0">
    <div className="flex items-center justify-between gap-3 mb-3">
      <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{titulo}</h3>
      {acao}
    </div>
    {children}
  </section>
);

const Ver = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} className="text-xs underline underline-offset-2 min-h-8" style={{ color: "var(--text-3)" }}>{children}</button>
);

/** Aba Resumo do popup: só o que a coluna de decisão não mostra (valor, etapa e previsão ficam lá). */
export default function ResumoNegocio({ nv, ficha, tempo, onAba }: { nv: Negocio; ficha: Ficha; tempo: LinhaDoTempoDados; onAba: (aba: string) => void }) {
  const at = ficha.atendimentos?.[0];
  const r = tempo.resumo;
  const ultimo = tempo.eventos[0];
  const abertas = ficha.atividades.filter((a) => a.status === "aberta").sort((a, b) => (a.inicio ?? "").localeCompare(b.inicio ?? "")).slice(0, 3);
  const carrinho = (ficha.atendimentos ?? []).flatMap((a) => a.carrinho ?? []).slice(0, 3);
  const indicadores: [string, React.ReactNode][] = [
    ["Dias na etapa", nv.dias_na_etapa], ["Interações no CRM", r.interacoes ?? 0], ["Visitas", r.visitas ?? 0], ["Propostas", r.propostas ?? 0],
  ];

  return (
    <div className="divide-y divide-[color:var(--line)]">
      <Secao titulo="Em números">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-y-4 sm:divide-x divide-[color:var(--line)]">
          {indicadores.map(([rotulo, v], i) => (
            <div key={rotulo} className={`min-w-0 ${i > 0 ? "sm:pl-5" : ""}`}>
              <dt className="text-xs" style={{ color: "var(--text-3)" }}>{rotulo}</dt>
              <dd className="mt-0.5 text-2xl font-semibold tabular-nums" style={{ color: "var(--text)" }}>{v}</dd>
            </div>
          ))}
        </dl>
      </Secao>

      {at && (
        <Secao titulo={`Atendimento no Imoview · #${at.codigo}`}>
          <Campos colunas={2} itens={[
            ["Situação", at.situacao], ["Finalidade", at.finalidade], ["Funil", at.funil], ["Mídia", [at.midia, at.campanha].filter(Boolean).join(" · ")],
            ["Corretor no CRM", at.corretor_nome], ["MQL", at.mql_nome], ["Unidade", at.unidade], ["Termômetro", at.termometro], ["Fase", at.fase ? `Fase ${at.fase}` : null],
            ["Entrada do lead", diaHora(at.entrada_em)], ["Primeira resposta", diaHora(at.primeira_resposta_em)], ["Última interação", diaHora(at.ultima_interacao_em)],
            ["Previsão no CRM", dia(at.previsao_fechamento_em)], ["Fechamento", dia(at.fechamento_em)],
          ]} />
        </Secao>
      )}

      <div className="grid md:grid-cols-2 md:divide-x divide-[color:var(--line)]">
        <div className="md:pr-6"><Secao titulo="Último movimento" acao={<Ver onClick={() => onAba("tempo")}>Linha do tempo</Ver>}>
          {ultimo ? (
            <div className="text-sm min-w-0">
              <p className="font-medium break-words" style={{ color: "var(--text)" }}>{ultimo.titulo}</p>
              {ultimo.detalhe && <p className="mt-0.5 text-[13px] line-clamp-2 break-words" style={{ color: "var(--text-3)" }}>{ultimo.detalhe}</p>}
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-3)" }}><SeloAutor tipo={ultimo.autor_tipo} nome={ultimo.autor} /><span>{tempoAtras(ultimo.em)}</span></p>
            </div>
          ) : <p className="text-sm" style={{ color: "var(--text-3)" }}>Nenhum evento registrado.</p>}
        </Secao></div>
        <div className="md:pl-6 border-t md:border-t-0" style={{ borderColor: "var(--line)" }}><Secao titulo="Próximos compromissos" acao={<Ver onClick={() => onAba("agenda")}>Agenda</Ver>}>
          {abertas.length === 0 ? <p className="text-sm" style={{ color: "var(--text-3)" }}>Nenhum compromisso em aberto.</p> : (
            <ul className="space-y-2 text-sm">
              {abertas.map((a) => (
                <li key={a.id} className="flex justify-between gap-3">
                  <span className="truncate" style={{ color: a.atrasada ? "var(--warn)" : "var(--text)" }}>{TIPO_ATIV[a.tipo] ?? a.tipo}: {a.titulo}</span>
                  <span className="text-xs shrink-0 tabular-nums" style={{ color: "var(--text-3)" }}>{a.inicio ? diaHora(a.inicio) : "sem data"}</span>
                </li>
              ))}
            </ul>
          )}
        </Secao></div>
      </div>

      <Secao titulo="O que ele procura">
        <p className="text-sm" style={{ color: "var(--text-2)" }}>{resumoPerfil(ficha.perfil)}</p>
      </Secao>

      <Secao titulo="Imóveis de interesse" acao={carrinho.length ? <Ver onClick={() => onAba("imoveis")}>Ver todos</Ver> : undefined}>
        {carrinho.length === 0 ? <p className="text-sm" style={{ color: "var(--text-3)" }}>Nenhum imóvel no carrinho do Imoview.</p> : (
          <ul className="grid sm:grid-cols-3 gap-4">
            {carrinho.map((im) => (
              <li key={im.codigo} className="flex gap-3 min-w-0">
                {im.foto ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={im.foto} alt="" loading="lazy" className="w-14 h-14 rounded-lg object-cover shrink-0" style={{ background: "var(--card-2)" }} />
                  : <div className="w-14 h-14 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--card-2)" }}><Home className="w-4 h-4" style={{ color: "var(--text-4)" }} aria-hidden /></div>}
                <div className="min-w-0 text-xs">
                  <p className="font-medium line-clamp-2" style={{ color: "var(--text)" }}>{im.titulo || [im.tipo, im.bairro].filter(Boolean).join(" · ")}</p>
                  <p className="mt-0.5 tabular-nums" style={{ color: "var(--text-3)" }}>{im.valor || `Cód. ${im.codigo}`}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Secao>
    </div>
  );
}
