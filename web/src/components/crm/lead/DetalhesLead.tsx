"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Copy, MessageCircle, Phone } from "lucide-react";
import { Aviso, Botao, Iniciais, Selo, Seletor, useApi } from "@/components/configuracoes/ui";
import AvatarDoCorretor from "@/components/corretor/AvatarDoCorretor";
import AtendimentosImoview from "@/components/crm/AtendimentosImoview";
import type { Ficha } from "@/components/crm/FichaCliente";
import { TermometroSelo } from "@/components/crm/FluxoBits";
import AgendaLead from "./AgendaLead";
import CadastroLead from "./CadastroLead";
import ConversaLead from "./ConversaLead";
import FluxoLead from "./FluxoLead";
import ImoveisLead, { ImovelMatch } from "./ImoveisLead";
import LinhaDoTempo from "./LinhaDoTempo";
import MetricasLead, { negocioPrincipal } from "./MetricasLead";
import PopupNegocio from "./PopupNegocio";
import { COR_TEMP, fone, linkWhatsApp, LinhaDoTempoDados, ORIGENS, Painel, Vazio } from "./util";

type Aba = "geral" | "tempo" | "imoview" | "imoveis" | "conversa" | "agenda" | "fluxo" | "cadastro";
const LIMITE_INICIAL = 400;
const LIMITE_MAXIMO = 1000;

