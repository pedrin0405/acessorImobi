"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Users } from "lucide-react";
import { Aviso, Botao, Cartao, Interruptor, Selo, useApi } from "../ui";

interface Status {
  estado: "ocioso" | "na_fila" | "executando" | "concluido" | "erro";
  modo: string | null;
  etapa: string | null;
  ultimo_sucesso_em: string | null;
  total_remoto: number;
  processados: number;
  novos: number;
  atualizados: number;
  vinculados: number;
  pode_retomar: boolean;
  erro: string | null;
  automatica: boolean;
  leads_importados: number;
  leads_sem_responsavel: number;
  leads_total: number;
}

const n = (v: number) => v.toLocaleString("pt-BR");
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "nunca");

export default function LeadsImoviewCard({ onAuthError, onIr }: { onAuthError: (e: unknown) => boolean; onIr?: () => void }) {
  const api = useApi(onAuthError);
  const [s, setS] = useState<Status | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pedindo, setPedindo] = useState(false);

  const carregar = useCallback(async () => {
    const r = await api<Status>("/admin/integracoes/imoview/leads");
    if (r.ok && r.dados) setS(r.dados);
  }, [api]);

  const ativo = s?.estado === "executando" || s?.estado === "na_fila";
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(carregar, 4000);
    return () => clearInterval(t);
  }, [ativo, carregar]);

  const importar = async (completo: boolean) => {
    setPedindo(true);
    const r = await api("/admin/integracoes/imoview/leads/sincronizar", { method: "POST", corpo: { completo } });
    setPedindo(false);
    setErro(r.ok ? null : r.erro);
    carregar();
  };
  const alternarAuto = async (ligada: boolean) => {
    setS((x) => (x ? { ...x, automatica: ligada } : x));
    const r = await api("/admin/integracoes/imoview/leads/automatica", { method: "PUT", corpo: { ligada } });
    if (!r.ok) { setErro(r.erro); carregar(); }
  };

  if (!s) return <Cartao><p className="p-5 text-sm" style={{ color: "var(--text-3)" }}>Carregando…</p></Cartao>;

  const pct = s.total_remoto > 0 ? Math.min(100, Math.round((s.processados / s.total_remoto) * 100)) : 0;
  const primeira = s.leads_importados === 0 && !s.ultimo_sucesso_em;

  return (
    <Cartao>
      <div className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3 min-w-0">
          <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}><Users className="w-5 h-5" aria-hidden /></span>
          <div className="min-w-0">
            <h3 className="font-medium" style={{ color: "var(--text)" }}>Leads do Imoview</h3>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-3)" }}>Traz os leads do Imoview para Clientes, sem responsável, para a equipe distribuir. CPF e CNPJ não são importados.</p>
          </div>
        </div>
        {s.estado === "executando" ? <Selo tom="info">Importando</Selo> : s.estado === "na_fila" ? <Selo tom="info">Na fila</Selo> : s.estado === "erro" ? <Selo tom="perigo">Interrompida</Selo> : s.ultimo_sucesso_em ? <Selo tom="ok">Atualizado</Selo> : <Selo>Não importado</Selo>}
      </div>

      <dl className="grid grid-cols-3 gap-3 mt-5 text-sm">
        {[["Leads no portal", s.leads_total], ["Do Imoview", s.leads_importados], ["Sem responsável", s.leads_sem_responsavel]].map(([r, v]) => (
          <div key={r as string}><dt className="text-xs" style={{ color: "var(--text-3)" }}>{r}</dt><dd className="text-lg font-semibold tabular-nums" style={{ color: "var(--text)" }}>{n(v as number)}</dd></div>
        ))}
      </dl>

      {s.estado === "executando" && (
        <div className="mt-5" role="status" aria-live="polite">
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--card-2)" }}><div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "var(--accent)" }} /></div>
          <p className="text-xs mt-2" style={{ color: "var(--text-3)" }}>{s.etapa || "Importando"} · {n(s.processados)} de {n(s.total_remoto)} ({pct}%) · {n(s.novos)} novos. Pode sair desta tela; a importação continua.</p>
        </div>
      )}
      {s.estado === "erro" && <div className="mt-5"><Aviso tom="erro">{s.erro || "A importação parou."} {s.pode_retomar ? "Ela retoma de onde parou." : ""}</Aviso></div>}
      {erro && <div className="mt-5"><Aviso tom="erro">{erro}</Aviso></div>}

      <div className="flex flex-wrap items-center gap-2 mt-5">
        {s.pode_retomar && !ativo ? (
          <Botao variante="primario" onClick={() => importar(true)} carregando={pedindo}>Retomar importação</Botao>
        ) : (
          <Botao variante="primario" onClick={() => importar(primeira)} disabled={ativo} carregando={pedindo}>{primeira ? "Importar leads" : "Buscar novos leads"}</Botao>
        )}
        {!primeira && <Botao onClick={() => importar(true)} disabled={ativo}>Reimportar tudo</Botao>}
        {onIr && s.leads_total > 0 && <Botao variante="fantasma" onClick={onIr}>Ver clientes</Botao>}
        <span className="flex-1" />
        <span className="text-xs" style={{ color: "var(--text-3)" }}>Última vez: {quando(s.ultimo_sucesso_em)}</span>
      </div>
      <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--line)" }}>
        <div className="flex items-center gap-3">
          <Interruptor ligado={s.automatica} onChange={alternarAuto} rotulo="Atualização automática dos leads" />
          <span className="text-sm" style={{ color: "var(--text-2)" }}>Atualizar sozinho a cada 30 minutos e conferir tudo aos domingos</span>
        </div>
      </div>
      </div>
    </Cartao>
  );
}
