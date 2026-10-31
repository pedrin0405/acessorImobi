"use client";

import React, { useState } from "react";
import { CalendarCheck, FileText, Home, MessageSquare } from "lucide-react";
import { AtendimentoImoview, brl, ImovelImoview } from "@/lib/crm";
import { Selo } from "@/components/configuracoes/ui";
import { ROTULO_ESTAGIO, TermometroSelo } from "@/components/crm/FluxoBits";

const dia = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "");
const diaHora = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const SITUACAO: Record<string, { rotulo: string; tom: "info" | "ok" | "perigo" }> = {
  em_atendimento: { rotulo: "Em atendimento", tom: "info" }, negocio_realizado: { rotulo: "Negócio realizado", tom: "ok" }, descartado: { rotulo: "Descartado", tom: "perigo" },
};

function Sub({ titulo, icone: Icone, children }: { titulo: string; icone?: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h5 className="flex items-center gap-1.5 text-xs font-medium mb-2" style={{ color: "var(--text-3)" }}>{Icone && <Icone className="w-3.5 h-3.5" />}{titulo}</h5>
      {children}
    </div>
  );
}

function MiniImovel({ im, extra }: { im: ImovelImoview | null; extra?: React.ReactNode }) {
  if (!im) return null;
  const detalhes = [im.quartos ? `${im.quartos} qt` : "", im.vagas ? `${im.vagas} vg` : "", im.area ? `${im.area} m²` : ""].filter(Boolean).join(" · ");
  return (
    <div className="flex gap-3 min-w-0">
      {im.foto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={im.foto} alt="" loading="lazy" className="w-16 h-12 rounded-md object-cover shrink-0" style={{ background: "var(--card-2)" }} />
      ) : <div className="w-16 h-12 rounded-md flex items-center justify-center shrink-0" style={{ background: "var(--card-2)" }}><Home className="w-4 h-4" style={{ color: "var(--text-4)" }} aria-hidden /></div>}
      <div className="min-w-0 text-xs">
        <p className="font-medium truncate" style={{ color: "var(--text)" }}>{im.titulo || [im.tipo, im.bairro].filter(Boolean).join(" · ")}</p>
        <p className="truncate" style={{ color: "var(--text-3)" }}>Cód. {im.codigo}{im.bairro ? ` · ${im.bairro}` : ""}{im.valor ? ` · ${im.valor}` : ""}</p>
        {detalhes && <p style={{ color: "var(--text-3)" }}>{detalhes}</p>}
        {extra}
      </div>
    </div>
  );
}

function Campos({ itens }: { itens: [string, React.ReactNode][] }) {
  const lista = itens.filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== false);
  if (!lista.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
      {lista.map(([r, v]) => <div key={r} className="min-w-0"><dt className="text-xs" style={{ color: "var(--text-3)" }}>{r}</dt><dd className="break-words" style={{ color: "var(--text)" }}>{v}</dd></div>)}
    </dl>
  );
}

