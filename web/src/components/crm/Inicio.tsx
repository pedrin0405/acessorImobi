"use client";

import { useEhCorretor } from "@/components/portal/papel";
import AvatarDoCorretor from "@/components/corretor/AvatarDoCorretor";
import React, { useEffect, useState } from "react";
import { CalendarClock, ChevronRight, Hourglass, MessageCircle, TriangleAlert } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { Atividade, Negocio, brl } from "@/lib/crm";
import AssistenteInicio from "@/components/crm/assistente/AssistenteInicio";

interface ConversaResumo {
  corretor_id: string;
  corretor_nome: string | null;
  nao_respondidas: number;
}

interface Pendencia {
  id: string;
  icone: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  corretorId?: string | null;
  corretorNome?: string | null;
  titulo: string;
  detalhe: string;
  destino: string;
  tom: "alerta" | "normal";
}

function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

export default function Inicio({
  nome,
  onIr,
  onAuthError,
}: {
  nome: string;
  onIr: (tab: string) => void;
  onAuthError: (e: unknown) => boolean;
}) {
  const ehCorretor = useEhCorretor();
  const [pendencias, setPendencias] = useState<Pendencia[] | null>(null);
  const [resumo, setResumo] = useState({ semResposta: 0, previsao: 0, hoje: 0 });

  useEffect(() => {
    (async () => {
      try {
        const [rA, rN, rC, rF] = await Promise.all([
          fetchApi("/admin/crm/agenda?dias=1"),
          fetchApi("/admin/crm/negocios?status=aberto"),
          fetchApi("/admin/conversas"),
          fetchApi("/admin/crm/forecast"),
        ]);
        const agenda: Atividade[] = rA.ok ? await rA.json() : [];
        const negocios: Negocio[] = rN.ok ? await rN.json() : [];
        const conversas: ConversaResumo[] = rC.ok ? await rC.json() : [];
        const forecast = rF.ok ? await rF.json() : { esperado: 0 };

        const itens: Pendencia[] = [];
        const atrasadas = agenda.filter((a) => a.atrasada);
        const hoje = agenda.filter((a) => a.inicio && !a.atrasada);
        if (atrasadas.length)
          itens.push({
            id: "atrasadas", icone: TriangleAlert, tom: "alerta", destino: "agenda",
            titulo: `${atrasadas.length} ${atrasadas.length === 1 ? "atividade atrasada" : "atividades atrasadas"}`,
            detalhe: atrasadas.slice(0, 2).map((a) => a.titulo).join(" · "),
          });
        hoje.slice(0, 3).forEach((a) =>
          itens.push({
            id: a.id, icone: CalendarClock, tom: "normal", destino: "agenda",
            titulo: a.titulo,
            detalhe: `${new Date(a.inicio!).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}${a.corretor_nome ? ` · ${a.corretor_nome}` : ""}`,
          })
        );
        negocios
          .filter((n) => n.travado)
          .slice(0, 3)
          .forEach((n) =>
            itens.push({
              id: n.id, icone: Hourglass, tom: "alerta", destino: "negociacoes",
              titulo: `Retomar ${n.lead_nome}`,
              detalhe: `${n.etapa_nome} há ${n.dias_na_etapa} dias · ${brl(n.valor)}`,
            })
          );
        const semResposta = conversas.reduce((s, c) => s + (c.nao_respondidas || 0), 0);
        conversas
          .filter((c) => c.nao_respondidas > 0)
          .slice(0, 3)
          .forEach((c) =>
            itens.push({
              id: c.corretor_id, corretorId: c.corretor_id, corretorNome: c.corretor_nome, icone: MessageCircle, tom: "normal", destino: "conversas",
              titulo: ehCorretor ? "Sua conversa com o Acessor" : `Conversa com ${c.corretor_nome || "corretor"}`,
              detalhe: `${c.nao_respondidas} sem resposta do agente`,
            })
          );
        setPendencias(itens);
        setResumo({ semResposta, previsao: forecast.esperado || 0, hoje: hoje.length });
      } catch (e) {
        if (!onAuthError(e)) setPendencias([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const primeiro = nome.split(" ")[0];

  const resumoTexto = (
    <>
      {resumo.semResposta > 0 ? (
        <>
          <strong style={{ color: "var(--text)" }}>{resumo.semResposta}</strong> sem resposta ·{" "}
        </>
      ) : null}
      <strong style={{ color: "var(--text)" }}>{resumo.hoje}</strong> compromissos hoje ·{" "}
      <strong style={{ color: "var(--text)" }}>{brl(resumo.previsao)}</strong> previstos no funil
    </>
  );

  return (
    <AssistenteInicio saudacao={`${saudacao()}, ${primeiro}`} resumo={resumoTexto} onAuthError={onAuthError}>
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm" style={{ color: "var(--text-3)" }}>Para hoje</h2>
          <button onClick={() => onIr("visao")} className="text-sm hover:underline" style={{ color: "var(--text-3)" }}>
            Visão geral
          </button>
        </div>
        <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
          {pendencias === null ? (
            <p className="p-5 text-sm" style={{ color: "var(--text-4)" }}>Carregando...</p>
          ) : pendencias.length === 0 ? (
            <p className="p-5 text-sm" style={{ color: "var(--text-3)" }}>
              Tudo em dia. Sem atividades atrasadas, atendimentos parados ou conversas esperando.
            </p>
          ) : (
            pendencias.map((p, i) => {
              const Icone = p.icone;
              return (
                <button
                  key={p.id + i}
                  onClick={() => onIr(p.destino)}
                  className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-[var(--hover-solid)] transition-colors"
                  style={{ borderTop: i ? "1px solid var(--line)" : undefined }}
                >
                  {p.corretorId ? <AvatarDoCorretor id={p.corretorId} nome={p.corretorNome ?? null} tamanho={32} /> : <Icone className="w-[18px] h-[18px] shrink-0" style={{ color: p.tom === "alerta" ? "var(--warn)" : "var(--text-3)" }} />}
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] truncate" style={{ color: "var(--text)" }}>{p.titulo}</span>
                    <span className="block text-xs truncate" style={{ color: "var(--text-4)" }}>{p.detalhe}</span>
                  </span>
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: "var(--text-4)" }} />
                </button>
              );
            })
          )}
        </div>
      </section>
    </AssistenteInicio>
  );
}
