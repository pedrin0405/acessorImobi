"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive, ArrowDown, ArrowUp, CalendarDays, Check, Clock, Download, FileText, Flag, GripVertical, Home, KeyRound, ListChecks, Mail,
  MapPin, MessageCircle, Pencil, Phone, Plus, Search, Star, Trash2, Users, X,
} from "lucide-react";
import { UFS } from "../constantes";
import { Aviso, Botao, Bloco, Cartao, Carregando, Entrada, Selo, Seletor, Titulo, Vazio, Interruptor, useApi } from "../ui";

/** Salva sozinho, meio segundo depois da última mudança, e mostra o estado. */
function useAutosave<T>(gravar: (valor: T) => Promise<string | null>) {
  const [estado, setEstado] = useState<"ocioso" | "salvando" | "salvo" | "erro">("ocioso");
  const [erro, setErro] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fn = useRef(gravar);
  fn.current = gravar;
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const agendar = useCallback((valor: T, imediato = false) => {
    if (timer.current) clearTimeout(timer.current);
    setEstado("salvando");
    timer.current = setTimeout(async () => {
      const e = await fn.current(valor);
      setErro(e); setEstado(e ? "erro" : "salvo");
    }, imediato ? 0 : 500);
  }, []);
  return { estado, erro, agendar };
}

function EstadoSalvar({ estado, erro }: { estado: string; erro: string | null }) {
  if (estado === "erro") return <span role="alert" className="text-[13px]" style={{ color: "var(--danger)" }}>{erro}</span>;
  if (estado === "salvando") return <span className="text-[13px]" style={{ color: "var(--text-4)" }}>Salvando…</span>;
  if (estado === "salvo") return <span role="status" className="inline-flex items-center gap-1 text-[13px]" style={{ color: "var(--accent-text)" }}><Check className="w-3.5 h-3.5" aria-hidden />Salvo</span>;
  return null;
}

/* ---------- Campos & Opções ---------- */

interface ItemLista { id: string; nome: string; cor: string; custo_mensal?: number }
interface Lista { chave: string; titulo: string; descricao: string; custo: boolean; itens: ItemLista[] }

