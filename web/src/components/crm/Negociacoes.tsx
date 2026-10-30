"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Columns3, List, LineChart, Settings2, RefreshCw, Clock, Trophy, XCircle, X, Plus } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { brl, COR_ETAPA, CorretorOpcao, corretoresAtivos, Etapa, Forecast, Negocio } from "@/lib/crm";

type Visao = "kanban" | "lista" | "previsao";

export default function Negociacoes({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const [visao, setVisao] = useState<Visao>("kanban");
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [termo, setTermo] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [perdendo, setPerdendo] = useState<Negocio | null>(null);
  const [motivo, setMotivo] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [rascunho, setRascunho] = useState<Etapa[]>([]);
  const [novoOpen, setNovoOpen] = useState(false);
  const [corretores, setCorretores] = useState<CorretorOpcao[]>([]);
  const [novo, setNovo] = useState({ corretor_id: "", cliente: "", telefone: "", etapa: "", valor: "", fechamento: "" });
  const [novoErro, setNovoErro] = useState<string | null>(null);

  const carregar = async () => {
    setLoading(true);
    setErro(null);
    try {
      const busca = termo.trim() ? `&termo=${encodeURIComponent(termo.trim())}` : "";
      const [rE, rN, rF] = await Promise.all([
        fetchApi("/admin/crm/etapas"),
        fetchApi(`/admin/crm/negocios?status=aberto${busca}`),
        fetchApi("/admin/crm/forecast"),
      ]);
      if (!rE.ok || !rN.ok || !rF.ok) throw new Error("falha");
      setEtapas(await rE.json());
      setNegocios(await rN.json());
      setForecast(await rF.json());
    } catch (e) {
      if (!onAuthError(e)) setErro("Não foi possível carregar o funil.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const atualizar = async (negocio: Negocio, body: Record<string, unknown>) => {
    setErro(null);
    try {
      const res = await fetchApi(`/admin/crm/negocios/${negocio.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErro(typeof data.detail === "string" ? data.detail : "Não foi possível atualizar o negócio.");
        return;
      }
      await carregar();
    } catch (e) {
      if (!onAuthError(e)) setErro("Falha na comunicação com a API.");
    }
  };

  const moverPara = (negocio: Negocio, etapaNome: string) => {
    if (etapaNome !== negocio.etapa_nome) atualizar(negocio, { etapa: etapaNome });
  };

  const confirmarPerda = async () => {
    if (!perdendo || !motivo.trim()) return;
    await atualizar(perdendo, { status: "perdido", motivo_perda: motivo.trim() });
    setPerdendo(null);
    setMotivo("");
  };

  const salvarEtapas = async () => {
    try {
      const res = await fetchApi("/admin/crm/etapas", {
        method: "PUT",
        body: JSON.stringify(
          rascunho.map((e) => ({ id: e.id, probabilidade: e.probabilidade, alerta_dias: e.alerta_dias || null }))
        ),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErro(typeof data.detail === "string" ? data.detail : "Valores inválidos nas etapas.");
        return;
      }
      setConfigOpen(false);
      await carregar();
    } catch (e) {
      if (!onAuthError(e)) setErro("Falha ao salvar as etapas.");
    }
  };

  const abrirNovo = async () => {
    setNovoErro(null);
    setNovo({ corretor_id: "", cliente: "", telefone: "", etapa: etapas[0]?.nome ?? "", valor: "", fechamento: "" });
    setNovoOpen(true);
    try {
      const lista = await corretoresAtivos(fetchApi);
      setCorretores(lista);
      if (lista.length === 1) setNovo((n) => ({ ...n, corretor_id: lista[0].id }));
    } catch (e) {
      if (!onAuthError(e)) setNovoErro("Não foi possível carregar os corretores.");
    }
  };

  const criarNegocio = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setNovoErro(null);
    try {
      const res = await fetchApi("/admin/crm/negocios", {
        method: "POST",
        body: JSON.stringify({
          corretor_id: novo.corretor_id,
          cliente: novo.cliente.trim(),
          telefone: novo.telefone.trim() || undefined,
          etapa: novo.etapa || undefined,
          valor: novo.valor ? Number(novo.valor) : 0,
          fechamento_previsto: novo.fechamento || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const detalhe = Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail;
        setNovoErro(detalhe || "Não foi possível criar o negócio.");
        return;
      }
      setNovoOpen(false);
      await carregar();
    } catch (e) {
      if (!onAuthError(e)) setNovoErro("Falha na comunicação com a API.");
    }
  };

  const porEtapa = useMemo(() => {
    const mapa: Record<string, Negocio[]> = {};
    etapas.forEach((e) => (mapa[e.id] = []));
    negocios.forEach((n) => (mapa[n.etapa_id] ??= []).push(n));
    return mapa;
  }, [etapas, negocios]);

  const travados = negocios.filter((n) => n.travado).length;
  const maxEtapa = Math.max(...(forecast?.etapas.map((e) => e.total) ?? [0]), 1);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Cabeçalho */}
      <div className="p-6 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold text-slate-900">Negociações</h2>
          <p className="text-xs text-slate-500 mt-1">
            {negocios.length} {negocios.length === 1 ? "negócio aberto" : "negócios abertos"} ·{" "}
            {brl(forecast?.total ?? 0)} no funil · previsão {brl(forecast?.esperado ?? 0)}
            {travados > 0 && <span className="text-amber-600"> · {travados} parado(s)</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              carregar();
            }}
          >
            <input
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Buscar cliente"
              aria-label="Buscar negócio por cliente"
              className="w-44 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-slate-900"
            />
          </form>
          <div className="flex rounded-lg border border-slate-200 p-0.5" role="tablist" aria-label="Visão">
            {(
              [
                ["kanban", "Kanban", Columns3],
                ["lista", "Lista", List],
                ["previsao", "Previsão", LineChart],
              ] as const
            ).map(([id, rotulo, Icon]) => (
              <button
                key={id}
                role="tab"
                aria-selected={visao === id}
                onClick={() => setVisao(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${
                  visao === id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {rotulo}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              setRascunho(etapas.map((e) => ({ ...e })));
              setConfigOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <Settings2 className="w-3.5 h-3.5" /> Etapas
          </button>
          <button onClick={carregar} title="Atualizar" className="p-2 text-slate-400 hover:text-slate-600">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={abrirNovo}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium"
          >
            <Plus className="w-3.5 h-3.5" /> Novo negócio
          </button>
        </div>
      </div>

      {erro && (
        <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">{erro}</div>
      )}

      {negocios.length === 0 && !loading && (
        <div className="px-6 pt-6 text-sm text-slate-500">
          Nenhum negócio aberto ainda. Os corretores abrem negócios pelo WhatsApp, por exemplo:{" "}
          <em>&ldquo;abre um negócio pra Ana, apartamento de 900 mil, já em proposta&rdquo;</em>.
        </div>
      )}

      {/* Kanban */}
      {visao === "kanban" && (
        <div className="p-6 flex gap-4 overflow-x-auto">
          {etapas.map((etapa) => {
            const itens = porEtapa[etapa.id] ?? [];
            const total = itens.reduce((s, n) => s + n.valor, 0);
            return (
              <div
                key={etapa.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  const negocio = negocios.find((n) => n.id === arrastando);
                  if (negocio) moverPara(negocio, etapa.nome);
                  setArrastando(null);
                }}
                className={`w-64 shrink-0 rounded-xl border p-3 space-y-3 ${
                  arrastando ? "border-dashed border-slate-300 bg-slate-50" : "border-slate-200 bg-slate-50/60"
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${COR_ETAPA[etapa.cor] ?? "bg-slate-400"}`} />
                    <span className="text-sm font-semibold text-slate-800">{etapa.nome}</span>
                    <span className="text-xs text-slate-400">{itens.length}</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-500 mt-1">
                    <span>{brl(total)}</span>
                    <span>{etapa.probabilidade}% · {brl((total * etapa.probabilidade) / 100)} esp.</span>
                  </div>
                </div>
                {itens.map((n) => (
                  <div
                    key={n.id}
                    draggable
                    onDragStart={() => setArrastando(n.id)}
                    onDragEnd={() => setArrastando(null)}
                    className={`bg-white rounded-lg border p-3 space-y-2 cursor-grab active:cursor-grabbing ${
                      n.travado ? "border-amber-300" : "border-slate-200"
                    }`}
                  >
                    <div className="flex justify-between gap-2">
                      <span className="text-sm font-medium text-slate-900 truncate">{n.lead_nome}</span>
                      <span className="text-xs font-semibold text-slate-700">{brl(n.valor)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span className="truncate">{n.corretor_nome ?? "—"}</span>
                      <span className={`flex items-center gap-1 ${n.travado ? "text-amber-600 font-medium" : ""}`}>
                        <Clock className="w-3 h-3" /> {n.dias_na_etapa}d
                      </span>
                    </div>
                    <div className="flex items-center gap-1 pt-1">
                      <select
                        aria-label={`Mover negócio de ${n.lead_nome}`}
                        value={n.etapa_nome}
                        onChange={(e) => moverPara(n, e.target.value)}
                        className="flex-1 min-w-0 text-[11px] border border-slate-200 rounded-md px-1.5 py-1 bg-white"
                      >
                        {etapas.map((e) => (
                          <option key={e.id} value={e.nome}>
                            {e.nome}
                          </option>
                        ))}
                      </select>
                      <button
                        title="Marcar como ganho"
                        onClick={() => atualizar(n, { status: "ganho" })}
                        className="p-1 rounded-md text-emerald-600 hover:bg-emerald-50"
                      >
                        <Trophy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        title="Marcar como perdido"
                        onClick={() => setPerdendo(n)}
                        className="p-1 rounded-md text-rose-500 hover:bg-rose-50"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Lista */}
      {visao === "lista" && (
        <div className="p-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="pb-2 font-medium">Cliente</th>
                <th className="pb-2 font-medium">Corretor</th>
                <th className="pb-2 font-medium">Etapa</th>
                <th className="pb-2 font-medium text-right">Valor</th>
                <th className="pb-2 font-medium text-right">Prob.</th>
                <th className="pb-2 font-medium text-right">Esperado</th>
                <th className="pb-2 font-medium text-right">Na etapa</th>
                <th className="pb-2 font-medium">Fechamento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {negocios.map((n) => (
                <tr key={n.id} className="text-slate-700">
                  <td className="py-2.5 font-medium text-slate-900">{n.lead_nome}</td>
                  <td className="py-2.5">{n.corretor_nome ?? "—"}</td>
                  <td className="py-2.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${COR_ETAPA[n.etapa_cor] ?? "bg-slate-400"}`} />
                      {n.etapa_nome}
                    </span>
                  </td>
                  <td className="py-2.5 text-right">{brl(n.valor)}</td>
                  <td className="py-2.5 text-right">{n.probabilidade}%</td>
                  <td className="py-2.5 text-right font-medium">{brl(n.esperado)}</td>
                  <td className={`py-2.5 text-right ${n.travado ? "text-amber-600 font-medium" : ""}`}>
                    {n.dias_na_etapa} dias
                  </td>
                  <td className="py-2.5 text-slate-500">
                    {n.fechamento_previsto
                      ? new Date(n.fechamento_previsto + "T12:00:00").toLocaleDateString("pt-BR")
                      : "Sem data"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Previsão */}
      {visao === "previsao" && forecast && (
        <div className="p-6 space-y-4">
          <div className="flex items-end justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Previsão ponderada</h3>
              <p className="text-xs text-slate-500">Receita esperada por etapa: valor × probabilidade.</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Total esperado</p>
              <p className="text-2xl font-bold text-slate-900">{brl(forecast.esperado)}</p>
            </div>
          </div>
          <div className="space-y-3">
            {forecast.etapas.map((e) => (
              <div key={e.etapa_id}>
                <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-sm">
                  <span className="flex flex-wrap items-center gap-x-2 text-slate-700">
                    <span className={`w-2 h-2 rounded-full ${COR_ETAPA[e.cor] ?? "bg-slate-400"}`} />
                    {e.etapa}
                    <span className="text-xs text-slate-400">
                      {e.quantidade} · {e.probabilidade}%
                    </span>
                    {e.travados > 0 && <span className="text-xs text-amber-600">{e.travados} parado(s)</span>}
                  </span>
                  <span className="text-slate-700">
                    <strong>{brl(e.esperado)}</strong> <span className="text-slate-400">/ {brl(e.total)}</span>
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-slate-900 rounded-full" style={{ width: `${(e.total / maxEtapa) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal: motivo da perda */}
      {perdendo && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-xl">
            <h3 className="font-semibold text-slate-900">Por que o negócio de {perdendo.lead_nome} foi perdido?</h3>
            <input
              autoFocus
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmarPerda()}
              placeholder="Ex.: preço, comprou com outro, desistiu"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setPerdendo(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                Cancelar
              </button>
              <button
                onClick={confirmarPerda}
                disabled={!motivo.trim()}
                className="px-4 py-2 text-sm font-medium bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-lg"
              >
                Marcar como perdido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: configurar etapas */}
      {configOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-semibold text-slate-900">Etapas do funil</h3>
                <p className="text-xs text-slate-500 mt-1">
                  A probabilidade alimenta a previsão. Depois de quantos dias parado o negócio vira alerta no
                  quadro e no briefing do corretor; deixe vazio para nunca alertar.
                </p>
              </div>
              <button onClick={() => setConfigOpen(false)} aria-label="Fechar" className="p-1 text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="pb-2 font-medium">Etapa</th>
                  <th className="pb-2 font-medium">Probabilidade</th>
                  <th className="pb-2 font-medium">Alerta (dias)</th>
                </tr>
              </thead>
              <tbody>
                {rascunho.map((e, i) => (
                  <tr key={e.id}>
                    <td className="py-1.5 text-slate-700">{e.nome}</td>
                    <td className="py-1.5">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        aria-label={`Probabilidade de ${e.nome}`}
                        value={e.probabilidade}
                        onChange={(ev) =>
                          setRascunho(rascunho.map((r, j) => (j === i ? { ...r, probabilidade: Number(ev.target.value) } : r)))
                        }
                        className="w-20 px-2 py-1 border border-slate-200 rounded-md text-sm"
                      />{" "}
                      %
                    </td>
                    <td className="py-1.5">
                      <input
                        type="number"
                        min={1}
                        aria-label={`Alerta de ${e.nome} em dias`}
                        value={e.alerta_dias ?? ""}
                        placeholder="nunca"
                        onChange={(ev) =>
                          setRascunho(
                            rascunho.map((r, j) =>
                              j === i ? { ...r, alerta_dias: ev.target.value ? Number(ev.target.value) : null } : r
                            )
                          )
                        }
                        className="w-20 px-2 py-1 border border-slate-200 rounded-md text-sm"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfigOpen(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                Cancelar
              </button>
              <button onClick={salvarEtapas} className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg">
                Salvar etapas
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: novo negócio */}
      {novoOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
          <form onSubmit={criarNegocio} className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-semibold text-slate-900">Novo negócio</h3>
                <p className="text-xs text-slate-500 mt-1">Se o cliente ainda não está na carteira do corretor, ele é criado.</p>
              </div>
              <button type="button" onClick={() => setNovoOpen(false)} aria-label="Fechar" className="p-1 text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            {novoErro && <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm">{novoErro}</div>}
            <div>
              <label htmlFor="nn-corretor" className="block text-xs font-medium text-slate-600 mb-1">Corretor *</label>
              <select id="nn-corretor" required value={novo.corretor_id} onChange={(e) => setNovo({ ...novo, corretor_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900 bg-white">
                <option value="">Selecione</option>
                {corretores.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome || c.telefone_mascarado}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 sm:col-span-1">
                <label htmlFor="nn-cliente" className="block text-xs font-medium text-slate-600 mb-1">Cliente *</label>
                <input id="nn-cliente" required minLength={2} value={novo.cliente} onChange={(e) => setNovo({ ...novo, cliente: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900" />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label htmlFor="nn-tel" className="block text-xs font-medium text-slate-600 mb-1">Telefone</label>
                <input id="nn-tel" value={novo.telefone} onChange={(e) => setNovo({ ...novo, telefone: e.target.value })} placeholder="Se for cliente novo" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900" />
              </div>
            </div>
            <div>
              <span className="block text-xs font-medium text-slate-600 mb-1">Etapa</span>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Etapa">
                {etapas.map((e) => (
                  <button
                    type="button"
                    key={e.id}
                    role="radio"
                    aria-checked={novo.etapa === e.nome}
                    onClick={() => setNovo({ ...novo, etapa: e.nome })}
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border ${
                      novo.etapa === e.nome ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:border-slate-400"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${COR_ETAPA[e.cor] ?? "bg-slate-400"}`} />
                    {e.nome}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="nn-valor" className="block text-xs font-medium text-slate-600 mb-1">Valor (R$)</label>
                <input id="nn-valor" type="number" min={0} step="1000" value={novo.valor} onChange={(e) => setNovo({ ...novo, valor: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900" />
              </div>
              <div>
                <label htmlFor="nn-fech" className="block text-xs font-medium text-slate-600 mb-1">Fechamento previsto</label>
                <input id="nn-fech" type="date" value={novo.fechamento} onChange={(e) => setNovo({ ...novo, fechamento: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setNovoOpen(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                Cancelar
              </button>
              <button type="submit" disabled={!novo.corretor_id || novo.cliente.trim().length < 2} className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg">
                Criar negócio
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
