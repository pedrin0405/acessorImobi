"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock, Copy, ExternalLink, MessageCircle, X } from "lucide-react";
import { Etapa, Negocio } from "@/lib/crm";
import { Aviso, Botao, Iniciais, useApi } from "@/components/configuracoes/ui";
import AvatarDoCorretor from "@/components/corretor/AvatarDoCorretor";
import type { Ficha } from "@/components/crm/FichaCliente";
import { tempoAtras } from "@/components/crm/FluxoBits";
import AgendaLead from "./AgendaLead";
import CadastroLead from "./CadastroLead";
import ImoveisLead from "./ImoveisLead";
import LinhaDoTempo from "./LinhaDoTempo";
import PainelDecisao from "./popup/PainelDecisao";
import ResumoNegocio from "./popup/ResumoNegocio";
import { AUTOR_FUNIL, diaHora, EVENTO_FUNIL, fone, linkWhatsApp, LinhaDoTempoDados, Painel, Vazio } from "./util";

interface EventoNegocio { tipo: string; de: string | null; para: string | null; autor: string; created_at: string }
interface Completo { negocio: Negocio; eventos_do_negocio: EventoNegocio[]; ficha: Ficha; linha_do_tempo: LinhaDoTempoDados }

type Aba = "resumo" | "tempo" | "imoveis" | "interacoes" | "agenda" | "funil" | "cliente";

