"use client";

import React, { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { Atividade, COR_ETAPA, Forecast, Lead, Negocio, brl } from "@/lib/crm";

interface Dados {
  forecast: Forecast;
  negocios: Negocio[];
  leads: Lead[];
  agenda: Atividade[];
}

function Kpi({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe: string }) {
  return (
    <div className="rounded-2xl p-5 space-y-2" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
      <p className="text-xs" style={{ color: "var(--text-3)" }}>{rotulo}</p>
      <p className="text-[28px] font-light tracking-tight" style={{ color: "var(--text)" }}>{valor}</p>
      <p className="text-xs" style={{ color: "var(--text-4)" }}>{detalhe}</p>
    </div>
  );
}

export default function VisaoGeral({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [loading, setLoading] = useState(false);

  const carregar = async () => {
    setLoading(true);
    try {
      const [rF, rN, rL, rA] = await Promise.all([
        fetchApi("/admin/crm/forecast"),
        fetchApi("/admin/crm/negocios?status=aberto"),
        fetchApi("/admin/crm/leads"),
        fetchApi("/admin/crm/agenda?dias=7"),
      ]);
      if (!rF.ok || !rN.ok || !rL.ok || !rA.ok) throw new Error("falha");
      setDados({ forecast: await rF.json(), negocios: await rN.json(), leads: await rL.json(), agenda: await rA.json() });
    } catch (e) {
      onAuthError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const travados = dados?.negocios.filter((n) => n.travado) ?? [];
  const atrasadas = dados?.agenda.filter((a) => a.atrasada) ?? [];
  const quentes = dados?.leads.filter((l) => l.temperatura === "quente") ?? [];
  const maxEtapa = Math.max(...(dados?.forecast.etapas.map((e) => e.quantidade) ?? [0]), 1);

  // Ranking simples por corretor: negócios abertos e valor no funil.
  const porCorretor = Object.values(
    (dados?.negocios ?? []).reduce<Record<string, { nome: string; qtd: number; valor: number }>>((acc, n) => {
      const nome = n.corretor_nome || "Sem nome";
      acc[nome] ??= { nome, qtd: 0, valor: 0 };
      acc[nome].qtd += 1;
      acc[nome].valor += n.valor;
      return acc;
    }, {})
  ).sort((a, b) => b.valor - a.valor);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--text)" }}>Visão Geral</h1>
          <p className="text-sm" style={{ color: "var(--text-3)" }}>Funil, carteira e agenda da equipe, agora.</p>
        </div>
        <button onClick={carregar} className="flex items-center gap-2 h-10 px-4 rounded-full text-sm" style={{ border: "1px solid var(--line)", color: "var(--text-2)" }}>
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </button>
      </div>

      {dados && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Kpi rotulo="Pipeline aberto" valor={brl(dados.forecast.total)} detalhe={`${dados.forecast.quantidade} negócios abertos`} />
            <Kpi rotulo="Previsão ponderada" valor={brl(dados.forecast.esperado)} detalhe="valor × probabilidade da etapa" />
            <Kpi rotulo="Clientes na carteira" valor={String(dados.leads.length)} detalhe={`${quentes.length} quentes`} />
            <Kpi rotulo="Agenda (7 dias)" valor={String(dados.agenda.length)} detalhe={`${atrasadas.length} atrasadas`} />
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-2xl p-5 space-y-4" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
              <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Funil de vendas</h2>
              <div className="space-y-3">
                {dados.forecast.etapas.map((e) => (
                  <div key={e.etapa_id} className="grid grid-cols-[140px_1fr_auto] items-center gap-3 text-sm">
                    <span className="flex items-center gap-2 truncate" style={{ color: "var(--text-2)" }}>
                      <span className={`w-2 h-2 rounded-full ${COR_ETAPA[e.cor] ?? "bg-slate-400"}`} /> {e.etapa}
                    </span>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--card-2)" }}>
                      <div className="h-full rounded-full" style={{ width: `${(e.quantidade / maxEtapa) * 100}%`, background: "var(--accent)" }} />
                    </div>
                    <span className="tabular-nums text-xs" style={{ color: "var(--text-3)" }}>{e.quantidade}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl p-5 space-y-3" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
              <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Pede atenção</h2>
              {travados.length === 0 && atrasadas.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--text-3)" }}>Nada parado nem atrasado.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {travados.slice(0, 5).map((n) => (
                    <li key={n.id} style={{ color: "var(--text-2)" }}>
                      <span style={{ color: "var(--warn)" }}>●</span> {n.lead_nome} · {n.etapa_nome} há {n.dias_na_etapa}d
                    </li>
                  ))}
                  {atrasadas.slice(0, 5).map((a) => (
                    <li key={a.id} style={{ color: "var(--text-2)" }}>
                      <span style={{ color: "var(--danger)" }}>●</span> {a.titulo}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--text)" }}>Corretores</h2>
            {porCorretor.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-3)" }}>Sem negócios abertos ainda.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs" style={{ color: "var(--text-4)" }}>
                    <th className="pb-2 font-medium">Corretor</th>
                    <th className="pb-2 font-medium text-right">Negócios</th>
                    <th className="pb-2 font-medium text-right">No funil</th>
                  </tr>
                </thead>
                <tbody>
                  {porCorretor.map((c) => (
                    <tr key={c.nome} style={{ borderTop: "1px solid var(--line)", color: "var(--text-2)" }}>
                      <td className="py-2.5">{c.nome}</td>
                      <td className="py-2.5 text-right tabular-nums">{c.qtd}</td>
                      <td className="py-2.5 text-right tabular-nums">{brl(c.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
