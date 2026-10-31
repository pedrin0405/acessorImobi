"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Clock, Copy, ExternalLink, MessageCircle, Phone, RotateCcw, Trophy, UserRound, X, XCircle } from "lucide-react";
import { brl, Etapa, Negocio } from "@/lib/crm";
import { Aviso, Botao, Entrada, Iniciais, Selo, useApi } from "@/components/configuracoes/ui";
import AvatarDoCorretor from "@/components/corretor/AvatarDoCorretor";
import type { Ficha } from "@/components/crm/FichaCliente";
import { ROTULO_ESTAGIO, rotuloValor, TermometroSelo, tempoAtras } from "@/components/crm/FluxoBits";
import AgendaLead from "./AgendaLead";
import CadastroLead from "./CadastroLead";
import ImoveisLead from "./ImoveisLead";
import LinhaDoTempo from "./LinhaDoTempo";
import MetricasLead from "./MetricasLead";
import { AUTOR_FUNIL, Campos, dataCurta, dia, diaHora, EVENTO_FUNIL, fone, linkWhatsApp, LinhaDoTempoDados, Metrica, ORIGENS, Painel, Vazio } from "./util";

interface EventoNegocio { tipo: string; de: string | null; para: string | null; autor: string; created_at: string }
interface Completo { negocio: Negocio; eventos_do_negocio: EventoNegocio[]; ficha: Ficha; linha_do_tempo: LinhaDoTempoDados }

type Aba = "resumo" | "tempo" | "imoveis" | "interacoes" | "agenda" | "funil" | "cliente";