export function CamposSecao({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const api = useApi(onAuthError);
  const [listas, setListas] = useState<Lista[] | null>(null);
  const [ativa, setAtiva] = useState("origem_lead");
  const [novo, setNovo] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [arrasto, setArrasto] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const { estado, erro: erroSalvar, agendar } = useAutosave<{ chave: string; itens: ItemLista[] }>(async ({ chave, itens }) => {
    const r = await api(`/admin/configuracoes/listas/${chave}`, { method: "PUT", corpo: { itens } });
    return r.ok ? null : r.erro;
  });

  useEffect(() => {
    (async () => {
      const r = await api<Lista[]>("/admin/configuracoes/listas");
      if (r.ok && r.dados) setListas(r.dados); else setErro(r.erro);
    })();
  }, [api]);

  if (!listas) return <><Titulo titulo="Campos & Opções" />{erro ? <Aviso tom="erro">{erro}</Aviso> : <Carregando />}</>;
  const lista = listas.find((l) => l.chave === ativa) || listas[0];

  const mudar = (itens: ItemLista[], imediato = false) => {
    setListas((ls) => (ls ? ls.map((l) => (l.chave === lista.chave ? { ...l, itens } : l)) : ls));
    agendar({ chave: lista.chave, itens }, imediato);
  };
  const mover = (de: number, para: number) => {
    if (para < 0 || para >= lista.itens.length || de === para) return;
    const c = [...lista.itens];
    const [x] = c.splice(de, 1);
    c.splice(para, 0, x);
    mudar(c, true);
  };
  const adicionar = () => {
    const nome = novo.trim();
    if (!nome) return;
    if (lista.itens.some((i) => i.nome.toLowerCase() === nome.toLowerCase())) return setErro(`"${nome}" já existe nesta lista.`);
    setErro(null);
    mudar([...lista.itens, { id: "", nome, cor: "#8A9597", ...(lista.custo ? { custo_mensal: 0 } : {}) }], true);
    setNovo("");
  };
  const alterar = (i: number, parte: Partial<ItemLista>) => mudar(lista.itens.map((x, j) => (j === i ? { ...x, ...parte } : x)));

  return (
    <>
      <Titulo titulo="Campos & Opções" descricao="As listas que viram escolha em leads, contatos e negócios. O que muda aqui vale para os próximos cadastros." />
      <div className="grid md:grid-cols-[220px_1fr] gap-6">
        <nav aria-label="Listas" className="md:sticky md:top-4 self-start">
          <ul className="flex md:block gap-1 overflow-x-auto pb-1">
            {listas.map((l) => {
              const sel = l.chave === lista.chave;
              return (
                <li key={l.chave} className="shrink-0">
                  <button type="button" onClick={() => { setAtiva(l.chave); setErro(null); setEditando(null); }} aria-current={sel ? "true" : undefined} className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-sm transition-colors hover:bg-[var(--hover-solid)]" style={{ background: sel ? "var(--hover-solid)" : undefined, color: sel ? "var(--text)" : "var(--text-2)", fontWeight: sel ? 600 : 400 }}>
                    <span className="whitespace-nowrap">{l.titulo}</span><span className="text-xs tabular-nums" style={{ color: "var(--text-4)" }}>{l.itens.length}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section aria-label={lista.titulo}>
          <div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-semibold" style={{ color: "var(--text)" }}>{lista.titulo}</h3><p className="mt-1 text-[13px] max-w-xl" style={{ color: "var(--text-3)" }}>{lista.descricao}</p></div><EstadoSalvar estado={estado} erro={erroSalvar} /></div>
          <div className="mt-4 flex gap-2">
            <Entrada aria-label={`Nova opção em ${lista.titulo}`} value={novo} onChange={(e) => setNovo(e.target.value)} placeholder={`Nova opção em ${lista.titulo}`} maxLength={60} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionar(); } }} />
            <Botao onClick={adicionar} disabled={!novo.trim()}><Plus className="w-4 h-4" aria-hidden /> Adicionar</Botao>
          </div>
          {erro && <p role="alert" className="mt-2 text-[13px]" style={{ color: "var(--danger)" }}>{erro}</p>}

          {lista.itens.length === 0 ? (
            <div className="mt-4 rounded-2xl" style={{ border: "1px dashed var(--line-2)" }}><Vazio icone={<Pencil className="w-5 h-5" aria-hidden />} titulo="Nenhuma opção ainda" texto="Adicione a primeira acima." /></div>
          ) : (
            <ul className="mt-4 rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
              {lista.itens.map((it, i) => (
                <li
                  key={it.id || `novo-${i}`}
                  draggable
                  onDragStart={() => setArrasto(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (arrasto !== null) mover(arrasto, i); setArrasto(null); }}
                  onDragEnd={() => setArrasto(null)}
                  className="flex items-center gap-2 px-3 py-2.5 group"
                  style={{ borderTop: i ? "1px solid var(--line)" : undefined, opacity: arrasto === i ? 0.5 : 1 }}
                >
                  <span className="cursor-grab p-1" style={{ color: "var(--text-4)" }} aria-hidden><GripVertical className="w-4 h-4" /></span>
                  <label className="relative w-5 h-5 shrink-0 rounded-full cursor-pointer" style={{ background: it.cor }} title="Mudar a cor">
                    <span className="sr-only">Cor de {it.nome}</span>
                    <input type="color" value={it.cor} onChange={(e) => alterar(i, { cor: e.target.value.toUpperCase() })} className="absolute inset-0 opacity-0 cursor-pointer" />
                  </label>
                  {editando === `${lista.chave}-${i}` ? (
                    <Entrada autoFocus aria-label={`Renomear ${it.nome}`} defaultValue={it.nome} maxLength={60} className="flex-1" onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== it.nome) alterar(i, { nome: v }); setEditando(null); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditando(null); }} />
                  ) : (
                    <button type="button" onClick={() => setEditando(`${lista.chave}-${i}`)} className="flex-1 min-w-0 text-left text-sm truncate hover:underline underline-offset-2" style={{ color: "var(--text)" }} title="Clique para renomear">{it.nome}</button>
                  )}
                  {lista.custo && (
                    <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-3)" }}>R$
                      <Entrada type="number" min={0} step={50} aria-label={`Custo mensal de ${it.nome}`} value={it.custo_mensal ?? 0} onChange={(e) => alterar(i, { custo_mensal: Number(e.target.value) })} className="!w-24 !py-1 text-right" />/mês
                    </label>
                  )}
                  <span className="flex items-center opacity-60 group-hover:opacity-100 focus-within:opacity-100">
                    <button type="button" aria-label={`Subir ${it.nome}`} disabled={i === 0} onClick={() => mover(i, i - 1)} className="p-1.5 rounded-md hover:bg-[var(--hover-solid)] disabled:opacity-30" style={{ color: "var(--text-3)" }}><ArrowUp className="w-3.5 h-3.5" /></button>
                    <button type="button" aria-label={`Descer ${it.nome}`} disabled={i === lista.itens.length - 1} onClick={() => mover(i, i + 1)} className="p-1.5 rounded-md hover:bg-[var(--hover-solid)] disabled:opacity-30" style={{ color: "var(--text-3)" }}><ArrowDown className="w-3.5 h-3.5" /></button>
                    <button type="button" aria-label={`Excluir ${it.nome}`} onClick={() => mudar(lista.itens.filter((_, j) => j !== i), true)} className="p-1.5 rounded-md hover:bg-[var(--hover-solid)]" style={{ color: "var(--danger)" }}><Trash2 className="w-3.5 h-3.5" /></button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {lista.custo && <p className="mt-3 text-xs" style={{ color: "var(--text-4)" }}>Custo mensal alimenta o custo por lead (CPL) e o retorno (ROI) dos relatórios.</p>}
        </section>
      </div>
    </>
  );
}

/* ---------- Localidades ---------- */

interface Cidade { id: string; nome: string; uf: string | null; arquivada: boolean; bairros: number }
interface Bairro { id: string; nome: string; arquivado: boolean }

export function LocalidadesSecao({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const api = useApi(onAuthError);
  const [cidades, setCidades] = useState<Cidade[] | null>(null);
  const [busca, setBusca] = useState("");
  const [arquivadas, setArquivadas] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [bairros, setBairros] = useState<Bairro[]>([]);
  const [novaCidade, setNovaCidade] = useState<{ nome: string; uf: string } | null>(null);
  const [novoBairro, setNovoBairro] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);

  const carregar = useCallback(async () => {
    const r = await api<Cidade[]>(`/admin/configuracoes/localidades/cidades?arquivadas=${arquivadas}${busca ? `&q=${encodeURIComponent(busca)}` : ""}`);
    if (r.ok && r.dados) setCidades(r.dados); else if (r.erro) setErro(r.erro);
  }, [api, arquivadas, busca]);
  useEffect(() => { const t = setTimeout(carregar, 200); return () => clearTimeout(t); }, [carregar]);

  const carregarBairros = useCallback(async (id: string) => {
    const r = await api<Bairro[]>(`/admin/configuracoes/localidades/cidades/${id}/bairros`);
    if (r.ok && r.dados) setBairros(r.dados);
  }, [api]);
  useEffect(() => { if (sel) carregarBairros(sel); else setBairros([]); }, [sel, carregarBairros]);

  const cidade = cidades?.find((c) => c.id === sel) || null;

  const criarCidade = async () => {
    if (!novaCidade?.nome.trim()) return;
    const r = await api<Cidade>("/admin/configuracoes/localidades/cidades", { method: "POST", corpo: { nome: novaCidade.nome, uf: novaCidade.uf || null } });
    if (!r.ok || !r.dados) return setErro(r.erro);
    setErro(null); setNovaCidade(null); await carregar(); setSel(r.dados.id);
  };
  const criarBairro = async () => {
    if (!sel || !novoBairro.trim()) return;
    const r = await api(`/admin/configuracoes/localidades/cidades/${sel}/bairros`, { method: "POST", corpo: { nome: novoBairro } });
    if (!r.ok) return setErro(r.erro);
    setErro(null); setNovoBairro(""); carregarBairros(sel); carregar();
  };
  const importar = async () => {
    setImportando(true); setErro(null); setInfo(null);
    const r = await api<{ cidades: number; bairros: number }>("/admin/configuracoes/localidades/importar", { method: "POST" });
    setImportando(false);
    if (!r.ok || !r.dados) return setErro(r.erro);
    setInfo(r.dados.cidades || r.dados.bairros ? `Importadas ${r.dados.cidades} cidades e ${r.dados.bairros} bairros dos imóveis do Imoview.` : "Nada novo para importar: os imóveis do Imoview já estão aqui.");
    carregar(); if (sel) carregarBairros(sel);
  };
  const marcar = async (c: Cidade, arquivada: boolean) => {
    const r = await api(`/admin/configuracoes/localidades/cidades/${c.id}`, { method: "PATCH", corpo: { arquivada } });
    if (!r.ok) return setErro(r.erro);
    if (sel === c.id) setSel(null);
    carregar();
  };
  const excluirCidade = async (c: Cidade) => {
    if (!confirm(`Excluir ${c.nome} e todos os bairros dela? Não dá para desfazer.`)) return;
    await api(`/admin/configuracoes/localidades/cidades/${c.id}`, { method: "DELETE" });
    if (sel === c.id) setSel(null);
    carregar();
  };

  return (
    <>
      <Titulo titulo="Localidades" descricao="Cidades e bairros de atuação. Usados em leads, negócios e imóveis."
        acao={<div className="flex flex-wrap gap-2"><Botao onClick={importar} carregando={importando}><Download className="w-4 h-4" aria-hidden /> Importar do Imoview</Botao><Botao onClick={() => setArquivadas((v) => !v)} aria-pressed={arquivadas}>{arquivadas ? "Ver ativas" : "Ver arquivadas"}</Botao><Botao variante="primario" onClick={() => setNovaCidade({ nome: "", uf: "" })}><Plus className="w-4 h-4" aria-hidden /> Nova cidade</Botao></div>} />
      {erro && <div className="mb-4"><Aviso tom="erro">{erro}</Aviso></div>}
      {info && <div className="mb-4"><Aviso tom="ok">{info}</Aviso></div>}

      <div className="grid md:grid-cols-[320px_1fr] gap-4">
        <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
          <div className="p-3" style={{ borderBottom: "1px solid var(--line)" }}>
            <label className="relative block"><span className="sr-only">Buscar cidade</span><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-4)" }} aria-hidden /><Entrada type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cidade…" className="!pl-9" /></label>
          </div>
          {novaCidade && (
            <div className="assist-fade p-3 space-y-2" style={{ borderBottom: "1px solid var(--line)", background: "var(--card-2)" }}>
              <Entrada autoFocus aria-label="Nome da cidade" placeholder="Nome da cidade" value={novaCidade.nome} onChange={(e) => setNovaCidade({ ...novaCidade, nome: e.target.value })} maxLength={120} onKeyDown={(e) => { if (e.key === "Enter") criarCidade(); if (e.key === "Escape") setNovaCidade(null); }} />
              <div className="flex gap-2"><Seletor aria-label="UF" value={novaCidade.uf} onChange={(e) => setNovaCidade({ ...novaCidade, uf: e.target.value })} className="!w-24"><option value="">UF</option>{UFS.map((u) => <option key={u}>{u}</option>)}</Seletor><Botao variante="primario" onClick={criarCidade} disabled={!novaCidade.nome.trim()} className="flex-1">Criar</Botao><Botao variante="fantasma" onClick={() => setNovaCidade(null)}>Cancelar</Botao></div>
            </div>
          )}
          <div className="max-h-[28rem] overflow-y-auto">
            {!cidades ? <div className="p-3"><Carregando linhas={3} /></div> : cidades.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px]" style={{ color: "var(--text-3)" }}>{arquivadas ? "Nenhuma cidade arquivada." : "Nenhuma cidade. Clique em “Nova cidade” ou importe do Imoview."}</p>
            ) : (
              <ul>
                {cidades.map((c) => (
                  <li key={c.id} className="group" style={{ borderTop: "1px solid var(--line)" }}>
                    <button type="button" onClick={() => setSel(c.id)} aria-current={sel === c.id ? "true" : undefined} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--hover-solid)]" style={{ background: sel === c.id ? "var(--hover-solid)" : undefined }}>
                      <span className="min-w-0"><span className="block text-sm truncate" style={{ color: "var(--text)" }}>{c.nome}{c.uf ? ` · ${c.uf}` : ""}</span><span className="block text-xs" style={{ color: "var(--text-4)" }}>{c.bairros} {c.bairros === 1 ? "bairro" : "bairros"}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="rounded-2xl min-h-[16rem]" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
          {!cidade ? (
            <Vazio icone={<MapPin className="w-6 h-6" aria-hidden />} titulo="Selecione uma cidade" texto="Os bairros vinculados aparecerão aqui." />
          ) : (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: "1px solid var(--line)" }}>
                <div><h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>{cidade.nome}{cidade.uf ? ` · ${cidade.uf}` : ""}</h3><p className="text-xs" style={{ color: "var(--text-3)" }}>{bairros.length} {bairros.length === 1 ? "bairro" : "bairros"}</p></div>
                <div className="flex gap-1">
                  <Botao variante="fantasma" onClick={() => marcar(cidade, !cidade.arquivada)}><Archive className="w-4 h-4" aria-hidden /> {cidade.arquivada ? "Reativar" : "Arquivar"}</Botao>
                  <Botao variante="fantasma" onClick={() => excluirCidade(cidade)} style={{ color: "var(--danger)" }}><Trash2 className="w-4 h-4" aria-hidden /> Excluir</Botao>
                </div>
              </div>
              <div className="p-4 flex gap-2"><Entrada aria-label="Novo bairro" placeholder="Novo bairro" value={novoBairro} onChange={(e) => setNovoBairro(e.target.value)} maxLength={120} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); criarBairro(); } }} /><Botao onClick={criarBairro} disabled={!novoBairro.trim()}><Plus className="w-4 h-4" aria-hidden /> Adicionar</Botao></div>
              {bairros.length === 0 ? <p className="px-5 pb-8 text-center text-[13px]" style={{ color: "var(--text-3)" }}>Nenhum bairro nesta cidade ainda.</p> : (
                <ul className="px-2 pb-3">
                  {bairros.map((b) => (
                    <li key={b.id} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--hover-solid)] group">
                      <span className="flex-1 min-w-0 text-sm truncate" style={{ color: b.arquivado ? "var(--text-4)" : "var(--text)", textDecoration: b.arquivado ? "line-through" : undefined }}>{b.nome}</span>
                      <button type="button" onClick={async () => { await api(`/admin/configuracoes/localidades/bairros/${b.id}`, { method: "PATCH", corpo: { arquivado: !b.arquivado } }); carregarBairros(cidade.id); }} aria-label={`${b.arquivado ? "Reativar" : "Arquivar"} ${b.nome}`} className="p-1.5 rounded-md opacity-60 group-hover:opacity-100 hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}><Archive className="w-3.5 h-3.5" /></button>
                      <button type="button" onClick={async () => { await api(`/admin/configuracoes/localidades/bairros/${b.id}`, { method: "DELETE" }); carregarBairros(cidade.id); carregar(); }} aria-label={`Excluir ${b.nome}`} className="p-1.5 rounded-md opacity-60 group-hover:opacity-100 hover:bg-[var(--hover-solid)]" style={{ color: "var(--danger)" }}><Trash2 className="w-3.5 h-3.5" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ---------- Tipos de atividade ---------- */

export const ICONES_ATIVIDADE: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  calendar: CalendarDays, users: Users, phone: Phone, clock: Clock, message: MessageCircle, list: ListChecks, mail: Mail, file: FileText, home: Home, key: KeyRound, star: Star, flag: Flag,
};

interface TipoAtividade { chave: string; nome: string; icone: string; cor: string; visivel: boolean; sistema: boolean; atividades?: number }

export function TiposSecao({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const api = useApi(onAuthError);
  const [tipos, setTipos] = useState<TipoAtividade[] | null>(null);
  const [editando, setEditando] = useState<TipoAtividade | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const r = await api<TipoAtividade[]>("/admin/configuracoes/tipos-atividade");
      if (r.ok && r.dados) setTipos(r.dados); else setErro(r.erro);
    })();
  }, [api]);

  const gravar = async (proximos: TipoAtividade[]): Promise<boolean> => {
    const r = await api<TipoAtividade[]>("/admin/configuracoes/tipos-atividade", { method: "PUT", corpo: { itens: proximos } });
    if (!r.ok || !r.dados) { setErro(r.erro); return false; }
    setErro(null); setTipos(r.dados);
    return true;
  };

  if (!tipos) return <><Titulo titulo="Tipos de atividade" />{erro ? <Aviso tom="erro">{erro}</Aviso> : <Carregando />}</>;
  const mover = (i: number, d: number) => {
    const c = [...tipos]; const j = i + d;
    if (j < 0 || j >= c.length) return;
    [c[i], c[j]] = [c[j], c[i]];
    gravar(c);
  };
  const salvarEdicao = async () => {
    if (!editando) return;
    const existe = tipos.some((t) => t.chave === editando.chave && editando.chave);
    const lista = existe ? tipos.map((t) => (t.chave === editando.chave ? editando : t)) : [...tipos, editando];
    if (await gravar(lista)) setEditando(null);
  };

  return (
    <>
      <Titulo titulo="Tipos de atividade" descricao="O vocabulário da agenda: cada tipo tem nome, ícone e cor próprios, e é por ele que o Acessor avisa o corretor e a grade se colore."
        acao={<Botao variante="primario" onClick={() => setEditando({ chave: "", nome: "", icone: "list", cor: "#8A9597", visivel: true, sistema: false })}><Plus className="w-4 h-4" aria-hidden /> Novo tipo</Botao>} />
      {erro && <div className="mb-4"><Aviso tom="erro">{erro}</Aviso></div>}

      {editando && (
        <div className="assist-fade mb-5 rounded-2xl p-5 space-y-4" style={{ background: "var(--card)", border: "1px solid var(--accent)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{editando.chave ? "Editar tipo" : "Novo tipo"}</p>
          <div className="grid sm:grid-cols-[1fr_auto] gap-4 items-end">
            <div><label htmlFor="t-nome" className="text-xs" style={{ color: "var(--text-3)" }}>Nome</label><Entrada id="t-nome" autoFocus value={editando.nome} maxLength={40} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-3)" }}>Cor<input type="color" value={editando.cor} onChange={(e) => setEditando({ ...editando, cor: e.target.value.toUpperCase() })} className="w-10 h-9 rounded-md border cursor-pointer" style={{ borderColor: "var(--line-2)", background: "transparent" }} aria-label="Cor do tipo" /></label>
          </div>
          <div role="radiogroup" aria-label="Ícone" className="flex flex-wrap gap-2">
            {Object.entries(ICONES_ATIVIDADE).map(([k, Icone]) => (
              <button key={k} type="button" role="radio" aria-checked={editando.icone === k} aria-label={k} onClick={() => setEditando({ ...editando, icone: k })} className="w-10 h-10 rounded-xl border flex items-center justify-center" style={{ background: editando.icone === k ? "var(--accent-soft)" : "var(--card-2)", borderColor: editando.icone === k ? "var(--accent)" : "var(--line)", color: editando.cor }}><Icone className="w-[18px] h-[18px]" /></button>
            ))}
          </div>
          <div className="flex justify-end gap-2"><Botao variante="fantasma" onClick={() => setEditando(null)}>Cancelar</Botao><Botao variante="primario" onClick={salvarEdicao} disabled={!editando.nome.trim()}>Salvar tipo</Botao></div>
        </div>
      )}

      <ul className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
        {tipos.map((t, i) => {
          const Icone = ICONES_ATIVIDADE[t.icone] || ListChecks;
          return (
            <li key={t.chave} className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderTop: i ? "1px solid var(--line)" : undefined, opacity: t.visivel ? 1 : 0.6 }}>
              <span className="flex flex-col">
                <button type="button" aria-label={`Subir ${t.nome}`} disabled={i === 0} onClick={() => mover(i, -1)} className="p-0.5 rounded hover:bg-[var(--hover-solid)] disabled:opacity-25" style={{ color: "var(--text-3)" }}><ArrowUp className="w-3.5 h-3.5" /></button>
                <button type="button" aria-label={`Descer ${t.nome}`} disabled={i === tipos.length - 1} onClick={() => mover(i, 1)} className="p-0.5 rounded hover:bg-[var(--hover-solid)] disabled:opacity-25" style={{ color: "var(--text-3)" }}><ArrowDown className="w-3.5 h-3.5" /></button>
              </span>
              <span className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center" style={{ background: `color-mix(in srgb, ${t.cor} 18%, transparent)`, color: t.cor }}><Icone className="w-[18px] h-[18px]" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium flex items-center gap-2" style={{ color: "var(--text)" }}>{t.nome}{t.sistema && <Selo>Sistema</Selo>}</p>
                <p className="text-xs" style={{ color: "var(--text-4)" }}>{t.atividades ? `${t.atividades} ${t.atividades === 1 ? "atividade usa" : "atividades usam"}` : "Nenhuma atividade usa"} · <span className="font-mono">{t.chave}</span></p>
              </div>
              <Interruptor ligado={t.visivel} onChange={(v) => gravar(tipos.map((x) => (x.chave === t.chave ? { ...x, visivel: v } : x)))} rotulo={`${t.nome} visível`} />
              <Botao variante="fantasma" onClick={() => setEditando(t)}><Pencil className="w-4 h-4" aria-hidden /> Editar</Botao>
              <button type="button" aria-label={t.sistema ? `${t.nome} é um tipo do sistema e não pode ser excluído` : `Excluir ${t.nome}`} disabled={t.sistema} onClick={() => { if (confirm(`Excluir o tipo ${t.nome}?`)) gravar(tipos.filter((x) => x.chave !== t.chave)); }} className="p-2 rounded-lg hover:bg-[var(--hover-solid)] disabled:opacity-30 disabled:cursor-not-allowed" style={{ color: "var(--danger)" }}><Trash2 className="w-4 h-4" /></button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs max-w-2xl" style={{ color: "var(--text-4)" }}>Esconder um tipo tira ele do menu de criação e dos filtros, sem mexer nas atividades que já existem. Os oito originais não podem ser excluídos porque o histórico aponta para eles.</p>
    </>
  );
}