/** Popup completo do cartão do Fluxo: à esquerda o painel de decisão (valor, previsão, etapa, ações); à direita as abas com tudo sobre o negócio e o cliente. */
export default function PopupNegocio({
  negocioId, etapas: etapasProp, onFechar, onMudou, onAuthError, onAbrirCliente,
}: {
  negocioId: string; etapas?: Etapa[]; onFechar: () => void; onMudou: () => void; onAuthError: (e: unknown) => boolean;
  onAbrirCliente?: (leadId: string) => void;
}) {
  const api = useApi(onAuthError);
  const [dados, setDados] = useState<Completo | null>(null);
  const [etapas, setEtapas] = useState<Etapa[]>(etapasProp ?? []);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>("resumo");
  const [ocupado, setOcupado] = useState(false);
  const [obs, setObs] = useState("");
  const [copiado, setCopiado] = useState(false);

  const carregar = useCallback(async () => {
    const r = await api<Completo>(`/admin/crm/negocios/${negocioId}/completo`);
    if (r.ok && r.dados) { setDados(r.dados); setErro(null); setObs(r.dados.ficha.observacoes || ""); } else setErro(r.erro);
  }, [api, negocioId]);

  useEffect(() => { setDados(null); setAba("resumo"); carregar(); }, [carregar]);
  useEffect(() => {
    if (etapasProp?.length) return;
    (async () => { const r = await api<Etapa[]>("/admin/crm/etapas"); if (r.ok && r.dados) setEtapas(r.dados); })();
  }, [api, etapasProp]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", f);
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", f); document.body.style.overflow = anterior; };
  }, [onFechar]);

  const agir = async (corpo: Record<string, unknown>) => {
    setOcupado(true); setErro(null);
    const r = await api(`/admin/crm/negocios/${negocioId}`, { method: "PATCH", corpo });
    if (!r.ok) setErro(r.erro);
    await carregar();
    setOcupado(false);
    if (r.ok) onMudou();
    return r.ok;
  };

  const salvarObs = async () => {
    if (!dados) return;
    setOcupado(true);
    const r = await api<Ficha>(`/admin/crm/clientes/${dados.negocio.lead_id}`, { method: "PATCH", corpo: { observacoes: obs } });
    setOcupado(false);
    if (!r.ok || !r.dados) return setErro(r.erro);
    setDados({ ...dados, ficha: r.dados });
  };

  const abas = useMemo(() => {
    const f = dados?.ficha, t = dados?.linha_do_tempo;
    const interacoes = (f?.atendimentos ?? []).reduce((q, a) => q + (a.interacoes?.length ?? 0), 0);
    return [
      { id: "resumo" as Aba, rotulo: "Resumo" },
      { id: "tempo" as Aba, rotulo: "Linha do tempo", n: t?.resumo.total },
      { id: "imoveis" as Aba, rotulo: "Imóveis" },
      { id: "interacoes" as Aba, rotulo: "Interações", n: interacoes },
      { id: "agenda" as Aba, rotulo: "Agenda", n: f?.atividades.length },
      { id: "funil" as Aba, rotulo: "Histórico do Fluxo", n: dados?.eventos_do_negocio.length },
      { id: "cliente" as Aba, rotulo: "Dados do cliente" },
    ];
  }, [dados]);

  const nv = dados?.negocio;
  const wa = linkWhatsApp(nv?.lead_telefone);
  const atendimento = dados?.ficha.atendimentos?.[0];

  const copiar = async () => {
    if (!nv?.lead_telefone) return;
    try { await navigator.clipboard.writeText(nv.lead_telefone); setCopiado(true); setTimeout(() => setCopiado(false), 1800); } catch { /* sem permissão para a área de transferência */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-4" style={{ background: "rgb(0 0 0 / .6)" }} role="dialog" aria-modal="true" aria-label="Detalhes do card" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="w-full sm:max-w-6xl h-full sm:h-[90vh] sm:rounded-2xl flex flex-col overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--line-2)" }}>
        {!nv || !dados ? (
          <div className="flex-1 p-6" aria-busy>
            <div className="flex justify-end"><button type="button" onClick={onFechar} aria-label="Fechar" className="p-2 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}><X className="w-5 h-5" /></button></div>
            {erro ? <Aviso tom="erro">{erro}</Aviso> : <div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: "var(--card-2)" }} />)}</div>}
          </div>
        ) : (
          <>
            <header className="px-4 sm:px-6 py-4 shrink-0 flex items-center gap-3" style={{ borderBottom: "1px solid var(--line)" }}>
              <Iniciais nome={nv.lead_nome} tamanho={44} />
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-semibold leading-tight truncate" style={{ color: "var(--text)" }}>{nv.lead_nome}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]" style={{ color: "var(--text-3)" }}>
                  {nv.lead_telefone && (
                    <span className="inline-flex items-center gap-1">
                      <span className="tabular-nums" style={{ color: "var(--text-2)" }}>{fone(nv.lead_telefone)}</span>
                      <button type="button" onClick={copiar} className="p-1.5 rounded-lg hover:bg-[var(--hover-solid)] transition-colors duration-150" aria-label="Copiar telefone" title="Copiar telefone">{copiado ? <Check className="w-4 h-4" style={{ color: "var(--accent-text)" }} /> : <Copy className="w-4 h-4" />}</button>
                      {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-lg hover:bg-[var(--hover-solid)] transition-colors duration-150" aria-label="Abrir WhatsApp" title="Abrir WhatsApp"><MessageCircle className="w-4 h-4" /></a>}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 min-w-0">{nv.corretor_nome ? <><AvatarDoCorretor id={nv.corretor_id} nome={nv.corretor_nome} tamanho={20} /><span className="truncate" style={{ color: "var(--text-2)" }}>{nv.corretor_nome}</span></> : <span style={{ color: "var(--warn)" }}>Sem responsável</span>}</span>
                  {nv.im_ultima_interacao && <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" aria-hidden />Contato {tempoAtras(nv.im_ultima_interacao)}</span>}
                </div>
              </div>
              <button type="button" onClick={onFechar} aria-label="Fechar" className="p-2 rounded-lg hover:bg-[var(--hover-solid)] shrink-0 transition-colors duration-150" style={{ color: "var(--text-3)" }}><X className="w-5 h-5" /></button>
            </header>

            <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden flex flex-col lg:flex-row">
              <aside className="lg:w-[336px] shrink-0 p-4 sm:p-6 lg:overflow-y-auto" style={{ background: "var(--card)" }} aria-label="Decisão sobre o negócio">
                {erro && <div className="mb-4"><Aviso tom="erro">{erro}</Aviso></div>}
                <PainelDecisao nv={nv} etapas={etapas} ocupado={ocupado} agir={agir} onAbrirCliente={onAbrirCliente} previsaoCrm={atendimento?.previsao_fechamento_em} />
              </aside>

              <div className="flex-1 min-w-0 lg:min-h-0 flex flex-col lg:border-l" style={{ borderColor: "var(--line)", background: "var(--bg)" }}>
                <nav className="px-3 sm:px-5 shrink-0 overflow-x-auto border-t lg:border-t-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ borderBottom: "1px solid var(--line)", borderColor: "var(--line)", background: "var(--card)" }} role="tablist" aria-label="Seções do card">
                  <div className="flex gap-1 w-max">
                    {abas.map((a) => (
                      <button key={a.id} role="tab" aria-selected={aba === a.id} onClick={() => setAba(a.id)} className="px-3 min-h-11 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors duration-150" style={{ borderColor: aba === a.id ? "var(--accent)" : "transparent", color: aba === a.id ? "var(--text)" : "var(--text-3)", fontWeight: aba === a.id ? 600 : 400 }}>
                        {a.rotulo}{a.n ? <span className="ml-1.5 text-xs tabular-nums" style={{ color: "var(--text-4)" }}>{a.n}</span> : null}
                      </button>
                    ))}
                  </div>
                </nav>

                <div className="flex-1 lg:overflow-y-auto p-4 sm:p-6" role="tabpanel">
                  {aba === "resumo" && <ResumoNegocio nv={nv} ficha={dados.ficha} tempo={dados.linha_do_tempo} onAba={(x) => setAba(x as Aba)} />}
                  {aba === "tempo" && <Painel><LinhaDoTempo eventos={dados.linha_do_tempo.eventos} resumo={dados.linha_do_tempo.resumo} /></Painel>}
                  {aba === "imoveis" && (
                    <div className="space-y-3">
                      {nv.imovel_codigo || nv.titulo ? <p className="text-xs" style={{ color: "var(--text-3)" }}>{nv.imovel_codigo ? `Imóvel do negócio: código ${nv.imovel_codigo}. ` : ""}{nv.titulo ? `Título: ${nv.titulo}.` : ""}</p> : null}
                      <ImoveisLead atendimentos={dados.ficha.atendimentos ?? []} />
                    </div>
                  )}
                  {aba === "interacoes" && <Interacoes ficha={dados.ficha} />}
                  {aba === "agenda" && <AgendaLead atividades={dados.ficha.atividades} />}
                  {aba === "funil" && (
                    <Painel titulo="Movimentos deste negócio">
                      {dados.eventos_do_negocio.length === 0 ? <Vazio texto="Nenhum movimento registrado neste negócio." /> : (
                        <ol className="divide-y divide-[color:var(--line)]">
                          {[...dados.eventos_do_negocio].reverse().map((e, i) => (
                            <li key={i} className="py-2.5 flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm">
                              <span style={{ color: "var(--text-2)" }}>{EVENTO_FUNIL[e.tipo] ?? e.tipo}{e.para && e.tipo !== "perdido" ? ` · ${e.de ? `${e.de} → ` : ""}${e.para}` : ""}{e.tipo === "perdido" && e.para ? ` · ${e.para}` : ""}</span>
                              <span className="text-xs tabular-nums" style={{ color: "var(--text-4)" }}>{AUTOR_FUNIL[e.autor] ?? e.autor} · {diaHora(e.created_at)}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </Painel>
                  )}
                  {aba === "cliente" && (
                    <div className="space-y-3">
                      {onAbrirCliente && <div className="flex justify-end"><Botao onClick={() => onAbrirCliente(nv.lead_id)}><ExternalLink className="w-4 h-4" aria-hidden />Abrir todos os detalhes do cliente</Botao></div>}
                      <CadastroLead ficha={dados.ficha} obs={obs} onObs={setObs} onSalvarObs={salvarObs} salvando={ocupado} compacto />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Interacoes({ ficha }: { ficha: Ficha }) {
  const lista = (ficha.atendimentos ?? []).flatMap((a) => (a.interacoes ?? []).map((i) => ({ ...i, a: a.codigo }))).sort((x, y) => (y.em ?? "").localeCompare(x.em ?? ""));
  if (!lista.length) return <Painel><Vazio texto="O CRM do Imoview ainda não registrou interações neste atendimento." /></Painel>;
  return (
    <Painel titulo={`Interações no CRM (${lista.length})`}>
      <ol className="space-y-3">
        {lista.map((i, k) => {
          const robo = /rob[ôo]/i.test(i.usuario || "");
          return (
            <li key={k} className="rounded-xl p-3" style={{ background: robo ? "transparent" : "var(--card-2)", border: "1px solid var(--line)" }}>
              <p className="text-xs flex flex-wrap items-center gap-x-2 gap-y-1" style={{ color: "var(--text-3)" }}><span className="tabular-nums">{diaHora(i.em)}</span>{i.usuario && <span style={{ color: robo ? "var(--text-4)" : "var(--accent-text)" }}>{i.usuario.trim()}</span>}<span>Atendimento #{i.a}</span></p>
              <p className="mt-1 text-[13px] whitespace-pre-line break-words" style={{ color: robo ? "var(--text-3)" : "var(--text)" }}>{i.descricao}</p>
            </li>
          );
        })}
      </ol>
    </Painel>
  );
}