function Bloco({ a }: { a: AtendimentoImoview }) {
  const [todas, setTodas] = useState(false);
  const sit = SITUACAO[a.situacao_tipo] ?? SITUACAO.em_atendimento;
  const p = a.perfil || {};
  const lista = (v?: string[]) => (v && v.length ? v.join(", ") : "");
  const faixa = (de?: number, ate?: number, f: (v: number) => string = String) => (de && ate ? `${f(de)} a ${f(ate)}` : ate ? `até ${f(ate)}` : de ? `a partir de ${f(de)}` : "");
  const num = (v: number | undefined, rot: string) => (v ? `${v} ${rot}` : "");
  const comodos = [num(p.quartos, "quartos"), num(p.suites, "suítes"), num(p.banheiros, "banheiros"), num(p.vagas, "vagas")].filter(Boolean).join(" · ");
  const extras = [...(p.extras || []), p.financiamento ? "Aceita financiamento" : "", p.permuta ? "Aceita permuta" : ""].filter(Boolean);
  const temPerfil = !!(lista(p.tipos) || lista(p.cidades) || lista(p.bairros) || lista(p.regioes) || comodos || p.valor_de || p.valor_ate || p.area_de || p.area_ate || extras.length || p.destinacao);
  const interacoes = a.interacoes || [];
  const visiveis = todas ? interacoes : interacoes.slice(0, 8);

  return (
    <article className="rounded-2xl p-4" style={{ background: "var(--card-2)", border: "1px solid var(--line)" }}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>Atendimento #{a.codigo}</span>
        <Selo tom={sit.tom}>{a.situacao || sit.rotulo}</Selo>
        <Selo>{a.finalidade}</Selo>
        <TermometroSelo valor={a.termometro} />
        {a.qualificado && <Selo tom="ok">Qualificado</Selo>}
        {a.estagio && ROTULO_ESTAGIO[a.estagio] && <Selo tom="info">{ROTULO_ESTAGIO[a.estagio]}</Selo>}
      </div>
      <div className="mt-3">
        <Campos itens={[
          ["Funil", a.funil], ["Mídia", [a.midia, a.campanha].filter(Boolean).join(" · ")], ["Unidade", a.unidade], ["Corretor", a.corretor_nome], ["MQL", a.mql_nome],
          ["Entrada do lead", diaHora(a.entrada_em)], ["Primeira resposta", diaHora(a.primeira_resposta_em)], ["Última interação", diaHora(a.ultima_interacao_em)],
          ["Previsão de fechamento", dia(a.previsao_fechamento_em)], ["Fechamento", dia(a.fechamento_em)],
        ]} />
      </div>

      {temPerfil && (
        <Sub titulo="Interesses">
          <Campos itens={[
            ["Tipos", lista(p.tipos)], ["Cidades", lista(p.cidades)], ["Bairros", lista(p.bairros)], ["Regiões", lista(p.regioes)],
            ["Valor", faixa(p.valor_de, p.valor_ate, brl)], ["Área", faixa(p.area_de, p.area_ate, (v) => `${v} m²`)],
            ["Cômodos", comodos], ["Destinação", p.destinacao],
          ]} />
          {extras.length > 0 && <div className="flex flex-wrap gap-1.5 mt-3">{extras.map((e) => <Selo key={e}>{e}</Selo>)}</div>}
        </Sub>
      )}

      {(a.carrinho?.length ?? 0) > 0 && (
        <Sub titulo={`Imóveis de interesse (${a.carrinho!.length})`} icone={Home}>
          <ul className="space-y-3">{a.carrinho!.map((im) => <li key={im.codigo}><MiniImovel im={im} /></li>)}</ul>
        </Sub>
      )}

      {(a.visitas?.length ?? 0) > 0 && (
        <Sub titulo={`Visitas (${a.visitas!.length})`} icone={CalendarCheck}>
          <ul className="space-y-3">
            {a.visitas!.map((v) => (
              <li key={v.codigo}>
                <p className="text-xs mb-1 flex flex-wrap items-center gap-1.5" style={{ color: "var(--text-2)" }}>
                  <span>{diaHora(v.em)}</span>{v.tipo && <span>· {v.tipo}</span>}{v.situacao && <Selo tom={v.situacao === "Realizado" ? "ok" : "info"}>{v.situacao}</Selo>}
                  {v.parecer && <Selo tom={v.parecer === "Gostou" ? "ok" : "aviso"}>{v.parecer}</Selo>}
                </p>
                <MiniImovel im={v.imovel} extra={(v.motivo || v.complemento) ? <p style={{ color: "var(--text-3)" }}>{[v.motivo, v.complemento].filter(Boolean).join(" — ")}</p> : undefined} />
              </li>
            ))}
          </ul>
        </Sub>
      )}

      {(a.propostas?.length ?? 0) > 0 && (
        <Sub titulo={`Propostas (${a.propostas!.length})`} icone={FileText}>
          <ul className="space-y-3">{a.propostas!.map((x) => (
            <li key={x.codigo}><MiniImovel im={x.imovel} extra={<p style={{ color: "var(--text-2)" }}>{[x.valor ? brl(x.valor) : "", x.situacao, dia(x.em)].filter(Boolean).join(" · ")}</p>} /></li>
          ))}</ul>
        </Sub>
      )}

      {(a.negocios?.length ?? 0) > 0 && (
        <Sub titulo={`Negócios fechados (${a.negocios!.length})`} icone={FileText}>
          <ul className="space-y-3">{a.negocios!.map((x) => (
            <li key={x.codigo}><MiniImovel im={x.imovel} extra={<p style={{ color: "var(--text-2)" }}>{[x.valor ? brl(x.valor) : "", x.situacao, dia(x.em)].filter(Boolean).join(" · ")}</p>} /></li>
          ))}</ul>
        </Sub>
      )}

      {interacoes.length > 0 && (
        <Sub titulo={`Interações (${interacoes.length})`} icone={MessageSquare}>
          <ol className="space-y-2.5 border-l pl-3" style={{ borderColor: "var(--line-2)" }}>
            {visiveis.map((i, k) => (
              <li key={k} className="text-xs">
                <p style={{ color: "var(--text-3)" }}>{diaHora(i.em)}{i.usuario ? ` · ${i.usuario.trim()}` : ""}</p>
                <p className="break-words whitespace-pre-line" style={{ color: "var(--text-2)" }}>{i.descricao}</p>
              </li>
            ))}
          </ol>
          {interacoes.length > 8 && (
            <button type="button" onClick={() => setTodas((v) => !v)} className="mt-2 text-xs underline" style={{ color: "var(--text-2)" }}>{todas ? "Mostrar menos" : `Ver todas (${interacoes.length})`}</button>
          )}
        </Sub>
      )}
    </article>
  );
}

export default function AtendimentosImoview({ atendimentos }: { atendimentos: AtendimentoImoview[] }) {
  const ordenados = [...atendimentos].sort((a, b) => Number(b.situacao_tipo === "em_atendimento") - Number(a.situacao_tipo === "em_atendimento"));
  return <div className="space-y-3">{ordenados.map((a) => <Bloco key={a.codigo} a={a} />)}</div>;
}
