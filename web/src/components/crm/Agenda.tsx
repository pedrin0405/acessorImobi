"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Plus, RefreshCw, X } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { Atividade, CorretorOpcao, corretoresAtivos, ROTULO_TIPO } from "@/lib/crm";

const COR_TIPO: Record<string, string> = {
  visita: "bg-amber-50 text-amber-700 border-amber-200",
  reuniao: "bg-sky-50 text-sky-700 border-sky-200",
  ligacao: "bg-violet-50 text-violet-700 border-violet-200",
  whatsapp: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const chaveDia = (iso: string) => new Date(iso).toLocaleDateString("sv-SE");

export default function Agenda({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const [atividades, setAtividades] = useState<Atividade[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [novaOpen, setNovaOpen] = useState(false);
  const [corretores, setCorretores] = useState<CorretorOpcao[]>([]);
  const vazia = { corretor_id: "", tipo: "visita", titulo: "", data: "", hora: "", cliente: "", local: "" };
  const [nova, setNova] = useState(vazia);
  const [novaErro, setNovaErro] = useState<string | null>(null);

  const carregar = async () => {
    setLoading(true);
    setErro(null);
    try {
      const res = await fetchApi("/admin/crm/agenda?dias=30");
      if (!res.ok) throw new Error("falha");
      setAtividades(await res.json());
    } catch (e) {
      if (!onAuthError(e)) setErro("Não foi possível carregar a agenda.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abrirNova = async () => {
    setNovaErro(null);
    setNova(vazia);
    setNovaOpen(true);
    try {
      const lista = await corretoresAtivos(fetchApi);
      setCorretores(lista);
      if (lista.length === 1) setNova((n) => ({ ...n, corretor_id: lista[0].id }));
    } catch (e) {
      if (!onAuthError(e)) setNovaErro("Não foi possível carregar os corretores.");
    }
  };

  const criar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setNovaErro(null);
    try {
      const corpo = Object.fromEntries(Object.entries(nova).filter(([, v]) => v.trim()));
      const res = await fetchApi("/admin/crm/atividades", { method: "POST", body: JSON.stringify(corpo) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const detalhe = Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail;
        setNovaErro(detalhe || "Não foi possível agendar.");
        return;
      }
      setNovaOpen(false);
      await carregar();
    } catch (e) {
      if (!onAuthError(e)) setNovaErro("Falha na comunicação com a API.");
    }
  };

  const mudarStatus = async (atividade: Atividade, status: "concluida" | "cancelada") => {
    try {
      const res = await fetchApi(`/admin/crm/atividades/${atividade.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("falha");
      setAtividades((lista) => lista.filter((a) => a.id !== atividade.id));
    } catch (e) {
      if (!onAuthError(e)) setErro("Não foi possível atualizar a atividade.");
    }
  };

  const grupos = useMemo(() => {
    const atrasadas = atividades.filter((a) => a.atrasada);
    const semData = atividades.filter((a) => !a.inicio);
    const porDia = new Map<string, Atividade[]>();
    atividades
      .filter((a) => a.inicio && !a.atrasada)
      .forEach((a) => {
        const dia = chaveDia(a.inicio!);
        porDia.set(dia, [...(porDia.get(dia) ?? []), a]);
      });
    return { atrasadas, semData, porDia: Array.from(porDia.entries()) };
  }, [atividades]);

  const hoje = chaveDia(new Date().toISOString());

  const Linha = ({ a }: { a: Atividade }) => (
    <li className="flex items-start gap-3 py-3">
      <span className="w-12 shrink-0 text-sm font-semibold text-slate-700 tabular-nums">
        {a.inicio ? new Date(a.inicio).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[11px] px-2 py-0.5 rounded-full border ${COR_TIPO[a.tipo] ?? "bg-slate-50 text-slate-600 border-slate-200"}`}>
            {ROTULO_TIPO[a.tipo] ?? a.tipo}
          </span>
          <span className="text-sm font-medium text-slate-900">{a.titulo}</span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          {[a.corretor_nome, a.lead_nome && `cliente ${a.lead_nome}`, a.local, a.imovel_codigo && `imóvel ${a.imovel_codigo}`]
            .filter(Boolean)
            .join(" · ")}
          {a.atrasada && a.inicio && (
            <span className="text-rose-600"> · era {new Date(a.inicio).toLocaleDateString("pt-BR")}</span>
          )}
        </p>
      </div>
      <div className="flex gap-1">
        <button title="Concluir" onClick={() => mudarStatus(a, "concluida")} className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-50">
          <Check className="w-4 h-4" />
        </button>
        <button title="Cancelar" onClick={() => mudarStatus(a, "cancelada")} className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 hover:text-rose-600">
          <X className="w-4 h-4" />
        </button>
      </div>
    </li>
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center">
        <div>
          <h2 className="font-semibold text-slate-900">Agenda da equipe</h2>
          <p className="text-xs text-slate-500 mt-1">
            Próximos 30 dias. Os corretores marcam pelo WhatsApp e recebem lembrete 1 hora antes, no horário comercial.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={carregar} title="Atualizar" className="p-2 text-slate-400 hover:text-slate-600">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={abrirNova}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium"
          >
            <Plus className="w-3.5 h-3.5" /> Nova atividade
          </button>
        </div>
      </div>

      {erro && <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">{erro}</div>}

      {atividades.length === 0 && !loading ? (
        <div className="p-12 text-center text-slate-400 space-y-2">
          <CalendarDays className="w-8 h-8 mx-auto" />
          <p className="text-sm">Nada agendado. Exemplo de pedido no WhatsApp: &ldquo;marca visita com a Ana amanhã às 10h&rdquo;.</p>
        </div>
      ) : (
        <div className="p-6 space-y-6">
          {grupos.atrasadas.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-rose-600">Atrasadas ({grupos.atrasadas.length})</h3>
              <ul className="divide-y divide-slate-100">{grupos.atrasadas.map((a) => <Linha key={a.id} a={a} />)}</ul>
            </section>
          )}
          {grupos.porDia.map(([dia, itens]) => (
            <section key={dia}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {dia === hoje
                  ? "Hoje"
                  : new Date(dia + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
              </h3>
              <ul className="divide-y divide-slate-100">{itens.map((a) => <Linha key={a.id} a={a} />)}</ul>
            </section>
          ))}
          {grupos.semData.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sem data</h3>
              <ul className="divide-y divide-slate-100">{grupos.semData.map((a) => <Linha key={a.id} a={a} />)}</ul>
            </section>
          )}
        </div>
      )}

      {novaOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
          <form onSubmit={criar} className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-semibold text-slate-900">Nova atividade</h3>
                <p className="text-xs text-slate-500 mt-1">O corretor recebe lembrete no WhatsApp 1 hora antes.</p>
              </div>
              <button type="button" onClick={() => setNovaOpen(false)} aria-label="Fechar" className="p-1 text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            {novaErro && <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm">{novaErro}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 sm:col-span-1">
                <label htmlFor="na-corretor" className="block text-xs font-medium text-slate-600 mb-1">Corretor *</label>
                <select id="na-corretor" required value={nova.corretor_id} onChange={(e) => setNova({ ...nova, corretor_id: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900 bg-white">
                  <option value="">Selecione</option>
                  {corretores.map((c) => (
                    <option key={c.id} value={c.id}>{c.nome || c.telefone_mascarado}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label htmlFor="na-tipo" className="block text-xs font-medium text-slate-600 mb-1">Tipo</label>
                <select id="na-tipo" value={nova.tipo} onChange={(e) => setNova({ ...nova, tipo: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900 bg-white">
                  {Object.entries(ROTULO_TIPO).map(([id, rotulo]) => (
                    <option key={id} value={id}>{rotulo}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="na-titulo" className="block text-xs font-medium text-slate-600 mb-1">Título</label>
              <input id="na-titulo" value={nova.titulo} onChange={(e) => setNova({ ...nova, titulo: e.target.value })} placeholder="Ex.: Visita ao apê da Orla" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="na-data" className="block text-xs font-medium text-slate-600 mb-1">Data</label>
                <input id="na-data" type="date" value={nova.data} onChange={(e) => setNova({ ...nova, data: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900" />
              </div>
              <div>
                <label htmlFor="na-hora" className="block text-xs font-medium text-slate-600 mb-1">Hora</label>
                <input id="na-hora" type="time" value={nova.hora} disabled={!nova.data} onChange={(e) => setNova({ ...nova, hora: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900 disabled:bg-slate-50" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="na-cliente" className="block text-xs font-medium text-slate-600 mb-1">Cliente</label>
                <input id="na-cliente" value={nova.cliente} onChange={(e) => setNova({ ...nova, cliente: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900" />
              </div>
              <div>
                <label htmlFor="na-local" className="block text-xs font-medium text-slate-600 mb-1">Local</label>
                <input id="na-local" value={nova.local} onChange={(e) => setNova({ ...nova, local: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900" />
              </div>
            </div>
            <p className="text-[11px] text-slate-400">Sem data, a atividade fica em &ldquo;Sem data&rdquo; até ser agendada.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setNovaOpen(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                Cancelar
              </button>
              <button type="submit" disabled={!nova.corretor_id} className="px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg">
                Agendar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
