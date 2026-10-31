"use client";

import React, { useCallback, useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { Aviso, Botao, Cartao, Interruptor, Selo, Seletor, useApi } from "../ui";

interface Fase { fase: number; etapa_id: string | null; em_atendimento: number; total: number }
interface Pendente { id: string; cliente: string; tipo: "fase" | "ganho" | "descarte"; fase_alvo: number | null; criada_em: string }
interface Status {
  estado: "ocioso" | "na_fila" | "executando" | "ok" | "erro";
  etapa: string | null;
  ultimo_sucesso_em: string | null;
  total_remoto: number;
  processados: number;
  pode_retomar: boolean;
  erro: string | null;
  espelhar: boolean;
  fases: Fase[];
  etapas: { id: string; nome: string }[];
  negocios_ligados: number;
  pendentes: Pendente[];
  total_pendentes: number;
}

const n = (v: number) => v.toLocaleString("pt-BR");
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "nunca");
const descricao = (p: Pendente) => (p.tipo === "fase" ? `passar para a fase ${p.fase_alvo}` : p.tipo === "ganho" ? "marcar como negócio realizado" : "descartar o atendimento");

export default function FunilImoviewCard({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const api = useApi(onAuthError);
  const [s, setS] = useState<Status | null>(null);
  const [mapa, setMapa] = useState<Record<number, string>>({});
  const [espelhar, setEspelhar] = useState(false);
  const [sujo, setSujo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    const r = await api<Status>("/admin/integracoes/imoview/leads/funil");
    if (!r.ok || !r.dados) return;
    setS(r.dados);
    if (!sujo) {
      setMapa(Object.fromEntries(r.dados.fases.filter((f) => f.etapa_id).map((f) => [f.fase, f.etapa_id as string])));
      setEspelhar(r.dados.espelhar);
    }
  }, [api, sujo]);

  const ativo = s?.estado === "executando" || s?.estado === "na_fila";
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(carregar, 4000);
    return () => clearInterval(t);
  }, [ativo, carregar]);

  const ler = async (completo: boolean) => {
    setOcupado(true);
    const r = await api("/admin/integracoes/imoview/leads/funil/sincronizar", { method: "POST", corpo: { completo } });
    setOcupado(false);
    setErro(r.ok ? null : r.erro);
    carregar();
  };
  const salvar = async () => {
    setOcupado(true);
    const fases = Object.fromEntries(Object.entries(mapa).filter(([, v]) => v));
    const r = await api<{ aplicado: { movidos: number } | null }>("/admin/integracoes/imoview/leads/funil", { method: "PUT", corpo: { espelhar, fases } });
    setOcupado(false);
    if (!r.ok) return setErro(r.erro);
    setErro(null); setSujo(false);
    setOk(r.dados?.aplicado ? `Salvo. ${n(r.dados.aplicado.movidos)} negociações alinhadas com o Imoview.` : "Salvo.");
    setTimeout(() => setOk(null), 5000);
    carregar();
  };
  const descartar = async (id: string) => {
    await api(`/admin/integracoes/imoview/leads/funil/pendencias/${id}`, { method: "DELETE" });
    carregar();
  };

  if (!s) return <Cartao><p className="p-5 text-sm" style={{ color: "var(--text-3)" }}>Carregando…</p></Cartao>;
  const lido = s.fases.some((f) => f.total > 0);
  const pct = s.total_remoto > 0 ? Math.min(100, Math.round((s.processados / s.total_remoto) * 100)) : 0;

  return (
    <Cartao>
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex gap-3 min-w-0">
            <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}><GitBranch className="w-5 h-5" aria-hidden /></span>
            <div className="min-w-0">
              <h3 className="font-medium" style={{ color: "var(--text)" }}>Etapas do CRM do Imoview</h3>
              <p className="text-sm mt-0.5" style={{ color: "var(--text-3)" }}>Lê a fase de cada atendimento no Imoview e, se você ligar o espelho, mantém as Negociações na mesma etapa. O Imoview não informa os nomes das fases: diga a que etapa do portal cada uma corresponde.</p>
            </div>
          </div>
          {ativo ? <Selo tom="info">{s.estado === "na_fila" ? "Na fila" : "Lendo"}</Selo> : s.estado === "erro" ? <Selo tom="perigo">Interrompida</Selo> : lido ? <Selo tom="ok">Atualizado</Selo> : <Selo>Não lido</Selo>}
        </div>

        {s.estado === "executando" && (
          <div className="mt-5" role="status" aria-live="polite">
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--card-2)" }}><div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "var(--accent)" }} /></div>
            <p className="text-xs mt-2" style={{ color: "var(--text-3)" }}>{s.etapa || "Lendo"} · {n(s.processados)} de {n(s.total_remoto)} ({pct}%). Pode sair desta tela; a leitura continua.</p>
          </div>
        )}
        {s.estado === "erro" && <div className="mt-5"><Aviso tom="erro">{s.erro || "A leitura parou."} {s.pode_retomar ? "Ela retoma de onde parou." : ""}</Aviso></div>}
        {erro && <div className="mt-5"><Aviso tom="erro">{erro}</Aviso></div>}
        {ok && <div className="mt-5"><Aviso tom="ok">{ok}</Aviso></div>}

        <div className="flex flex-wrap items-center gap-2 mt-5">
          {s.pode_retomar && !ativo ? <Botao variante="primario" onClick={() => ler(true)} carregando={ocupado}>Retomar leitura</Botao>
            : <Botao variante="primario" onClick={() => ler(!lido)} disabled={ativo} carregando={ocupado}>{lido ? "Buscar mudanças" : "Ler atendimentos"}</Botao>}
          {lido && <Botao onClick={() => ler(true)} disabled={ativo}>Reler tudo</Botao>}
          <span className="flex-1" />
          <span className="text-xs" style={{ color: "var(--text-3)" }}>Última leitura: {quando(s.ultimo_sucesso_em)} · {n(s.negocios_ligados)} negociações ligadas</span>
        </div>
      </div>

      <div className="p-5">
        <h4 className="text-sm font-medium mb-1" style={{ color: "var(--text)" }}>Fase do Imoview → etapa do portal</h4>
        <p className="text-xs mb-4" style={{ color: "var(--text-3)" }}>Fases sem etapa não movem ninguém. Atendimentos descartados no Imoview viram negócio perdido e os de negócio realizado viram ganho, quando o espelho está ligado.</p>
        <ul className="space-y-2">
          {s.fases.map((f) => (
            <li key={f.fase} className="flex flex-wrap items-center gap-3">
              <span className="w-24 text-sm font-medium" style={{ color: "var(--text)" }}>Fase {f.fase}</span>
              <span className="w-60 text-xs tabular-nums" style={{ color: "var(--text-3)" }}>{n(f.em_atendimento)} em atendimento{f.total > f.em_atendimento ? ` · ${n(f.total)} no total` : ""}</span>
              <Seletor aria-label={`Etapa para a fase ${f.fase}`} value={mapa[f.fase] || ""} onChange={(e) => { setMapa({ ...mapa, [f.fase]: e.target.value }); setSujo(true); }} className="!w-auto min-w-[12rem] flex-1 sm:flex-none">
                <option value="">Não espelhar</option>
                {s.etapas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </Seletor>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3 mt-5">
          <Interruptor ligado={espelhar} onChange={(v) => { setEspelhar(v); setSujo(true); }} rotulo="Espelhar o Imoview nas Negociações" />
          <span className="text-sm" style={{ color: "var(--text-2)" }}>Espelhar o Imoview nas Negociações</span>
          <span className="flex-1" />
          <Botao variante="primario" onClick={salvar} disabled={!sujo} carregando={ocupado}>Salvar</Botao>
        </div>
      </div>

      <div className="p-5">
        <h4 className="text-sm font-medium" style={{ color: "var(--text)" }}>{s.total_pendentes > 0 ? `${n(s.total_pendentes)} ${s.total_pendentes === 1 ? "alteração aguardando" : "alterações aguardando"} envio ao Imoview` : "Do portal para o Imoview"}</h4>
        <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
          {s.total_pendentes > 0 ? "O envio exige o código de acesso do usuário do Imoview, que ainda não está configurado. Se alguém mudar o atendimento no Imoview antes, a alteração é descartada e vale o Imoview." : "Mudanças de etapa feitas aqui entram nesta lista; enviá-las ao Imoview exige o código de acesso do usuário do Imoview."}
        </p>
        {s.pendentes.length > 0 && (
          <ul className="mt-3 space-y-2">
            {s.pendentes.map((p) => (
              <li key={p.id} className="flex items-center gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text-2)" }}><strong style={{ color: "var(--text)" }}>{p.cliente}</strong> · {descricao(p)}</span>
                <span className="text-xs shrink-0" style={{ color: "var(--text-3)" }}>{quando(p.criada_em)}</span>
                <Botao variante="fantasma" onClick={() => descartar(p.id)}>Descartar</Botao>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Cartao>
  );
}