/** Subpágina do cliente: métricas, linha do tempo de tudo o que o corretor fez, Imoview, imóveis, conversa, agenda, Fluxo e cadastro. */
export default function DetalhesLead({
  leadId, corretores, onVoltar, onAuthError, onMudou, rotuloVoltar = "Voltar aos clientes",
}: {
  leadId: string; corretores: { id: string; nome: string }[]; onVoltar: () => void; onAuthError: (e: unknown) => boolean; onMudou?: () => void; rotuloVoltar?: string;
}) {
  const api = useApi(onAuthError);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [tempo, setTempo] = useState<LinhaDoTempoDados | null>(null);
  const [limite, setLimite] = useState(LIMITE_INICIAL);
  const [maisCarregando, setMaisCarregando] = useState(false);
  const [match, setMatch] = useState<ImovelMatch[] | null | undefined>(undefined);
  const [aba, setAba] = useState<Aba>("geral");
  const [erro, setErro] = useState<string | null>(null);
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [destino, setDestino] = useState("");
  const [atribuindo, setAtribuindo] = useState(false);
  const [popupId, setPopupId] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const carregarFicha = useCallback(async () => {
    const r = await api<Ficha>(`/admin/crm/clientes/${leadId}`);
    if (r.ok && r.dados) { setFicha(r.dados); setObs(r.dados.observacoes || ""); setErro(null); } else setErro(r.erro);
  }, [api, leadId]);

  const carregarTempo = useCallback(async (lim: number) => {
    const r = await api<LinhaDoTempoDados>(`/admin/crm/clientes/${leadId}/linha-do-tempo?limite=${lim}`);
    if (r.ok && r.dados) setTempo(r.dados); else if (r.erro) setErro(r.erro);
  }, [api, leadId]);

  useEffect(() => {
    setFicha(null); setTempo(null); setMatch(undefined); setAba("geral"); setLimite(LIMITE_INICIAL); setDestino("");
    carregarFicha(); carregarTempo(LIMITE_INICIAL);
  }, [leadId, carregarFicha, carregarTempo]);

  // "Combina com" só é calculado quando a aba Imóveis é aberta (cruza com a carteira inteira).
  useEffect(() => {
    if (aba !== "imoveis" || match !== undefined) return;
    setMatch(null);
    (async () => { const r = await api<ImovelMatch[]>(`/admin/crm/leads/${leadId}/match`); setMatch(r.ok && r.dados ? r.dados : []); })();
  }, [aba, match, api, leadId]);

  const carregarMais = async () => {
    const novo = Math.min(limite + LIMITE_INICIAL, LIMITE_MAXIMO);
    setMaisCarregando(true); setLimite(novo);
    await carregarTempo(novo);
    setMaisCarregando(false);
  };

  const ajustar = async (corpo: Record<string, string>) => {
    setSalvando(true);
    const r = await api<Ficha>(`/admin/crm/clientes/${leadId}`, { method: "PATCH", corpo });
    setSalvando(false);
    if (!r.ok || !r.dados) return setErro(r.erro);
    setFicha(r.dados); setObs(r.dados.observacoes || ""); setErro(null);
    onMudou?.();
  };

  const atribuir = async () => {
    if (!destino) return;
    setAtribuindo(true);
    const r = await api("/admin/crm/clientes/atribuir", { method: "POST", corpo: { ids: [leadId], corretor_id: destino } });
    setAtribuindo(false);
    if (!r.ok) return setErro(r.erro);
    setDestino(""); await carregarFicha(); carregarTempo(limite); onMudou?.();
  };

  const copiar = async () => {
    if (!ficha?.telefone) return;
    try { await navigator.clipboard.writeText(ficha.telefone); setCopiado(true); setTimeout(() => setCopiado(false), 1800); } catch { /* sem permissão */ }
  };

  if (!ficha) {
    return (
      <div>
        <button type="button" onClick={onVoltar} className="inline-flex items-center gap-2 text-sm mb-5" style={{ color: "var(--text-3)" }}><ArrowLeft className="w-4 h-4" aria-hidden />{rotuloVoltar}</button>
        {erro ? <Aviso tom="erro">{erro}</Aviso> : <div className="space-y-3" aria-busy>{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: "var(--card)" }} />)}</div>}
      </div>
    );
  }

  const neg = negocioPrincipal(ficha);
  const wa = linkWhatsApp(ficha.telefone);
  const abas: { id: Aba; rotulo: string; n?: number }[] = [
    { id: "geral", rotulo: "Visão geral" },
    { id: "tempo", rotulo: "Linha do tempo", n: tempo?.resumo.total },
    { id: "imoview", rotulo: "Atendimentos no Imoview", n: ficha.atendimentos?.length },
    { id: "imoveis", rotulo: "Imóveis" },
    { id: "conversa", rotulo: "Conversa", n: tempo ? tempo.resumo.mensagens_corretor + tempo.resumo.mensagens_cliente : undefined },
    { id: "agenda", rotulo: "Agenda", n: ficha.atividades.length },
    { id: "fluxo", rotulo: "Fluxo", n: ficha.negocios.length },
    { id: "cadastro", rotulo: "Cadastro" },
  ];

  return (
    <div>
      <button type="button" onClick={onVoltar} className="inline-flex items-center gap-2 text-sm mb-5 hover:underline" style={{ color: "var(--text-3)" }}><ArrowLeft className="w-4 h-4" aria-hidden />{rotuloVoltar}</button>

      <header className="rounded-2xl p-4 sm:p-5 mb-5" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
        <div className="flex flex-wrap items-start gap-4">
          <Iniciais nome={ficha.nome} tamanho={64} />
          <div className="min-w-0 flex-1 basis-64">
            <h1 className="text-2xl font-semibold tracking-tight break-words" style={{ color: "var(--text)" }}>{ficha.nome}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Selo tom={ficha.origem === "imoview" ? "info" : "neutro"}>{ORIGENS[ficha.origem] ?? ficha.origem}</Selo>
              {neg && <Selo tom={neg.status === "ganho" ? "ok" : neg.status === "perdido" ? "perigo" : "info"}>{neg.status === "aberto" ? neg.etapa_nome : neg.status === "ganho" ? "Ganho" : "Perdido"}</Selo>}
              <TermometroSelo valor={ficha.atendimentos?.[0]?.termometro} />
              {ficha.codigo_imoview && <span className="text-xs" style={{ color: "var(--text-3)" }}>Imoview #{ficha.codigo_imoview}</span>}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              {ficha.telefone && (
                <span className="inline-flex items-center gap-1.5" style={{ color: "var(--text-2)" }}>
                  <Phone className="w-4 h-4" style={{ color: "var(--text-3)" }} aria-hidden />{fone(ficha.telefone)}
                  <button type="button" onClick={copiar} className="p-1 rounded hover:bg-[var(--hover-solid)]" aria-label="Copiar telefone" title="Copiar telefone">{copiado ? <Check className="w-4 h-4" style={{ color: "var(--accent-text)" }} /> : <Copy className="w-4 h-4" style={{ color: "var(--text-3)" }} />}</button>
                  {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline text-[13px]" style={{ color: "var(--text-2)" }}><MessageCircle className="w-4 h-4" aria-hidden />Abrir WhatsApp</a>}
                </span>
              )}
              <span className="inline-flex items-center gap-2" style={{ color: "var(--text-2)" }}>
                {ficha.corretor_nome ? <><AvatarDoCorretor id={ficha.corretor_id} nome={ficha.corretor_nome} tamanho={24} />{ficha.corretor_nome}</> : <span style={{ color: "var(--warn)" }}>Sem responsável</span>}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2 w-full sm:w-auto sm:min-w-[17rem]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COR_TEMP[ficha.temperatura] }} aria-hidden />
              <Seletor aria-label="Temperatura" value={ficha.temperatura} disabled={salvando} onChange={(e) => ajustar({ temperatura: e.target.value })}><option value="quente">Quente</option><option value="morno">Morno</option><option value="frio">Frio</option></Seletor>
            </div>
            <div className="flex gap-2">
              <Seletor aria-label="Atribuir este cliente a" value={destino} onChange={(e) => setDestino(e.target.value)}><option value="">{ficha.corretor_nome ? "Passar para…" : "Atribuir a…"}</option>{corretores.filter((c) => c.id !== ficha.corretor_id).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Seletor>
              <Botao variante="primario" onClick={atribuir} disabled={!destino} carregando={atribuindo}>Atribuir</Botao>
            </div>
          </div>
        </div>
        {erro && <div className="mt-3"><Aviso tom="erro">{erro}</Aviso></div>}
      </header>

      <nav className="mb-5 overflow-x-auto" role="tablist" aria-label="Seções do cliente">
        <div className="flex gap-1 w-max sm:w-auto" style={{ borderBottom: "1px solid var(--line)" }}>
          {abas.map((a) => (
            <button key={a.id} role="tab" aria-selected={aba === a.id} onClick={() => setAba(a.id)} className="px-3.5 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px" style={{ borderColor: aba === a.id ? "var(--accent)" : "transparent", color: aba === a.id ? "var(--text)" : "var(--text-3)", fontWeight: aba === a.id ? 600 : 400 }}>
              {a.rotulo}{a.n ? <span className="ml-1.5 text-[11px] tabular-nums" style={{ color: "var(--text-4)" }}>{a.n}</span> : null}
            </button>
          ))}
        </div>
      </nav>

      <div role="tabpanel">
        {aba === "geral" && <MetricasLead ficha={ficha} tempo={tempo} onAba={(x) => setAba(x as Aba)} />}
        {aba === "tempo" && (
          <Painel>
            {tempo ? <LinhaDoTempo eventos={tempo.eventos} resumo={tempo.resumo} limite={limite} onCarregarMais={limite < LIMITE_MAXIMO ? carregarMais : undefined} carregandoMais={maisCarregando} /> : <p className="text-sm" style={{ color: "var(--text-3)" }}>Montando a linha do tempo…</p>}
          </Painel>
        )}
        {aba === "imoview" && (ficha.atendimentos?.length ? <AtendimentosImoview atendimentos={ficha.atendimentos} /> : <Painel><Vazio texto="Este cliente ainda não tem atendimento lido do Imoview." /></Painel>)}
        {aba === "imoveis" && <ImoveisLead atendimentos={ficha.atendimentos ?? []} match={match} imovelDoNegocio={neg?.imovel_codigo} />}
        {aba === "conversa" && (tempo ? <ConversaLead eventos={tempo.eventos} resumo={tempo.resumo} /> : <p className="text-sm" style={{ color: "var(--text-3)" }}>Carregando…</p>)}
        {aba === "agenda" && <AgendaLead atividades={ficha.atividades} />}
        {aba === "fluxo" && <FluxoLead negocios={ficha.negocios} historico={ficha.historico} onAbrirNegocio={setPopupId} />}
        {aba === "cadastro" && <CadastroLead ficha={ficha} obs={obs} onObs={setObs} onSalvarObs={() => ajustar({ observacoes: obs })} salvando={salvando} />}
      </div>

      {popupId && <PopupNegocio negocioId={popupId} onFechar={() => setPopupId(null)} onMudou={() => { carregarFicha(); carregarTempo(limite); onMudou?.(); }} onAuthError={onAuthError} />}
    </div>
  );
}