/** Popup completo do cartão do Fluxo: mover, ganhar/perder, editar valor e previsão e ver tudo sobre o negócio e o cliente. */
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
  const [perdendo, setPerdendo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [valorTxt, setValorTxt] = useState("");
  const [previsao, setPrevisao] = useState("");
  const [obs, setObs] = useState("");
  const [copiado, setCopiado] = useState(false);

  const carregar = useCallback(async () => {
    const r = await api<Completo>(`/admin/crm/negocios/${negocioId}/completo`);
    if (r.ok && r.dados) {
      setDados(r.dados); setErro(null);
      setValorTxt(r.dados.negocio.valor > 0 ? String(Math.round(r.dados.negocio.valor)) : "");
      setPrevisao(r.dados.negocio.fechamento_previsto?.slice(0, 10) ?? "");
      setObs(r.dados.ficha.observacoes || "");
    } else setErro(r.erro);
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
  const aberto = nv?.status === "aberto";
  const origem = nv ? rotuloValor(nv) : null;
  const wa = linkWhatsApp(nv?.lead_telefone);
  const atendimento = dados?.ficha.atendimentos?.[0];

  const copiar = async () => {
    if (!nv?.lead_telefone) return;
    try { await navigator.clipboard.writeText(nv.lead_telefone); setCopiado(true); setTimeout(() => setCopiado(false), 1800); } catch { /* sem permissão para a área de transferência */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-4" style={{ background: "rgb(0 0 0 / .6)" }} role="dialog" aria-modal="true" aria-label="Detalhes do card" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="w-full sm:max-w-5xl h-full sm:h-[92vh] sm:rounded-2xl flex flex-col overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--line-2)" }}>
        {!nv ? (
          <div className="flex-1 p-6" aria-busy>
            <div className="flex justify-end"><button type="button" onClick={onFechar} aria-label="Fechar" className="p-1.5 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}><X className="w-5 h-5" /></button></div>
            {erro ? <Aviso tom="erro">{erro}</Aviso> : <div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: "var(--card-2)" }} />)}</div>}
          </div>
        ) : (
          <>
            <header className="px-4 sm:px-6 pt-4 pb-3 shrink-0" style={{ borderBottom: "1px solid var(--line)" }}>
              <div className="flex items-start gap-3">
                <Iniciais nome={nv.lead_nome} tamanho={48} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold break-words leading-tight" style={{ color: "var(--text)" }}>{nv.lead_nome}</h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Selo tom={nv.status === "ganho" ? "ok" : nv.status === "perdido" ? "perigo" : "info"}>{nv.status === "aberto" ? nv.etapa_nome : nv.status === "ganho" ? "Ganho" : "Perdido"}</Selo>
                    <TermometroSelo valor={nv.im_termometro} />
                    {nv.im_qualificado && <Selo tom="ok">Qualificado</Selo>}
                    {nv.lead_origem && <Selo tom={nv.lead_origem === "imoview" ? "info" : "neutro"}>{ORIGENS[nv.lead_origem] ?? nv.lead_origem}</Selo>}
                    {nv.imoview_estagio && ROTULO_ESTAGIO[nv.imoview_estagio] && <Selo>Imoview · {ROTULO_ESTAGIO[nv.imoview_estagio]}</Selo>}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs" style={{ color: "var(--text-3)" }}>
                    {nv.lead_telefone && (
                      <span className="inline-flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5" aria-hidden /><span style={{ color: "var(--text-2)" }}>{fone(nv.lead_telefone)}</span>
                        <button type="button" onClick={copiar} className="p-1 rounded hover:bg-[var(--hover-solid)]" aria-label="Copiar telefone" title="Copiar telefone">{copiado ? <Check className="w-3.5 h-3.5" style={{ color: "var(--accent-text)" }} /> : <Copy className="w-3.5 h-3.5" />}</button>
                        {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline" style={{ color: "var(--text-2)" }}><MessageCircle className="w-3.5 h-3.5" aria-hidden />WhatsApp</a>}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5">{nv.corretor_nome ? <><AvatarDoCorretor id={nv.corretor_id} nome={nv.corretor_nome} tamanho={20} /><span style={{ color: "var(--text-2)" }}>{nv.corretor_nome}</span></> : <span style={{ color: "var(--warn)" }}>Sem responsável</span>}</span>
                    {nv.im_ultima_interacao && <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" aria-hidden />Contato {tempoAtras(nv.im_ultima_interacao)}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-2xl font-semibold tabular-nums leading-tight" style={{ color: "var(--text)" }}>{nv.valor > 0 ? brl(nv.valor) : "Sem valor"}</p>
                  {nv.valor > 0 && origem && <p className="text-[11px]" style={{ color: "var(--text-3)" }}>{origem}</p>}
                  {nv.im_comissao ? <p className="text-[11px] tabular-nums" style={{ color: "var(--accent-text)" }}>comissão {brl(nv.im_comissao)}</p> : null}
                </div>
                <button type="button" onClick={onFechar} aria-label="Fechar" className="p-1.5 rounded-lg hover:bg-[var(--hover-solid)] shrink-0" style={{ color: "var(--text-3)" }}><X className="w-5 h-5" /></button>
              </div>

              {erro && <div className="mt-3"><Aviso tom="erro">{erro}</Aviso></div>}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="flex-1 min-w-0 overflow-x-auto" role="group" aria-label="Etapa do negócio">
                  <div className="flex gap-1.5 w-max">
                    {etapas.map((e) => {
                      const atual = e.id === nv.etapa_id;
                      return (
                        <button key={e.id} type="button" disabled={!aberto || ocupado || atual} onClick={() => agir({ etapa: e.nome })} aria-current={atual ? "step" : undefined}
                          className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap disabled:cursor-default"
                          style={{ background: atual ? "var(--chip)" : "var(--card-2)", color: atual ? "var(--chip-text)" : "var(--text-2)", border: "1px solid var(--line)", opacity: !aberto && !atual ? 0.55 : 1 }}>{e.nome}</button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {aberto && <Botao variante="primario" disabled={ocupado} onClick={() => agir({ status: "ganho" })}><Trophy className="w-4 h-4" aria-hidden />Ganhar</Botao>}
                  {aberto && <Botao variante="perigo" disabled={ocupado} onClick={() => setPerdendo((v) => !v)}><XCircle className="w-4 h-4" aria-hidden />Perder</Botao>}
                  {!aberto && <Botao disabled={ocupado} onClick={() => agir({ status: "aberto" })}><RotateCcw className="w-4 h-4" aria-hidden />Reabrir</Botao>}
                  {onAbrirCliente && <Botao onClick={() => onAbrirCliente(nv.lead_id)}><UserRound className="w-4 h-4" aria-hidden />Mais detalhes do cliente</Botao>}
                </div>
              </div>

              {perdendo && aberto && (
                <div className="mt-3 flex flex-wrap items-center gap-2 assist-fade">
                  <Entrada autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por que foi perdido? Ex.: preço, comprou com outro" aria-label="Motivo da perda" className="flex-1 min-w-[14rem]" onKeyDown={(e) => { if (e.key === "Enter" && motivo.trim()) agir({ status: "perdido", motivo_perda: motivo.trim() }).then((ok) => ok && (setPerdendo(false), setMotivo(""))); }} />
                  <Botao variante="perigo" disabled={!motivo.trim() || ocupado} onClick={() => agir({ status: "perdido", motivo_perda: motivo.trim() }).then((ok) => ok && (setPerdendo(false), setMotivo("")))}>Confirmar perda</Botao>
                  <Botao variante="fantasma" onClick={() => setPerdendo(false)}>Cancelar</Botao>
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
                <label className="block">
                  <span className="block text-[11px] mb-1" style={{ color: "var(--text-3)" }}>Valor (R$)</span>
                  <span className="flex gap-1.5"><Entrada type="number" min={0} step="1000" value={valorTxt} onChange={(e) => setValorTxt(e.target.value)} className="!w-36 !py-1.5" aria-label="Valor do negócio" />
                    <Botao disabled={ocupado || valorTxt === "" || Number(valorTxt) === Math.round(nv.valor)} onClick={() => agir({ valor: Number(valorTxt) })}>Salvar</Botao></span>
                </label>
                <label className="block">
                  <span className="block text-[11px] mb-1" style={{ color: "var(--text-3)" }}>Previsão de fechamento</span>
                  <span className="flex gap-1.5"><Entrada type="date" value={previsao} onChange={(e) => setPrevisao(e.target.value)} className="!w-40 !py-1.5" aria-label="Previsão de fechamento" />
                    <Botao disabled={ocupado || !previsao || previsao === (nv.fechamento_previsto?.slice(0, 10) ?? "")} onClick={() => agir({ fechamento_previsto: previsao })}>Salvar</Botao></span>
                </label>
                <p className="text-[11px] max-w-xs pb-2" style={{ color: "var(--text-4)" }}>{nv.valor_manual ? "Valor manual: o CRM do Imoview deixou de sobrescrevê-lo." : "Valor vindo do CRM. Se você editar, ele passa a ser manual e o CRM não sobrescreve."}</p>
              </div>
            </header>

            <nav className="px-3 sm:px-5 shrink-0 overflow-x-auto" style={{ borderBottom: "1px solid var(--line)" }} role="tablist" aria-label="Seções do card">
              <div className="flex gap-1 w-max">
                {abas.map((a) => (
                  <button key={a.id} role="tab" aria-selected={aba === a.id} onClick={() => setAba(a.id)} className="px-3 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px" style={{ borderColor: aba === a.id ? "var(--accent)" : "transparent", color: aba === a.id ? "var(--text)" : "var(--text-3)", fontWeight: aba === a.id ? 600 : 400 }}>
                    {a.rotulo}{a.n ? <span className="ml-1.5 text-[11px] tabular-nums" style={{ color: "var(--text-4)" }}>{a.n}</span> : null}
                  </button>
                ))}
              </div>
            </nav>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6" style={{ background: "var(--bg)" }}>
              {aba === "resumo" && (
                <div className="space-y-4">
                  {nv.travado && <Aviso tom="aviso"><span className="inline-flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" aria-hidden />Parado há {nv.dias_na_etapa} dias nesta etapa: passou do prazo de alerta.</span></Aviso>}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Metrica rotulo="Probabilidade" valor={`${nv.probabilidade}%`} sub={`Etapa ${nv.etapa_nome}`} />
                    <Metrica rotulo="Valor esperado" valor={nv.esperado > 0 ? brl(nv.esperado) : "—"} sub="Valor × probabilidade" />
                    <Metrica rotulo="Dias na etapa" valor={nv.dias_na_etapa} sub={nv.status === "aberto" ? "Desde a última movimentação" : undefined} />
                    <Metrica rotulo="Previsão de fechamento" valor={nv.fechamento_previsto ? dataCurta(nv.fechamento_previsto) : atendimento?.previsao_fechamento_em ? dataCurta(atendimento.previsao_fechamento_em) : "—"} />
                  </div>
                  {nv.motivo_perda && <Aviso tom="aviso">Motivo da perda: {nv.motivo_perda}</Aviso>}
                  {atendimento && (
                    <Painel titulo={`Atendimento ativo no Imoview · #${atendimento.codigo}`}>
                      <Campos colunas={3} itens={[
                        ["Situação", atendimento.situacao], ["Finalidade", atendimento.finalidade], ["Funil", atendimento.funil], ["Mídia", [atendimento.midia, atendimento.campanha].filter(Boolean).join(" · ")],
                        ["Corretor no CRM", atendimento.corretor_nome], ["MQL", atendimento.mql_nome], ["Unidade", atendimento.unidade], ["Termômetro", atendimento.termometro], ["Fase", atendimento.fase ? `Fase ${atendimento.fase}` : null],
                        ["Entrada do lead", diaHora(atendimento.entrada_em)], ["Primeira resposta", diaHora(atendimento.primeira_resposta_em)], ["Última interação", diaHora(atendimento.ultima_interacao_em)],
                        ["Previsão no CRM", dia(atendimento.previsao_fechamento_em)], ["Fechamento", dia(atendimento.fechamento_em)],
                      ]} />
                    </Painel>
                  )}
                  <MetricasLead ficha={dados.ficha} tempo={dados.linha_do_tempo} onAba={(x) => setAba(x === "tempo" ? "tempo" : x === "imoveis" ? "imoveis" : x === "agenda" ? "agenda" : "resumo")} />
                </div>
              )}

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
