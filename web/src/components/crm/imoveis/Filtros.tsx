"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, LayoutGrid, List, Search, SlidersHorizontal, X } from "lucide-react";
import { FILTROS_VAZIOS, Faceta, Facetas, Filtros, ORDENACOES, reais, rotuloFinalidade } from "./tipos";

const campo = "rounded-full text-sm outline-none border transition-colors focus-visible:border-[var(--accent)]";
const estiloCampo: React.CSSProperties = { background: "var(--card-2)", borderColor: "var(--line)", color: "var(--text)" };

/** Botão com painel flutuante: fecha ao clicar fora e com Esc. */
function Popover({ rotulo, destaque, children, largura = "w-72" }: { rotulo: React.ReactNode; destaque?: boolean; children: React.ReactNode; largura?: string }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement | null>(null);
  const id = useId();

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => !raiz.current?.contains(e.target as Node) && setAberto(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  return (
    <div ref={raiz} className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-controls={id}
        className={`${campo} inline-flex items-center gap-2 pl-4 pr-3 py-2 sm:py-2.5 hover:bg-[var(--hover-solid)]`}
        style={destaque ? { ...estiloCampo, borderColor: "var(--accent)", color: "var(--accent-text)" } : estiloCampo}
      >
        {rotulo}
        <ChevronDown className={`w-4 h-4 transition-transform ${aberto ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {aberto && (
        <div id={id} className={`assist-pop absolute left-0 top-full mt-2 z-30 ${largura} max-w-[92vw] rounded-2xl shadow-2xl`} style={{ background: "var(--card)", border: "1px solid var(--line-2)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

function MultiFiltro({
  rotulo, opcoes, selecionados, onChange, comBusca = false,
}: { rotulo: string; opcoes: Faceta[]; selecionados: string[]; onChange: (v: string[]) => void; comBusca?: boolean }) {
  const [q, setQ] = useState("");
  // Mantém visíveis as opções já escolhidas, mesmo que o recorte atual não as contenha.
  const lista = useMemo(() => {
    const base = [...opcoes];
    for (const s of selecionados) if (!base.some((o) => o.valor === s)) base.push({ valor: s, quantidade: 0 });
    const termo = q.trim().toLowerCase();
    return termo ? base.filter((o) => o.valor.toLowerCase().includes(termo)) : base;
  }, [opcoes, selecionados, q]);

  const alternar = (v: string) => onChange(selecionados.includes(v) ? selecionados.filter((x) => x !== v) : [...selecionados, v]);

  return (
    <Popover rotulo={selecionados.length ? `${rotulo} · ${selecionados.length}` : rotulo} destaque={selecionados.length > 0}>
      {comBusca && (
        <div className="p-3 pb-1">
          <label className="relative block">
            <span className="sr-only">Buscar {rotulo.toLowerCase()}</span>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-4)" }} aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar ${rotulo.toLowerCase()}`} className={`${campo} w-full pl-9 pr-3 py-2`} style={estiloCampo} />
          </label>
        </div>
      )}
      <ul className="max-h-72 overflow-y-auto p-2" role="listbox" aria-multiselectable aria-label={rotulo}>
        {lista.length === 0 && <li className="px-3 py-6 text-center text-sm" style={{ color: "var(--text-3)" }}>Nada encontrado.</li>}
        {lista.map((o) => {
          const marcado = selecionados.includes(o.valor);
          return (
            <li key={o.valor}>
              <button
                type="button"
                role="option"
                aria-selected={marcado}
                onClick={() => alternar(o.valor)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm hover:bg-[var(--hover-solid)]"
              >
                <span className="w-4 h-4 shrink-0 rounded flex items-center justify-center" style={{ border: "1px solid var(--line-2)", background: marcado ? "var(--accent)" : "transparent", color: "var(--bg)" }}>
                  {marcado && <Check className="w-3 h-3" strokeWidth={3} aria-hidden />}
                </span>
                <span className="flex-1 min-w-0 truncate" style={{ color: "var(--text)" }}>{o.valor}</span>
                <span className="text-xs tabular-nums" style={{ color: "var(--text-4)" }}>{o.quantidade}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {selecionados.length > 0 && (
        <div className="p-2" style={{ borderTop: "1px solid var(--line)" }}>
          <button type="button" onClick={() => onChange([])} className="w-full px-3 py-2 rounded-lg text-sm hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-2)" }}>Limpar seleção</button>
        </div>
      )}
    </Popover>
  );
}

const soDigitos = (v: string) => v.replace(/\D/g, "").slice(0, 10);
const milhar = (v: string) => (v ? new Intl.NumberFormat("pt-BR").format(Number(v)) : "");

function Minimo({ rotulo, valor, onChange }: { rotulo: string; valor: number | null; onChange: (v: number | null) => void }) {
  return (
    <fieldset>
      <legend className="text-xs mb-1.5" style={{ color: "var(--text-3)" }}>{rotulo}</legend>
      <div className="flex gap-1.5" role="radiogroup" aria-label={rotulo}>
        {[null, 1, 2, 3, 4].map((n) => {
          const ativo = valor === n;
          return (
            <button
              key={String(n)}
              type="button"
              role="radio"
              aria-checked={ativo}
              onClick={() => onChange(n)}
              className="flex-1 py-1.5 rounded-lg text-sm transition-colors"
              style={ativo ? { background: "var(--chip)", color: "var(--chip-text)", fontWeight: 600 } : { background: "var(--card-2)", color: "var(--text-2)", border: "1px solid var(--line)" }}
            >
              {n === null ? "Todos" : `${n}+`}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Faixa({ rotulo, prefixo, min, max, onMin, onMax, dica }: { rotulo: string; prefixo?: string; min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void; dica?: string }) {
  return (
    <fieldset>
      <legend className="text-xs mb-1.5" style={{ color: "var(--text-3)" }}>{rotulo}</legend>
      <div className="flex items-center gap-2">
        {[{ v: min, f: onMin, p: "Mínimo" }, { v: max, f: onMax, p: "Máximo" }].map((c, i) => (
          <label key={i} className="relative flex-1">
            <span className="sr-only">{rotulo}, {c.p.toLowerCase()}</span>
            {prefixo && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--text-4)" }}>{prefixo}</span>}
            <input inputMode="numeric" value={milhar(c.v)} onChange={(e) => c.f(soDigitos(e.target.value))} placeholder={c.p} className={`${campo} w-full py-2 ${prefixo ? "pl-9" : "pl-3"} pr-3`} style={estiloCampo} />
          </label>
        ))}
      </div>
      {dica && <p className="mt-1 text-[11px]" style={{ color: "var(--text-4)" }}>{dica}</p>}
    </fieldset>
  );
}

function Interruptor({ rotulo, ativo, onChange }: { rotulo: string; ativo: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={ativo} onClick={() => onChange(!ativo)} className="w-full flex items-center justify-between gap-3 py-1 text-sm text-left" style={{ color: "var(--text-2)" }}>
      {rotulo}
      <span className="relative w-9 h-5 rounded-full shrink-0 transition-colors" style={{ background: ativo ? "var(--accent)" : "var(--line-2)" }}>
        <span className="absolute top-0.5 w-4 h-4 rounded-full transition-all" style={{ left: ativo ? 18 : 2, background: "var(--bg)" }} />
      </span>
    </button>
  );
}

/** Quantos filtros do painel "Mais filtros" estão ativos. */
export function contarMaisFiltros(f: Filtros): number {
  return [f.quartos_min, f.vagas_min, f.banheiros_min].filter((v) => v !== null).length
    + [f.valor_min || f.valor_max, f.area_min || f.area_max].filter(Boolean).length
    + (f.destaque ? 1 : 0) + (f.incluir_inativos ? 1 : 0);
}

export default function BarraFiltros({
  filtros, onFiltros, facetas, ordem, onOrdem, visao, onVisao, semVisao = false,
}: {
  filtros: Filtros;
  onFiltros: (f: Filtros) => void;
  facetas: Facetas | null;
  ordem: string;
  onOrdem: (o: string) => void;
  visao: "cards" | "tabela";
  onVisao: (v: "cards" | "tabela") => void;
  /** Telas estreitas só têm cards: sem alternador. */
  semVisao?: boolean;
}) {
  const set = <K extends keyof Filtros>(k: K, v: Filtros[K]) => onFiltros({ ...filtros, [k]: v });
  const extras = contarMaisFiltros(filtros);

  return (
    <div className="flex flex-wrap items-center gap-2.5" role="search" aria-label="Filtrar imóveis">
      <label className="relative flex-1 min-w-[15rem] max-w-md">
        <span className="sr-only">Buscar por código, tipo, bairro ou cidade</span>
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-4)" }} aria-hidden />
        <input
          type="search"
          value={filtros.busca}
          onChange={(e) => set("busca", e.target.value)}
          placeholder="Código, tipo, bairro ou cidade"
          className={`${campo} w-full pl-11 pr-4 py-2 sm:py-2.5`}
          style={estiloCampo}
        />
      </label>

      <label className="relative">
        <span className="sr-only">Operação</span>
        <select value={filtros.finalidade} onChange={(e) => set("finalidade", e.target.value)} className={`${campo} appearance-none pl-4 pr-9 py-2 sm:py-2.5 cursor-pointer`} style={estiloCampo}>
          <option value="">Todas as operações</option>
          {(facetas?.finalidade || []).map((f) => (
            <option key={f.valor} value={f.valor}>{rotuloFinalidade(f.valor)} ({f.quantidade})</option>
          ))}
          {filtros.finalidade && !(facetas?.finalidade || []).some((f) => f.valor === filtros.finalidade) && <option value={filtros.finalidade}>{rotuloFinalidade(filtros.finalidade)}</option>}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-3)" }} aria-hidden />
      </label>

      <MultiFiltro rotulo="Tipo" opcoes={facetas?.tipo || []} selecionados={filtros.tipo} onChange={(v) => set("tipo", v)} />
      <MultiFiltro rotulo="Bairro" opcoes={facetas?.bairro || []} selecionados={filtros.bairro} onChange={(v) => set("bairro", v)} comBusca />
      {(facetas?.cidade.length || 0) > 1 || filtros.cidade.length > 0 ? (
        <MultiFiltro rotulo="Cidade" opcoes={facetas?.cidade || []} selecionados={filtros.cidade} onChange={(v) => set("cidade", v)} />
      ) : null}

      <Popover
        largura="w-[22rem]"
        destaque={extras > 0}
        rotulo={<><SlidersHorizontal className="w-4 h-4" aria-hidden />Mais filtros{extras > 0 && <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold flex items-center justify-center" style={{ background: "var(--accent)", color: "var(--bg)" }}>{extras}</span>}</>}
      >
        <div className="p-4 space-y-4">
          <Minimo rotulo="Quartos" valor={filtros.quartos_min} onChange={(v) => set("quartos_min", v)} />
          <Minimo rotulo="Vagas" valor={filtros.vagas_min} onChange={(v) => set("vagas_min", v)} />
          <Minimo rotulo="Banheiros" valor={filtros.banheiros_min} onChange={(v) => set("banheiros_min", v)} />
          <Faixa
            rotulo="Valor" prefixo="R$" min={filtros.valor_min} max={filtros.valor_max}
            onMin={(v) => set("valor_min", v)} onMax={(v) => set("valor_max", v)}
            dica={facetas?.faixas.valor_min != null ? `No recorte atual: ${reais(facetas.faixas.valor_min)} a ${reais(facetas.faixas.valor_max)}` : undefined}
          />
          <Faixa rotulo="Área (m²)" min={filtros.area_min} max={filtros.area_max} onMin={(v) => set("area_min", v)} onMax={(v) => set("area_max", v)} />
          <div className="pt-1 space-y-2" style={{ borderTop: "1px solid var(--line)" }}>
            <Interruptor rotulo="Só imóveis em destaque" ativo={filtros.destaque} onChange={(v) => set("destaque", v)} />
            <Interruptor rotulo="Incluir imóveis que saíram do Imoview" ativo={filtros.incluir_inativos} onChange={(v) => set("incluir_inativos", v)} />
          </div>
        </div>
      </Popover>

      <div className="flex items-center gap-2 ml-auto">
        <label className="relative">
          <span className="sr-only">Ordenar por</span>
          <select value={ordem} onChange={(e) => onOrdem(e.target.value)} className={`${campo} appearance-none pl-4 pr-9 py-2 sm:py-2.5 cursor-pointer`} style={estiloCampo}>
            {ORDENACOES.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-3)" }} aria-hidden />
        </label>
        <div role="radiogroup" aria-label="Modo de exibição" className={`${semVisao ? "hidden" : "inline-flex"} p-0.5 rounded-full`} style={{ background: "var(--card-2)", border: "1px solid var(--line)" }}>
          {([["cards", "Cards", LayoutGrid], ["tabela", "Tabela", List]] as const).map(([id, rotulo, Icone]) => {
            const ativo = visao === id;
            return (
              <button key={id} type="button" role="radio" aria-checked={ativo} onClick={() => onVisao(id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] transition-colors" style={ativo ? { background: "var(--hover-solid)", color: "var(--text)", fontWeight: 600 } : { color: "var(--text-3)" }}>
                <Icone className="w-3.5 h-3.5" aria-hidden />
                <span className="hidden sm:inline">{rotulo}</span>
                <span className="sm:hidden sr-only">{rotulo}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Etiquetas dos filtros ativos, cada uma removível, e "Limpar tudo". */
export function ChipsAtivos({ filtros, onFiltros }: { filtros: Filtros; onFiltros: (f: Filtros) => void }) {
  const chips: { chave: string; texto: string; remover: () => void }[] = [];
  const f = filtros;
  if (f.finalidade) chips.push({ chave: "fin", texto: rotuloFinalidade(f.finalidade), remover: () => onFiltros({ ...f, finalidade: "" }) });
  f.tipo.forEach((t) => chips.push({ chave: `t-${t}`, texto: t, remover: () => onFiltros({ ...f, tipo: f.tipo.filter((x) => x !== t) }) }));
  f.bairro.forEach((b) => chips.push({ chave: `b-${b}`, texto: b, remover: () => onFiltros({ ...f, bairro: f.bairro.filter((x) => x !== b) }) }));
  f.cidade.forEach((c) => chips.push({ chave: `c-${c}`, texto: c, remover: () => onFiltros({ ...f, cidade: f.cidade.filter((x) => x !== c) }) }));
  if (f.quartos_min !== null) chips.push({ chave: "q", texto: `${f.quartos_min}+ quartos`, remover: () => onFiltros({ ...f, quartos_min: null }) });
  if (f.vagas_min !== null) chips.push({ chave: "v", texto: `${f.vagas_min}+ vagas`, remover: () => onFiltros({ ...f, vagas_min: null }) });
  if (f.banheiros_min !== null) chips.push({ chave: "bn", texto: `${f.banheiros_min}+ banheiros`, remover: () => onFiltros({ ...f, banheiros_min: null }) });
  if (f.valor_min || f.valor_max)
    chips.push({ chave: "val", texto: `Valor ${f.valor_min ? `de ${reais(Number(f.valor_min))}` : ""} ${f.valor_max ? `até ${reais(Number(f.valor_max))}` : ""}`.replace(/\s+/g, " ").trim(), remover: () => onFiltros({ ...f, valor_min: "", valor_max: "" }) });
  if (f.area_min || f.area_max)
    chips.push({ chave: "ar", texto: `Área ${f.area_min ? `de ${f.area_min} m²` : ""} ${f.area_max ? `até ${f.area_max} m²` : ""}`.replace(/\s+/g, " ").trim(), remover: () => onFiltros({ ...f, area_min: "", area_max: "" }) });
  if (f.destaque) chips.push({ chave: "d", texto: "Em destaque", remover: () => onFiltros({ ...f, destaque: false }) });
  if (f.incluir_inativos) chips.push({ chave: "i", texto: "Com imóveis desativados", remover: () => onFiltros({ ...f, incluir_inativos: false }) });
  if (f.busca.trim()) chips.push({ chave: "bq", texto: `“${f.busca.trim()}”`, remover: () => onFiltros({ ...f, busca: "" }) });
  if (chips.length === 0) return null;

  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label="Filtros ativos">
      {chips.map((c) => (
        <li key={c.chave}>
          <button type="button" onClick={c.remover} aria-label={`Remover filtro: ${c.texto}`} className="assist-pop inline-flex items-center gap-1.5 pl-3 pr-2 py-1 rounded-full text-xs hover:bg-[var(--hover-solid)]" style={{ background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--text-2)" }}>
            {c.texto}
            <X className="w-3 h-3" aria-hidden />
          </button>
        </li>
      ))}
      <li>
        <button type="button" onClick={() => onFiltros({ ...FILTROS_VAZIOS })} className="px-2 py-1 text-xs hover:underline" style={{ color: "var(--text-3)" }}>Limpar tudo</button>
      </li>
    </ul>
  );
}
