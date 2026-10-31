"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarCheck, ChevronLeft, ChevronRight, CircleDollarSign, Clock, Columns3, FileText, Handshake, LineChart, List,
  MapPin, MessageCircle, Plus, Search, Settings2, ShieldCheck, Trophy, UserPlus, X, XCircle,
} from "lucide-react";
import { brl, COR_ETAPA, CorretorOpcao, corretoresAtivos, Etapa, Funil, FunilEtapa, Negocio } from "@/lib/crm";
import { fetchApi } from "@/lib/api";
import { Aviso, Botao, Entrada, Seletor, Selo, useApi } from "@/components/configuracoes/ui";

type Visao = "kanban" | "lista" | "previsao";
type Status = "aberto" | "ganho" | "perdido" | "todos";

const POR_COLUNA = 30;
const POR_LISTA = 25;
const ICONE_ETAPA: Record<string, React.ComponentType<{ className?: string }>> = {
  Lead: UserPlus, "Contato feito": MessageCircle, Qualificado: ShieldCheck, "Visita agendada": CalendarCheck,
  "Visita realizada": MapPin, Proposta: FileText, Negociação: Handshake,
};
const ORIGENS: Record<string, string> = { whatsapp: "WhatsApp", imoview: "Imoview", manual: "Manual", portal: "Portal", whatsapp_pessoal: "WhatsApp pessoal" };
const n = (v: number) => v.toLocaleString("pt-BR");
const fone = (t?: string | null) => {
  const d = (t || "").replace(/\D/g, "");
  const l = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (l.length === 11) return `(${l.slice(0, 2)}) ${l.slice(2, 7)}-${l.slice(7)}`;
  if (l.length === 10) return `(${l.slice(0, 2)}) ${l.slice(2, 6)}-${l.slice(6)}`;
  return t || "";
};

