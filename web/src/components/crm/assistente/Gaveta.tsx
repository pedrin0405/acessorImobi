"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Plus, Search, Trash2, X } from "lucide-react";
import { fetchApi } from "@/lib/api";

export interface ConversaIA {
  id: string;
  titulo: string;
  atualizada_em: string;
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function rotuloDia(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return "Hoje";
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
}

export default function Gaveta({
  aberta,
  ativaId,
  onFechar,
  onAbrir,
  onNova,
  onExcluida,
  onAuthError,
}: {
  aberta: boolean;
  ativaId: string | null;
  onFechar: () => void;
  onAbrir: (c: ConversaIA) => void;
  onNova: () => void;
  onExcluida: (id: string) => void;
  onAuthError: (e: unknown) => boolean;
}) {
  const [conversas, setConversas] = useState<ConversaIA[] | null>(null);
  const [busca, setBusca] = useState("");
  const [apagando, setApagando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement | null>(null);
  const voltarPara = useRef<HTMLElement | null>(null);

  const carregar = useCallback(
    async (q: string) => {
      try {
        const res = await fetchApi(`/admin/assistente/conversas${q ? `?q=${encodeURIComponent(q)}` : ""}`);
        if (!res.ok) throw new Error("falha");
        setConversas(await res.json());
        setErro(null);
      } catch (e) {
        if (!onAuthError(e)) setErro("Não foi possível carregar as conversas.");
      }
    },
    [onAuthError]
  );

  useEffect(() => {
    if (!aberta) return;
    voltarPara.current = document.activeElement as HTMLElement | null;
    carregar("");
    setBusca("");
    setApagando(null);
    requestAnimationFrame(() => campo.current?.focus());
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", aoTeclar);
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      voltarPara.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta]);

  useEffect(() => {
    if (!aberta) return;
    const t = setTimeout(() => carregar(busca.trim()), 250);
    return () => clearTimeout(t);
  }, [busca, aberta, carregar]);

  const apagar = async (id: string) => {
    try {
      const res = await fetchApi(`/admin/assistente/conversas/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error("falha");
      setConversas((lista) => (lista ? lista.filter((c) => c.id !== id) : lista));
      setApagando(null);
      onExcluida(id);
    } catch (e) {
      if (!onAuthError(e)) setErro("Não foi possível apagar a conversa.");
    }
  };

  if (!aberta) return null;

  const grupos: { rotulo: string; itens: ConversaIA[] }[] = [];
  for (const c of conversas || []) {
    const rotulo = rotuloDia(c.atualizada_em);
    const g = grupos[grupos.length - 1];
    if (g && g.rotulo === rotulo) g.itens.push(c);
    else grupos.push({ rotulo, itens: [c] });
  }

  return (
    <div className="fixed inset-0 z-50 !m-0">
      <div className="assist-fade absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onFechar} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Histórico de conversas com o Acessor"
        className="assist-slide-left absolute right-0 top-0 h-full w-full max-w-md flex flex-col shadow-2xl"
        style={{ background: "var(--sidebar)", borderLeft: "1px solid var(--line-2)" }}
      >
        <header className="flex items-start justify-between gap-3 px-6 pt-6 pb-4">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>Conversas</h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
              {conversas === null ? "Carregando…" : `${conversas.length} ${conversas.length === 1 ? "conversa" : "conversas"} com o Acessor`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { onNova(); onFechar(); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium hover:brightness-110"
              style={{ background: "var(--chip)", color: "var(--chip-text)" }}
            >
              <Plus className="w-4 h-4" /> Nova
            </button>
            <button type="button" onClick={onFechar} aria-label="Fechar histórico" className="p-2 rounded-xl hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}>
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        <div className="px-6 pb-3">
          <label className="relative block">
            <span className="sr-only">Buscar conversa</span>
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-4)" }} aria-hidden />
            <input
              ref={campo}
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar conversa"
              className="w-full pl-10 pr-3 py-2.5 rounded-xl text-sm outline-none border focus:border-[var(--accent)]"
              style={{ background: "var(--input)", borderColor: "var(--line)", color: "var(--text)" }}
            />
          </label>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-6">
          {erro && <p role="alert" className="mx-3 mb-3 text-sm" style={{ color: "var(--danger)" }}>{erro}</p>}
          {conversas && conversas.length === 0 && !erro && (
            <p className="px-3 py-10 text-center text-sm" style={{ color: "var(--text-3)" }}>
              {busca ? "Nenhuma conversa encontrada." : "Suas conversas com o Acessor aparecem aqui."}
            </p>
          )}
          {grupos.map((g) => (
            <section key={g.rotulo} className="mb-2">
              <h3 className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-4)" }}>{g.rotulo}</h3>
              <ul>
                {g.itens.map((c) => (
                  <li key={c.id} className="group relative">
                    {apagando === c.id ? (
                      <div className="assist-pop flex items-center justify-between gap-2 px-3 py-3 rounded-xl" style={{ background: "var(--card-2)" }}>
                        <span className="text-sm" style={{ color: "var(--text-2)" }}>Apagar esta conversa?</span>
                        <span className="flex gap-1.5">
                          <button type="button" onClick={() => setApagando(null)} className="px-2.5 py-1 rounded-lg text-xs hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}>Cancelar</button>
                          <button type="button" onClick={() => apagar(c.id)} className="px-2.5 py-1 rounded-lg text-xs font-medium" style={{ background: "color-mix(in srgb, var(--danger) 20%, transparent)", color: "var(--danger)" }}>Apagar</button>
                        </span>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => { onAbrir(c); onFechar(); }}
                          aria-current={ativaId === c.id}
                          className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left hover:bg-[var(--hover-solid)] transition-colors"
                          style={ativaId === c.id ? { background: "var(--hover-solid)" } : undefined}
                        >
                          <MessageCircle className="w-[18px] h-[18px] shrink-0" style={{ color: "var(--text-3)" }} aria-hidden />
                          <span className="flex-1 min-w-0 truncate text-sm" style={{ color: "var(--text)" }}>{c.titulo}</span>
                          <span className="text-xs tabular-nums shrink-0 group-hover:opacity-0 group-focus-within:opacity-0 transition-opacity" style={{ color: "var(--text-4)" }}>{hora(c.atualizada_em)}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setApagando(c.id)}
                          aria-label={`Apagar conversa: ${c.titulo}`}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-[var(--hover-solid)]"
                          style={{ color: "var(--text-3)" }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </aside>
    </div>
  );
}
