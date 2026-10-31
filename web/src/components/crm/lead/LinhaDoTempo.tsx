"use client";

import React, { useMemo, useState } from "react";
import { ArrowDownUp, Image as ImagemIcone, Mic, Paperclip, Search, UserCheck } from "lucide-react";
import { Selo } from "@/components/configuracoes/ui";
import { CATEGORIAS, Categoria, dia, EventoTempo, hora, ORIGEM_EVENTO, ResumoTempo, rotuloDia, SeloAutor, Vazio } from "./util";

const NIVEL_TEXTO = 220;

/** Balão compacto de uma mensagem do WhatsApp (corretor à direita, cliente à esquerda). */
export function BalaoMensagem({ e, comData }: { e: EventoTempo; comData?: boolean }) {
  const meu = e.autor_tipo === "corretor";
  const midia = e.meta.midia as string | undefined;
  const Icone = midia === "audio" ? Mic : midia === "image" ? ImagemIcone : midia === "document" ? Paperclip : null;
  return (
    <div className={`flex ${meu ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[85%] rounded-2xl px-3 py-2 text-[13px]" style={{ background: meu ? "var(--accent-soft)" : "var(--card-2)", border: "1px solid var(--line)", borderTopRightRadius: meu ? 6 : undefined, borderTopLeftRadius: meu ? undefined : 6 }}>
        <p className="flex items-center gap-1.5 text-[11px] mb-0.5" style={{ color: meu ? "var(--accent-text)" : "var(--info)" }}>
          {Icone && <Icone className="w-3 h-3" aria-hidden />}
          {meu ? (e.autor?.trim() || "Corretor") : "Cliente"}
        </p>
        <p className="whitespace-pre-line break-words" style={{ color: "var(--text)" }}>{e.detalhe || (midia && midia !== "text" ? `(${e.titulo.toLowerCase()})` : e.titulo)}</p>
        <p className="mt-1 text-[10.5px] text-right tabular-nums" style={{ color: "var(--text-4)" }}>{comData ? `${dia(e.em)} · ` : ""}{hora(e.em)}</p>
      </div>
    </div>
  );
}

function Linha({ e }: { e: EventoTempo }) {
  const [aberto, setAberto] = useState(false);
  const cat = CATEGORIAS[e.categoria] ?? CATEGORIAS.acao;
  const Icone = cat.Icone;
  const longo = (e.detalhe?.length ?? 0) > NIVEL_TEXTO;
  const destaque = e.autor_tipo === "corretor";
  return (
    <li className="flex gap-3 py-2.5">
      <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: destaque ? "var(--accent-soft)" : "var(--card-2)", color: destaque ? "var(--accent-text)" : "var(--text-3)" }} title={cat.rotulo}><Icone className="w-4 h-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm font-medium break-words" style={{ color: "var(--text)" }}>{e.titulo}</p>
          <span className="text-[11px] tabular-nums" style={{ color: "var(--text-4)" }}>{hora(e.em)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          <SeloAutor tipo={e.autor_tipo} nome={e.autor} />
          <Selo>{ORIGEM_EVENTO[e.origem] ?? e.origem}</Selo>
        </div>
        {e.detalhe && (
          <>
            <p className={`mt-1.5 text-[13px] whitespace-pre-line break-words ${!aberto && longo ? "line-clamp-3" : ""}`} style={{ color: "var(--text-2)" }}>{e.detalhe}</p>
            {longo && <button type="button" onClick={() => setAberto((v) => !v)} className="mt-0.5 text-xs underline" style={{ color: "var(--text-3)" }}>{aberto ? "Mostrar menos" : "Mostrar mais"}</button>}
          </>
        )}
      </div>
    </li>
  );
}

export default function LinhaDoTempo({
  eventos, resumo, limite, onCarregarMais, carregandoMais, compacto,
}: {
  eventos: EventoTempo[]; resumo: ResumoTempo; limite?: number; onCarregarMais?: () => void; carregandoMais?: boolean; compacto?: boolean;
}) {
  const [categoria, setCategoria] = useState<Categoria | null>(null);
  const [soCorretor, setSoCorretor] = useState(false);
  const [busca, setBusca] = useState("");
  const [antigosPrimeiro, setAntigosPrimeiro] = useState(false);

  const grupos = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    let lista = eventos.filter((e) =>
      (!categoria || e.categoria === categoria) && (!soCorretor || e.autor_tipo === "corretor") &&
      (!termo || `${e.titulo} ${e.detalhe ?? ""} ${e.autor ?? ""}`.toLowerCase().includes(termo)));
    if (antigosPrimeiro) lista = [...lista].reverse();
    const mapa = new Map<string, EventoTempo[]>();
    for (const e of lista) {
      const chave = new Date(e.em).toDateString();
      mapa.set(chave, [...(mapa.get(chave) ?? []), e]);
    }
    return { total: lista.length, itens: Array.from(mapa.entries()) };
  }, [eventos, categoria, soCorretor, busca, antigosPrimeiro]);

  const categorias = (Object.entries(resumo.por_categoria) as [Categoria, number][]).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]);
  const noLimite = limite !== undefined && resumo.total >= limite;

  return (
    <div>
      {!compacto && (
        <div className="rounded-xl px-4 py-3 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2" style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}>
        <UserCheck className="w-4 h-4 shrink-0" aria-hidden />
        <p className="text-sm font-medium flex-1 min-w-[12rem]">
          {resumo.acoes_do_corretor} {resumo.acoes_do_corretor === 1 ? "ação" : "ações"} do corretor{resumo.primeiro_evento ? ` desde ${dia(resumo.primeiro_evento)}` : ""}
        </p>
        <p className="text-xs tabular-nums">{resumo.mensagens_corretor} mensagens do corretor · {resumo.mensagens_cliente} do cliente · {resumo.total} eventos</p>
      </div>
      )}

      {!compacto && (
        <div className="space-y-3 mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative flex-1 min-w-[12rem]">
              <span className="sr-only">Buscar na linha do tempo</span>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-4)" }} aria-hidden />
              <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar no histórico" className="w-full rounded-full border pl-9 pr-3 py-2 text-sm outline-none focus:border-[var(--accent)]" style={{ background: "var(--input)", borderColor: "var(--line-2)", color: "var(--text)" }} />
            </label>
            <button type="button" onClick={() => setSoCorretor((v) => !v)} aria-pressed={soCorretor} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium" style={{ background: soCorretor ? "var(--chip)" : "var(--accent-soft)", color: soCorretor ? "var(--chip-text)" : "var(--accent-text)" }}>
              <UserCheck className="w-4 h-4" aria-hidden /> Só o que o corretor fez
            </button>
            <button type="button" onClick={() => setAntigosPrimeiro((v) => !v)} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm" style={{ border: "1px solid var(--line-2)", color: "var(--text-2)" }}>
              <ArrowDownUp className="w-4 h-4" aria-hidden /> {antigosPrimeiro ? "Mais antigos primeiro" : "Mais recentes primeiro"}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por tipo">
            <button type="button" onClick={() => setCategoria(null)} aria-pressed={!categoria} className="px-3 py-1 rounded-full text-xs" style={{ background: !categoria ? "var(--card-2)" : "transparent", color: !categoria ? "var(--text)" : "var(--text-3)", border: "1px solid var(--line)" }}>Tudo · {resumo.total}</button>
            {categorias.map(([c, q]) => {
              const { rotulo, Icone } = CATEGORIAS[c] ?? CATEGORIAS.acao;
              const ativo = categoria === c;
              return (
                <button key={c} type="button" onClick={() => setCategoria(ativo ? null : c)} aria-pressed={ativo} className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs" style={{ background: ativo ? "var(--card-2)" : "transparent", color: ativo ? "var(--text)" : "var(--text-3)", border: "1px solid var(--line)" }}>
                  <Icone className="w-3 h-3" /> {rotulo} · {q}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {grupos.total === 0 ? (
        <Vazio texto={eventos.length === 0 ? "Ainda não há nada registrado para este cliente." : "Nenhum evento com esses filtros."} />
      ) : (
        <div className="space-y-5">
          {grupos.itens.map(([chave, lista]) => {
            const conversas = lista.every((e) => e.categoria === "conversa");
            return (
              <section key={chave} aria-label={rotuloDia(lista[0].em)}>
                <h4 className="sticky top-0 z-[1] py-1.5 text-[11px] font-semibold tracking-wide first-letter:uppercase" style={{ color: "var(--text-4)", background: "var(--card)" }}>{rotuloDia(lista[0].em)}</h4>
                {conversas ? (
                  <div className="space-y-2 mt-1">{(antigosPrimeiro ? lista : [...lista].reverse()).map((e) => <BalaoMensagem key={e.id} e={e} />)}</div>
                ) : (
                  <ol className="divide-y divide-[color:var(--line)]">
                    {lista.map((e) => (e.categoria === "conversa"
                      ? <li key={e.id} className="py-2"><BalaoMensagem e={e} /></li>
                      : <Linha key={e.id} e={e} />))}
                  </ol>
                )}
              </section>
            );
          })}
        </div>
      )}

      {noLimite && onCarregarMais && (
        <div className="mt-4 text-center">
          <button type="button" onClick={onCarregarMais} disabled={carregandoMais} className="px-4 py-2 rounded-full text-sm disabled:opacity-50" style={{ border: "1px solid var(--line-2)", color: "var(--text-2)" }}>{carregandoMais ? "Carregando…" : "Carregar mais eventos"}</button>
        </div>
      )}
    </div>
  );
}
