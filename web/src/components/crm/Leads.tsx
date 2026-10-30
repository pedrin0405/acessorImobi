"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search, Shuffle, UserCheck, X } from "lucide-react";
import { Perfil } from "@/lib/crm";
import FichaCliente from "./FichaCliente";
import { Aviso, Botao, Entrada, Seletor, Selo, useApi, useRecado } from "@/components/configuracoes/ui";

interface Cliente {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  origem: string;
  temperatura: "quente" | "morno" | "frio";
  perfil: Perfil;
  observacoes: string | null;
  corretor_id: string | null;
  corretor_nome: string | null;
  negocios_abertos: number;
  created_at: string;
  updated_at: string;
}

interface Pagina {
  itens: Cliente[];
  total: number;
  pagina: number;
  por_pagina: number;
  paginas: number;
  resumo: { total: number; sem_responsavel: number; imoview: number };
}

const ORIGENS: Record<string, string> = { whatsapp: "WhatsApp", imoview: "Imoview", manual: "Manual", portal: "Portal", whatsapp_pessoal: "WhatsApp pessoal" };
const rotuloOrigem = (o: string) => ORIGENS[o] || (o.charAt(0).toUpperCase() + o.slice(1)).replace(/_/g, " ");
const COR_TEMP: Record<string, string> = { quente: "var(--danger)", morno: "var(--warn)", frio: "var(--info)" };
const n = (v: number) => v.toLocaleString("pt-BR");
const data = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
const fone = (t: string | null) => {
  const d = (t || "").replace(/\D/g, "");
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return t || "";
};