export default function Negociacoes({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const api = useApi(onAuthError);
  const [visao, setVisao] = useState<Visao>("kanban");
  const [funil, setFunil] = useState<Funil | null>(null);
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  const [corretores, setCorretores] = useState<CorretorOpcao[]>([]);
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [status, setStatus] = useState<Status>("aberto");
  const [corretor, setCorretor] = useState("");
  const [porValor, setPorValor] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<Negocio | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [maisCarregando, setMaisCarregando] = useState<string | null>(null);
  const [lista, setLista] = useState<{ itens: Negocio[]; total: number }>({ itens: [], total: 0 });
  const [pagina, setPagina] = useState(1);
  const [perdendo, setPerdendo] = useState<Negocio | null>(null);
  const [motivo, setMotivo] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [rascunho, setRascunho] = useState<Etapa[]>([]);
  const [novoOpen, setNovoOpen] = useState(false);
  const [novo, setNovo] = useState({ corretor_id: "", cliente: "", telefone: "", etapa: "", valor: "", fechamento: "" });
  const [novoErro, setNovoErro] = useState<string | null>(null);
  const requisicao = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => { setTermo(busca.trim()); setPagina(1); }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  useEffect(() => {
    (async () => setCorretores(await corretoresAtivos(fetchApi).catch(() => [])))();
  }, []);

  const consulta = useCallback((extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ status, ordem: porValor ? "valor" : "recentes", ...extra });
    if (termo) q.set("termo", termo);
    if (corretor) q.set("corretor", corretor);
    return q.toString();
  }, [status, porValor, termo, corretor]);

  const carregar = useCallback(async (silencioso = false) => {
    const minha = ++requisicao.current;
    if (!silencioso) setCarregando(true);
    const [rF, rE] = await Promise.all([
      api<Funil>(`/admin/crm/funil?${consulta({ por_coluna: String(POR_COLUNA) })}`),
      api<Etapa[]>("/admin/crm/etapas"),
    ]);
    if (minha !== requisicao.current) return;
    setCarregando(false);
    if (rF.ok && rF.dados) { setFunil(rF.dados); setErro(null); } else if (rF.erro) setErro(rF.erro);
    if (rE.ok && rE.dados) setEtapas(rE.dados);
  }, [api, consulta]);
  useEffect(() => { carregar(); }, [carregar]);

  const carregarLista = useCallback(async () => {
    const r = await api<{ itens: Negocio[]; total: number }>(`/admin/crm/funil/negocios?${consulta({ limite: String(POR_LISTA), deslocamento: String((pagina - 1) * POR_LISTA) })}`);
    if (r.ok && r.dados) setLista(r.dados);
  }, [api, consulta, pagina]);
  useEffect(() => { if (visao === "lista") carregarLista(); }, [visao, carregarLista]);

  const carregarMais = async (e: FunilEtapa) => {
    setMaisCarregando(e.etapa_id);
    const r = await api<{ itens: Negocio[]; total: number }>(`/admin/crm/funil/negocios?${consulta({ etapa_id: e.etapa_id, limite: String(POR_COLUNA), deslocamento: String(e.negocios.length) })}`);
    setMaisCarregando(null);
    if (!r.ok || !r.dados) return setErro(r.erro);
    const novos = r.dados.itens;
    setFunil((f) => f && { ...f, etapas: f.etapas.map((x) => x.etapa_id === e.etapa_id ? { ...x, negocios: [...x.negocios, ...novos.filter((nv) => !x.negocios.some((o) => o.id === nv.id))] } : x) });
  };

  const atualizar = async (negocio: Negocio, body: Record<string, unknown>) => {
    setErro(null);
    const r = await api(`/admin/crm/negocios/${negocio.id}`, { method: "PATCH", corpo: body });
    if (!r.ok) setErro(r.erro);
    await carregar(true);
    if (visao === "lista") carregarLista();
  };

  const moverPara = (negocio: Negocio, destino: FunilEtapa) => {
    if (destino.etapa_id === negocio.etapa_id) return;
    // atualiza o quadro na hora; a confirmação do servidor corrige qualquer diferença
    setFunil((f) => {
      if (!f) return f;
      const etapasNovas = f.etapas.map((x) => {
        if (x.etapa_id === negocio.etapa_id) return { ...x, negocios: x.negocios.filter((o) => o.id !== negocio.id), quantidade: x.quantidade - 1, total: x.total - negocio.valor, esperado: (x.total - negocio.valor) * x.probabilidade / 100 };
        if (x.etapa_id === destino.etapa_id) return { ...x, negocios: [{ ...negocio, etapa_id: x.etapa_id, etapa_nome: x.etapa, etapa_cor: x.cor, dias_na_etapa: 0, travado: false }, ...x.negocios], quantidade: x.quantidade + 1, total: x.total + negocio.valor, esperado: (x.total + negocio.valor) * x.probabilidade / 100 };
        return x;
      });
      return { ...f, etapas: etapasNovas };
    });
    atualizar(negocio, { etapa: destino.etapa });
  };

  const confirmarPerda = async () => {
    if (!perdendo || !motivo.trim()) return;
    await atualizar(perdendo, { status: "perdido", motivo_perda: motivo.trim() });
    setPerdendo(null); setMotivo("");
  };

  const salvarEtapas = async () => {
    const r = await api("/admin/crm/etapas", { method: "PUT", corpo: rascunho.map((e) => ({ id: e.id, probabilidade: e.probabilidade, alerta_dias: e.alerta_dias || null })) });
    if (!r.ok) return setErro(r.erro);
    setConfigOpen(false);
    carregar(true);
  };

  const criarNegocio = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setNovoErro(null);
    const r = await api("/admin/crm/negocios", {
      method: "POST",
      corpo: { corretor_id: novo.corretor_id, cliente: novo.cliente.trim(), telefone: novo.telefone.trim() || undefined, etapa: novo.etapa || undefined, valor: novo.valor ? Number(novo.valor) : 0, fechamento_previsto: novo.fechamento || undefined },
    });
    if (!r.ok) return setNovoErro(r.erro);
    setNovoOpen(false);
    carregar(true);
  };

  const abrirNovo = (etapa?: string) => {
    setNovoErro(null);
    setNovo({ corretor_id: corretores.length === 1 ? corretores[0].id : "", cliente: "", telefone: "", etapa: etapa ?? etapas[0]?.nome ?? "", valor: "", fechamento: "" });
    setNovoOpen(true);
  };

  const colunas = funil?.etapas ?? [];
  const totais = funil?.totais;
  const maxEtapa = Math.max(...colunas.map((e) => e.total), 1);
  const filtrando = !!(termo || corretor || status !== "aberto");
  const rotuloStatus = { aberto: ["negócio aberto", "negócios abertos"], ganho: ["negócio ganho", "negócios ganhos"], perdido: ["negócio perdido", "negócios perdidos"], todos: ["negócio", "negócios"] }[status];

  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}><Handshake className="w-5 h-5" aria-hidden /></span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--text)" }}>Vendas</h1>
            <p className="text-sm" style={{ color: "var(--text-3)" }}>
              {totais ? <>{colunas.length} etapas · {n(totais.quantidade)} {totais.quantidade === 1 ? rotuloStatus[0] : rotuloStatus[1]} · {brl(totais.total)} · previsão {brl(totais.esperado)}{totais.travados > 0 && <span style={{ color: "var(--warn)" }}> · {n(totais.travados)} parado{totais.travados > 1 ? "s" : ""}</span>}</> : "Carregando…"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Botao onClick={() => { setRascunho(etapas.map((e) => ({ ...e }))); setConfigOpen(true); }}><Settings2 className="w-4 h-4" aria-hidden /> Configurações</Botao>
          <Botao variante="primario" onClick={() => abrirNovo()}><Plus className="w-4 h-4" aria-hidden /> Novo negócio</Botao>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <label className="relative flex-1 min-w-[14rem] max-w-md">
          <span className="sr-only">Buscar negócio</span>
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-4)" }} aria-hidden />
          <Entrada type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, telefone ou título" className="!pl-10 !rounded-full" />
        </label>
        <Seletor aria-label="Situação" value={status} onChange={(e) => setStatus(e.target.value as Status)} className="!w-auto">
          <option value="aberto">Abertos</option><option value="ganho">Ganhos</option><option value="perdido">Perdidos</option><option value="todos">Todos</option>
        </Seletor>
        <Seletor aria-label="Corretor" value={corretor} onChange={(e) => setCorretor(e.target.value)} className="!w-auto">
          <option value="">Todos os corretores</option><option value="sem">Sem responsável</option>
          {corretores.map((c) => <option key={c.id} value={c.id}>{c.nome || c.telefone_mascarado}</option>)}
        </Seletor>
        <button type="button" onClick={() => setPorValor((v) => !v)} aria-pressed={porValor} className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm" style={{ border: "1px solid var(--line-2)", background: porValor ? "var(--accent-soft)" : "transparent", color: porValor ? "var(--accent-text)" : "var(--text-2)" }}>
          <CircleDollarSign className="w-4 h-4" aria-hidden /> Valor
        </button>
        <span className="flex-1" />
        <div className="flex rounded-full p-0.5" role="tablist" aria-label="Visão" style={{ border: "1px solid var(--line)", background: "var(--card)" }}>
          {([["kanban", "Kanban", Columns3], ["lista", "Lista", List], ["previsao", "Forecast", LineChart]] as const).map(([id, rotulo, Icon]) => (
            <button key={id} role="tab" aria-selected={visao === id} onClick={() => setVisao(id)} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm" style={{ background: visao === id ? "var(--card-2)" : "transparent", color: visao === id ? "var(--text)" : "var(--text-3)" }}>
              <Icon className="w-4 h-4" aria-hidden /> {rotulo}
              {id === "kanban" && totais && <span className="text-[11px] tabular-nums" style={{ color: "var(--text-4)" }}>{n(totais.quantidade)}</span>}
            </button>
          ))}
        </div>
      </div>

      {erro && <div className="mb-4"><Aviso tom="erro">{erro}</Aviso></div>}
      {totais && totais.quantidade === 0 && !carregando && (
        <p className="mb-4 text-sm" style={{ color: "var(--text-3)" }}>
          {filtrando ? "Nenhum negócio com esses filtros." : "Nenhum negócio ainda. Todo cliente novo entra aqui, na etapa Lead, automaticamente."}
        </p>
      )}

      {visao === "kanban" && (
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-1 px-1" aria-busy={carregando}>
          {!funil && carregando
            ? [0, 1, 2, 3].map((i) => <div key={i} className="w-72 shrink-0 h-64 rounded-2xl animate-pulse" style={{ background: "var(--card)" }} aria-hidden />)
            : colunas.map((c) => {
              const Icone = ICONE_ETAPA[c.etapa] ?? Columns3;
              const alvo = sobre === c.etapa_id && arrastando && arrastando.etapa_id !== c.etapa_id;
              const restantes = c.quantidade - c.negocios.length;
              return (
                <section
                  key={c.etapa_id}
                  aria-label={`Etapa ${c.etapa}`}
                  onDragOver={(e) => { e.preventDefault(); setSobre(c.etapa_id); }}
                  onDragLeave={() => setSobre((s) => (s === c.etapa_id ? null : s))}
                  onDrop={() => { if (arrastando) moverPara(arrastando, c); setArrastando(null); setSobre(null); }}
                  className="w-72 shrink-0 rounded-2xl p-3 flex flex-col gap-3 max-h-[calc(100vh-17rem)] min-h-[16rem]"
                  style={{ background: "var(--card)", border: `1px ${alvo ? "dashed" : "solid"} ${alvo ? "var(--accent)" : "var(--line)"}` }}
                >
                  <div className="px-1">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--card-2)", color: "var(--text-3)" }}><Icone className="w-4 h-4" aria-hidden /></span>
                      <h2 className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>{c.etapa}</h2>
                      <span className="text-xs tabular-nums" style={{ color: "var(--text-3)" }}>{n(c.quantidade)}</span>
                      <span className={`w-1.5 h-1.5 rounded-full ml-auto ${COR_ETAPA[c.cor] ?? "bg-slate-400"}`} aria-hidden />
                    </div>
                    <div className="flex justify-between text-[11px] mt-1.5 tabular-nums" style={{ color: "var(--text-3)" }}>
                      <span>{brl(c.total)}</span><span>{brl(c.esperado)} esp.</span>
                    </div>
                  </div>
                  <ul className="flex-1 overflow-y-auto space-y-2 pr-0.5">
                    {c.negocios.length === 0 && (
                      <li className="rounded-xl py-8 text-center text-xs" style={{ border: "1px dashed var(--line-2)", color: "var(--text-4)" }}>Arraste negócios aqui</li>
                    )}
                    {c.negocios.map((nv) => (
                      <li
                        key={nv.id}
                        draggable
                        onDragStart={() => setArrastando(nv)}
                        onDragEnd={() => { setArrastando(null); setSobre(null); }}
                        className="rounded-xl p-3 space-y-2 cursor-grab active:cursor-grabbing"
                        style={{ background: "var(--card-2)", border: `1px solid ${nv.travado ? "var(--warn)" : "var(--line)"}`, opacity: arrastando?.id === nv.id ? 0.4 : 1 }}
                      >
                        <div className="flex justify-between gap-2">
                          <span className="text-sm font-medium truncate" style={{ color: "var(--text)" }}>{nv.lead_nome}</span>
                          {nv.valor > 0 && <span className="text-xs font-semibold tabular-nums shrink-0" style={{ color: "var(--text-2)" }}>{brl(nv.valor)}</span>}
                        </div>
                        <p className="text-[11px] truncate" style={{ color: "var(--text-3)" }}>{[fone(nv.lead_telefone), nv.lead_email].filter(Boolean).join(" · ") || "Sem contato"}</p>
                        <div className="flex items-center justify-between gap-2 text-[11px]" style={{ color: "var(--text-3)" }}>
                          <span className="flex items-center gap-1.5 min-w-0">
                            {nv.lead_origem && <Selo tom={nv.lead_origem === "imoview" ? "info" : "neutro"}>{ORIGENS[nv.lead_origem] ?? nv.lead_origem}</Selo>}
                            <span className="truncate" style={{ color: nv.corretor_nome ? "var(--text-2)" : "var(--warn)" }}>{nv.corretor_nome ?? "Sem responsável"}</span>
                          </span>
                          <span className="flex items-center gap-1 shrink-0" style={{ color: nv.travado ? "var(--warn)" : undefined }}><Clock className="w-3 h-3" aria-hidden />{nv.dias_na_etapa}d</span>
                        </div>
                        {nv.imoview_fase ? <div><Selo tom="info">Imoview · fase {nv.imoview_fase}</Selo></div> : null}
                        {status === "aberto" && (
                          <div className="flex items-center gap-1 pt-0.5">
                            <Seletor aria-label={`Mover negócio de ${nv.lead_nome}`} value={nv.etapa_id} onChange={(e) => { const d = colunas.find((x) => x.etapa_id === e.target.value); if (d) moverPara(nv, d); }} className="!py-1 !text-[11px] !rounded-lg flex-1 min-w-0">
                              {colunas.map((x) => <option key={x.etapa_id} value={x.etapa_id}>{x.etapa}</option>)}
                            </Seletor>
                            <button type="button" title="Marcar como ganho" aria-label={`Ganhar negócio de ${nv.lead_nome}`} onClick={() => atualizar(nv, { status: "ganho" })} className="p-1.5 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--accent-text)" }}><Trophy className="w-4 h-4" /></button>
                            <button type="button" title="Marcar como perdido" aria-label={`Perder negócio de ${nv.lead_nome}`} onClick={() => setPerdendo(nv)} className="p-1.5 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--danger)" }}><XCircle className="w-4 h-4" /></button>
                          </div>
                        )}
                      </li>
                    ))}
                    {restantes > 0 && (
                      <li><button type="button" onClick={() => carregarMais(c)} disabled={maisCarregando === c.etapa_id} className="w-full py-2 text-xs rounded-lg hover:bg-[var(--hover-solid)] disabled:opacity-50" style={{ color: "var(--text-3)" }}>{maisCarregando === c.etapa_id ? "Carregando…" : `Carregar mais (${n(restantes)})`}</button></li>
                    )}
                  </ul>
                  <button type="button" onClick={() => abrirNovo(c.etapa)} className="flex items-center justify-center gap-2 py-2 text-sm rounded-xl hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}><Plus className="w-4 h-4" aria-hidden /> Adicionar negócio</button>
                </section>
              );
            })}
        </div>
      )}

      {visao === "lista" && (
        <section className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--line)" }} aria-label="Lista de negócios">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs" style={{ color: "var(--text-4)", borderBottom: "1px solid var(--line)" }}>
                  <th className="py-3 pl-4 pr-3 font-medium">Cliente</th>
                  <th className="py-3 pr-3 font-medium">Etapa</th>
                  <th className="py-3 pr-3 font-medium hidden md:table-cell">Corretor</th>
                  <th className="py-3 pr-3 font-medium text-right hidden sm:table-cell">Valor</th>
                  <th className="py-3 pr-4 font-medium text-right hidden lg:table-cell">Na etapa</th>
                </tr>
              </thead>
              <tbody>
                {lista.itens.map((nv) => (
                  <tr key={nv.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td className="py-3 pl-4 pr-3 min-w-0"><p className="font-medium truncate max-w-[14rem]" style={{ color: "var(--text)" }}>{nv.lead_nome}</p><p className="text-xs truncate max-w-[14rem]" style={{ color: "var(--text-3)" }}>{fone(nv.lead_telefone) || "Sem contato"}</p></td>
                    <td className="py-3 pr-3"><span className="inline-flex items-center gap-1.5" style={{ color: "var(--text-2)" }}><span className={`w-2 h-2 rounded-full ${COR_ETAPA[nv.etapa_cor] ?? "bg-slate-400"}`} aria-hidden />{nv.etapa_nome}</span></td>
                    <td className="py-3 pr-3 hidden md:table-cell">{nv.corretor_nome ? <span style={{ color: "var(--text-2)" }}>{nv.corretor_nome}</span> : <Selo tom="aviso">Sem responsável</Selo>}</td>
                    <td className="py-3 pr-3 text-right tabular-nums hidden sm:table-cell" style={{ color: "var(--text-2)" }}>{nv.valor > 0 ? brl(nv.valor) : "—"}</td>
                    <td className="py-3 pr-4 text-right tabular-nums hidden lg:table-cell" style={{ color: nv.travado ? "var(--warn)" : "var(--text-3)" }}>{nv.dias_na_etapa} dias</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lista.total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13px]" style={{ borderTop: "1px solid var(--line)", color: "var(--text-3)" }}>
              <span className="tabular-nums">{n((pagina - 1) * POR_LISTA + 1)}–{n(Math.min(pagina * POR_LISTA, lista.total))} de {n(lista.total)}</span>
              <span className="flex items-center gap-1">
                <button type="button" onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={pagina <= 1} aria-label="Página anterior" className="p-1.5 rounded-lg hover:bg-[var(--hover-solid)] disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
                <span className="px-2 tabular-nums">Página {n(pagina)} de {n(Math.max(1, Math.ceil(lista.total / POR_LISTA)))}</span>
                <button type="button" onClick={() => setPagina((p) => p + 1)} disabled={pagina * POR_LISTA >= lista.total} aria-label="Próxima página" className="p-1.5 rounded-lg hover:bg-[var(--hover-solid)] disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
              </span>
            </div>
          )}
        </section>
      )}

      {visao === "previsao" && totais && (
        <section className="rounded-2xl p-6 space-y-5" style={{ background: "var(--card)", border: "1px solid var(--line)" }} aria-label="Previsão">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Previsão ponderada</h2>
              <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>Receita esperada por etapa: valor × probabilidade.</p>
            </div>
            <div className="text-right"><p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-4)" }}>Total esperado</p><p className="text-2xl font-semibold tabular-nums" style={{ color: "var(--text)" }}>{brl(totais.esperado)}</p></div>
          </div>
          <ul className="space-y-4">
            {colunas.map((e) => (
              <li key={e.etapa_id}>
                <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-sm">
                  <span className="flex flex-wrap items-center gap-x-2" style={{ color: "var(--text-2)" }}>
                    <span className={`w-2 h-2 rounded-full ${COR_ETAPA[e.cor] ?? "bg-slate-400"}`} aria-hidden />{e.etapa}
                    <span className="text-xs tabular-nums" style={{ color: "var(--text-4)" }}>{n(e.quantidade)} · {e.probabilidade}%</span>
                    {e.travados > 0 && <span className="text-xs" style={{ color: "var(--warn)" }}>{n(e.travados)} parado{e.travados > 1 ? "s" : ""}</span>}
                  </span>
                  <span className="tabular-nums" style={{ color: "var(--text-2)" }}><strong>{brl(e.esperado)}</strong> <span style={{ color: "var(--text-4)" }}>/ {brl(e.total)}</span></span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--card-2)" }}><div className="h-full rounded-full" style={{ width: `${(e.total / maxEtapa) * 100}%`, background: "var(--accent)" }} /></div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {perdendo && (
        <Modal titulo={`Por que o negócio de ${perdendo.lead_nome} foi perdido?`} onFechar={() => setPerdendo(null)}>
          <Entrada autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && confirmarPerda()} placeholder="Ex.: preço, comprou com outro, desistiu" aria-label="Motivo da perda" />
          <div className="flex justify-end gap-2 pt-4"><Botao variante="fantasma" onClick={() => setPerdendo(null)}>Cancelar</Botao><Botao variante="perigo" onClick={confirmarPerda} disabled={!motivo.trim()}>Marcar como perdido</Botao></div>
        </Modal>
      )}

      {configOpen && (
        <Modal titulo="Etapas do funil" largo onFechar={() => setConfigOpen(false)} descricao="A probabilidade alimenta a previsão. Depois de quantos dias parado o negócio vira alerta no quadro e no briefing do corretor; deixe vazio para nunca alertar.">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs" style={{ color: "var(--text-4)" }}><th className="pb-2 font-medium">Etapa</th><th className="pb-2 font-medium">Probabilidade</th><th className="pb-2 font-medium">Alerta (dias)</th></tr></thead>
            <tbody>
              {rascunho.map((e, i) => (
                <tr key={e.id}>
                  <td className="py-1.5" style={{ color: "var(--text-2)" }}>{e.nome}</td>
                  <td className="py-1.5"><span className="inline-flex items-center gap-1"><Entrada type="number" min={0} max={100} aria-label={`Probabilidade de ${e.nome}`} value={e.probabilidade} onChange={(ev) => setRascunho(rascunho.map((r, j) => (j === i ? { ...r, probabilidade: Number(ev.target.value) } : r)))} className="!w-20 !py-1.5" /> %</span></td>
                  <td className="py-1.5"><Entrada type="number" min={1} aria-label={`Alerta de ${e.nome} em dias`} value={e.alerta_dias ?? ""} placeholder="nunca" onChange={(ev) => setRascunho(rascunho.map((r, j) => (j === i ? { ...r, alerta_dias: ev.target.value ? Number(ev.target.value) : null } : r)))} className="!w-20 !py-1.5" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end gap-2 pt-4"><Botao variante="fantasma" onClick={() => setConfigOpen(false)}>Cancelar</Botao><Botao variante="primario" onClick={salvarEtapas}>Salvar etapas</Botao></div>
        </Modal>
      )}

      {novoOpen && (
        <Modal titulo="Novo negócio" onFechar={() => setNovoOpen(false)} descricao="Se o cliente ainda não está na carteira do corretor, ele é criado.">
          <form onSubmit={criarNegocio} className="space-y-4">
            {novoErro && <Aviso tom="erro">{novoErro}</Aviso>}
            <Campo id="nn-corretor" rotulo="Corretor *"><Seletor id="nn-corretor" required value={novo.corretor_id} onChange={(e) => setNovo({ ...novo, corretor_id: e.target.value })}><option value="">Selecione</option>{corretores.map((c) => <option key={c.id} value={c.id}>{c.nome || c.telefone_mascarado}</option>)}</Seletor></Campo>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 sm:col-span-1"><Campo id="nn-cliente" rotulo="Cliente *"><Entrada id="nn-cliente" required minLength={2} value={novo.cliente} onChange={(e) => setNovo({ ...novo, cliente: e.target.value })} /></Campo></div>
              <div className="col-span-2 sm:col-span-1"><Campo id="nn-tel" rotulo="Telefone"><Entrada id="nn-tel" value={novo.telefone} onChange={(e) => setNovo({ ...novo, telefone: e.target.value })} placeholder="Se for cliente novo" /></Campo></div>
            </div>
            <Campo id="nn-etapa" rotulo="Etapa"><Seletor id="nn-etapa" value={novo.etapa} onChange={(e) => setNovo({ ...novo, etapa: e.target.value })}>{etapas.map((e) => <option key={e.id} value={e.nome}>{e.nome}</option>)}</Seletor></Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo id="nn-valor" rotulo="Valor (R$)"><Entrada id="nn-valor" type="number" min={0} step="1000" value={novo.valor} onChange={(e) => setNovo({ ...novo, valor: e.target.value })} /></Campo>
              <Campo id="nn-fech" rotulo="Fechamento previsto"><Entrada id="nn-fech" type="date" value={novo.fechamento} onChange={(e) => setNovo({ ...novo, fechamento: e.target.value })} /></Campo>
            </div>
            <div className="flex justify-end gap-2 pt-2"><Botao variante="fantasma" onClick={() => setNovoOpen(false)}>Cancelar</Botao><Botao variante="primario" type="submit" disabled={!novo.corretor_id || novo.cliente.trim().length < 2}>Criar negócio</Botao></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Campo({ id, rotulo, children }: { id: string; rotulo: string; children: React.ReactNode }) {
  return <div><label htmlFor={id} className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-3)" }}>{rotulo}</label>{children}</div>;
}

function Modal({ titulo, descricao, largo, onFechar, children }: { titulo: string; descricao?: string; largo?: boolean; onFechar: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onFechar]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgb(0 0 0 / .55)" }} role="dialog" aria-modal="true" aria-label={titulo} onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className={`w-full ${largo ? "max-w-lg" : "max-w-md"} max-h-[90vh] overflow-y-auto rounded-2xl p-6`} style={{ background: "var(--card)", border: "1px solid var(--line-2)" }}>
        <div className="flex justify-between items-start gap-3 mb-4">
          <div><h3 className="font-semibold" style={{ color: "var(--text)" }}>{titulo}</h3>{descricao && <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>{descricao}</p>}</div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="p-1 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