export default function Leads({ onAuthError, onIr }: { onAuthError: (e: unknown) => boolean; onIr?: (tab: string) => void }) {
  const api = useApi(onAuthError);
  const [dados, setDados] = useState<Pagina | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [corretores, setCorretores] = useState<{ id: string; nome: string }[]>([]);

  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [origem, setOrigem] = useState("");
  const [temperatura, setTemperatura] = useState("");
  const [ordem, setOrdem] = useState("recentes");
  const [pagina, setPagina] = useState(1);

  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [todosDoFiltro, setTodosDoFiltro] = useState(false);
  const [destino, setDestino] = useState("");
  const [atribuindo, setAtribuindo] = useState(false);
  const [recado, mostrar] = useRecado(5000);

  const [aberto, setAberto] = useState<Cliente | null>(null);
  const painel = useRef<HTMLElement>(null);
  const requisicao = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => { setTermo(busca.trim()); setPagina(1); }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  useEffect(() => {
    (async () => {
      const r = await api<{ corretores: { id: string; nome: string | null; status: string }[] }>("/admin/configuracoes/equipe");
      if (r.dados) setCorretores(r.dados.corretores.filter((c) => c.status === "active").map((c) => ({ id: c.id, nome: c.nome || "Corretor" })));
    })();
  }, [api]);

  const filtroAtual = useMemo(() => ({ termo: termo || null, responsavel: responsavel || null, origem: origem || null, temperatura: temperatura || null }), [termo, responsavel, origem, temperatura]);

  const carregar = useCallback(async () => {
    const minha = ++requisicao.current;
    setCarregando(true);
    const q = new URLSearchParams({ ordem, pagina: String(pagina), por_pagina: "25" });
    if (termo) q.set("termo", termo);
    if (responsavel) q.set("responsavel", responsavel);
    if (origem) q.set("origem", origem);
    if (temperatura) q.set("temperatura", temperatura);
    const r = await api<Pagina>(`/admin/crm/clientes?${q}`);
    if (minha !== requisicao.current) return; // chegou uma resposta mais nova
    setCarregando(false);
    if (r.ok && r.dados) { setDados(r.dados); setErro(null); } else if (r.erro) setErro(r.erro);
  }, [api, termo, responsavel, origem, temperatura, ordem, pagina]);
  useEffect(() => { carregar(); }, [carregar]);

  const mudarFiltro = (f: () => void) => { f(); setPagina(1); setMarcados(new Set()); setTodosDoFiltro(false); };

  const abrir = (c: Cliente) => {
    setAberto(c);
    // em telas estreitas a ficha fica abaixo da lista: leva o usuário até ela
    if (typeof window !== "undefined" && window.innerWidth < 1280) setTimeout(() => painel.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const itens = dados?.itens || [];
  const todosDaPagina = itens.length > 0 && itens.every((c) => marcados.has(c.id));
  const quantidadeSelecionada = todosDoFiltro ? dados?.total || 0 : marcados.size;
  const alternar = (id: string) => { setTodosDoFiltro(false); setMarcados((m) => { const x = new Set(m); if (x.has(id)) x.delete(id); else x.add(id); return x; }); };
  const alternarPagina = () => { setTodosDoFiltro(false); setMarcados(todosDaPagina ? new Set() : new Set(itens.map((c) => c.id))); };

  const atribuir = async (roleta: boolean, ids?: string[], corretorId?: string) => {
    setAtribuindo(true);
    const corpo: Record<string, unknown> = roleta ? { roleta: true } : { corretor_id: corretorId || destino };
    if (ids) corpo.ids = ids;
    else if (todosDoFiltro) corpo.filtro = filtroAtual;
    else corpo.ids = Array.from(marcados);
    const r = await api<{ atribuidos: number }>("/admin/crm/clientes/atribuir", { method: "POST", corpo });
    setAtribuindo(false);
    if (!r.ok || !r.dados) return setErro(r.erro);
    setErro(null);
    mostrar(`${n(r.dados.atribuidos)} ${r.dados.atribuidos === 1 ? "cliente atribuído" : "clientes atribuídos"}${roleta ? " pela roleta" : ""}.`);
    setMarcados(new Set()); setTodosDoFiltro(false); setDestino("");
    carregar();
  };

  const resumo = dados?.resumo;
  const filtrando = !!(termo || responsavel || origem || temperatura);

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--text)" }}>Clientes</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-3)" }}>
            {resumo ? <>{n(resumo.total)} {resumo.total === 1 ? "cliente" : "clientes"} · {n(resumo.imoview)} do Imoview · {n(resumo.sem_responsavel)} sem responsável</> : "Carregando…"}
          </p>
        </div>
        {onIr && <Botao onClick={() => onIr("configuracoes")}>Sincronização com o Imoview</Botao>}
      </header>

      <div className="flex flex-wrap gap-2 mb-4">
        <label className="relative flex-1 min-w-[14rem]">
          <span className="sr-only">Buscar cliente</span>
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-4)" }} aria-hidden />
          <Entrada type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, telefone ou e-mail" className="!pl-10 !rounded-full" />
        </label>
        <Seletor aria-label="Responsável" value={responsavel} onChange={(e) => mudarFiltro(() => setResponsavel(e.target.value))} className="!w-auto">
          <option value="">Todos os responsáveis</option>
          <option value="sem">Sem responsável{resumo ? ` (${n(resumo.sem_responsavel)})` : ""}</option>
          {corretores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </Seletor>
        <Seletor aria-label="Origem" value={origem} onChange={(e) => mudarFiltro(() => setOrigem(e.target.value))} className="!w-auto">
          <option value="">Todas as origens</option><option value="imoview">Imoview</option><option value="whatsapp">WhatsApp</option><option value="manual">Manual</option>
        </Seletor>
        <Seletor aria-label="Temperatura" value={temperatura} onChange={(e) => mudarFiltro(() => setTemperatura(e.target.value))} className="!w-auto">
          <option value="">Qualquer temperatura</option><option value="quente">Quente</option><option value="morno">Morno</option><option value="frio">Frio</option>
        </Seletor>
        <Seletor aria-label="Ordenar" value={ordem} onChange={(e) => { setOrdem(e.target.value); setPagina(1); }} className="!w-auto">
          <option value="recentes">Mais recentes</option><option value="atualizados">Atualizados</option><option value="nome">Nome (A–Z)</option>
        </Seletor>
      </div>

      {erro && <div className="mb-4"><Aviso tom="erro">{erro}</Aviso></div>}
      {recado && <div className="mb-4 assist-fade"><Aviso tom="ok">{recado}</Aviso></div>}

      <div className="grid xl:grid-cols-[minmax(0,1fr)_420px] gap-5 items-start">
        <section className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--line)" }} aria-busy={carregando} aria-label="Lista de clientes">
          {marcados.size > 0 || todosDoFiltro ? (
            <div className="assist-fade px-4 py-3 flex flex-wrap items-center gap-3" style={{ background: "var(--accent-soft)", borderBottom: "1px solid var(--line)" }}>
              <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{n(quantidadeSelecionada)} {quantidadeSelecionada === 1 ? "selecionado" : "selecionados"}</span>
              {!todosDoFiltro && todosDaPagina && dados && dados.total > itens.length && (
                <button type="button" onClick={() => setTodosDoFiltro(true)} className="text-[13px] underline underline-offset-2" style={{ color: "var(--accent-text)" }}>Selecionar os {n(dados.total)} {filtrando ? "do filtro" : "clientes"}</button>
              )}
              <span className="flex-1" />
              <Seletor aria-label="Atribuir a" value={destino} onChange={(e) => setDestino(e.target.value)} className="!w-auto"><option value="">Atribuir a…</option>{corretores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Seletor>
              <Botao variante="primario" onClick={() => atribuir(false)} disabled={!destino} carregando={atribuindo}><UserCheck className="w-4 h-4" aria-hidden /> Atribuir</Botao>
              <Botao onClick={() => atribuir(true)} disabled={atribuindo || corretores.length === 0}><Shuffle className="w-4 h-4" aria-hidden /> Distribuir pela roleta</Botao>
              <button type="button" onClick={() => { setMarcados(new Set()); setTodosDoFiltro(false); }} aria-label="Limpar seleção" className="p-1.5 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}><X className="w-4 h-4" /></button>
            </div>
          ) : null}

          {!dados && carregando ? (
            <ul className="p-4 space-y-3" aria-hidden>{[0, 1, 2, 3, 4, 5].map((i) => <li key={i} className="h-12 rounded-xl animate-pulse" style={{ background: "var(--card-2)" }} />)}</ul>
          ) : itens.length === 0 ? (
            <p className="px-6 py-14 text-center text-sm" style={{ color: "var(--text-3)" }}>
              {filtrando ? "Nenhum cliente com esses filtros." : "Nenhum cliente ainda. Os leads do Imoview aparecem aqui depois da importação, e os que o corretor anota no WhatsApp também."}
            </p>
          ) : (
            <div className="overflow-x-auto" style={{ opacity: carregando ? 0.6 : 1, transition: "opacity .15s" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs" style={{ color: "var(--text-4)", borderBottom: "1px solid var(--line)" }}>
                    <th className="pl-4 pr-3 py-3 w-8"><input type="checkbox" checked={todosDaPagina} onChange={alternarPagina} aria-label="Selecionar a página" className="w-4 h-4 accent-[var(--accent)]" /></th>
                    <th className="py-3 pr-3 font-medium">Cliente</th>
                    <th className="py-3 pr-3 font-medium hidden md:table-cell">Origem</th>
                    <th className="py-3 pr-3 font-medium hidden sm:table-cell">Responsável</th>
                    <th className="py-3 pr-4 font-medium hidden lg:table-cell">Entrada</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((c) => {
                    const sel = marcados.has(c.id) || todosDoFiltro;
                    return (
                      <tr key={c.id} onClick={() => abrir(c)} className="cursor-pointer hover:bg-[var(--hover-solid)] transition-colors" style={{ borderTop: "1px solid var(--line)", background: aberto?.id === c.id ? "var(--hover-solid)" : undefined }}>
                        <td className="pl-4 pr-3 py-3" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel} disabled={todosDoFiltro} onChange={() => alternar(c.id)} aria-label={`Selecionar ${c.nome}`} className="w-4 h-4 accent-[var(--accent)]" /></td>
                        <td className="py-3 pr-3 min-w-0">
                          <div className="flex items-center gap-2"><span className="font-medium truncate max-w-[12rem] sm:max-w-[16rem]" style={{ color: "var(--text)" }}>{c.nome}</span><span aria-label={`Temperatura ${c.temperatura}`} title={c.temperatura} className="w-2 h-2 rounded-full shrink-0" style={{ background: COR_TEMP[c.temperatura] }} /></div>
                          <p className="text-xs truncate max-w-[14rem] sm:max-w-[18rem]" style={{ color: "var(--text-3)" }}>{[fone(c.telefone), c.email].filter(Boolean).join(" · ") || "Sem contato"}</p>
                          <p className="sm:hidden mt-1 text-xs" style={{ color: c.corretor_nome ? "var(--text-2)" : "var(--warn)" }}>{c.corretor_nome || "Sem responsável"}</p>
                        </td>
                        <td className="py-3 pr-3 hidden md:table-cell whitespace-nowrap"><Selo tom={c.origem === "imoview" ? "info" : "neutro"}>{rotuloOrigem(c.origem)}</Selo></td>
                        <td className="py-3 pr-3 hidden sm:table-cell whitespace-nowrap">{c.corretor_nome ? <span style={{ color: "var(--text-2)" }}>{c.corretor_nome}</span> : <Selo tom="aviso">Sem responsável</Selo>}</td>
                        <td className="py-3 pr-4 hidden lg:table-cell text-xs tabular-nums" style={{ color: "var(--text-3)" }}>{data(c.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {dados && dados.total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13px]" style={{ borderTop: "1px solid var(--line)", color: "var(--text-3)" }}>
              <span className="tabular-nums">{n((dados.pagina - 1) * dados.por_pagina + 1)}–{n(Math.min(dados.pagina * dados.por_pagina, dados.total))} de {n(dados.total)}</span>
              <span className="flex items-center gap-1">
                <button type="button" onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={dados.pagina <= 1} aria-label="Página anterior" className="p-1.5 rounded-lg hover:bg-[var(--hover-solid)] disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
                <span className="px-2 tabular-nums">Página {n(dados.pagina)} de {n(dados.paginas)}</span>
                <button type="button" onClick={() => setPagina((p) => Math.min(dados.paginas, p + 1))} disabled={dados.pagina >= dados.paginas} aria-label="Próxima página" className="p-1.5 rounded-lg hover:bg-[var(--hover-solid)] disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
              </span>
            </div>
          )}
        </section>

        <aside ref={painel} aria-label="Detalhes do cliente" className="rounded-2xl p-5 xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
          {!aberto ? (
            <p className="text-sm" style={{ color: "var(--text-3)" }}>Selecione um cliente para ver a ficha completa: contato, cadastro do Imoview, perfil de busca, negócios, atividades e os imóveis que combinam com ele.</p>
          ) : (
            <FichaCliente
              clienteId={aberto.id} corretores={corretores} atribuindo={atribuindo} onAuthError={onAuthError}
              onFechar={() => setAberto(null)} onMudou={carregar}
              onAtribuir={(id, corretorId) => atribuir(false, [id], corretorId)}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
