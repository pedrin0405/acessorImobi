"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, Home, MessageCircle, RefreshCw, UserX, XCircle } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { brl } from "@/lib/crm";
import AvatarCorretor from "@/components/corretor/AvatarCorretor";

interface Dados {
  periodo: { dias: number; bucket: "day" | "week" | "month" };
  imobiliaria: string;
  assistente: {
    corretores_ativos: number; corretores_pendentes: number; corretores_usando: number;
    mensagens: number; mensagens_antes: number; respostas: number; audios: number; resposta_media_s: number | null;
  };
  clientes: {
    total: number; sem_responsavel: number; novos: number; novos_antes: number; viraram_cliente: number; negocios_ganhos: number;
    origens: { origem: string; n: number }[]; temperaturas: Record<string, number>; funil: { etapa: string; cor: string; n: number }[];
  };
  espera: { total: number; itens: { id: string; nome: string | null; corretor: string | null; desde: string | null }[] };
  agenda: { atrasadas: number; proximas: number; concluidas: number; visitas_feitas: number; visitas_marcadas: number };
  imoveis: { total: number; ativos: number; venda: number; aluguel: number; destaques: number; indicados: { codigo: number; vezes: number; tipo: string | null; bairro: string | null; valor: number | null }[] };
  serie: { dia: string; mensagens: number; clientes: number }[];
  ranking: { id: string; nome: string | null; mensagens: number; atividades: number; clientes: number; foto_url: string | null }[];
  integracoes: { whatsapp_agente: boolean; whatsapp_pessoais: number; imoview_configurado: boolean; imoview_ultima_sync: string | null; imoview_erro: string | null; pendencias_crm: number };
}

const PERIODOS: [number, string][] = [[7, "7 dias"], [30, "30 dias"], [90, "90 dias"], [365, "Ano"]];
const ORIGENS: Record<string, string> = { imoview: "Imoview", whatsapp: "WhatsApp", manual: "Manual", whatsapp_pessoal: "WhatsApp pessoal" };
const rotuloOrigem = (o: string) => ORIGENS[o] || (o.charAt(0).toUpperCase() + o.slice(1)).replace(/_/g, " ");
const n = (v: number) => v.toLocaleString("pt-BR");
const COR_ETAPA: Record<string, string> = { slate: "#94a3b8", blue: "#84b3c6", violet: "#a99ad1", amber: "#d2b277", orange: "#d29a77", sky: "#84b3c6", emerald: "#5cb98d", green: "#5cb98d", rose: "#d08070" };

function saudacao(): string {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}
function quandoCurto(iso: string | null): string {
  if (!iso) return "nunca";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  if (min < 1440) return `há ${Math.round(min / 60)} h`;
  return `há ${Math.round(min / 1440)} d`;
}
function variacao(atual: number, antes: number): string | null {
  if (antes <= 0) return null;
  const p = Math.round(((atual - antes) / antes) * 100);
  return `${p > 0 ? "+" : ""}${p}% sobre o período anterior`;
}

const cartao = { background: "var(--card)", border: "1px solid var(--line)" } as const;

function Cartao({ rotulo, titulo, direita, children, className = "" }: { rotulo?: string; titulo: string; direita?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl p-5 ${className}`} style={cartao}>
      <header className="flex items-start justify-between gap-3 mb-4">
        <div>
          {rotulo && <p className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-4)" }}>{rotulo}</p>}
          <h2 className="text-base font-medium mt-0.5" style={{ color: "var(--text)" }}>{titulo}</h2>
        </div>
        {direita}
      </header>
      {children}
    </section>
  );
}

function Indicador({ rotulo, valor, detalhe, extra }: { rotulo: string; valor: string; detalhe: string; extra?: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-4 sm:p-5 flex flex-col min-w-0" style={cartao}>
      <p className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-4)" }}>{rotulo}</p>
      <div className="flex items-end justify-between gap-3 mt-3 min-w-0">
        <p className="text-[26px] sm:text-[32px] leading-none font-light tracking-tight tabular-nums" style={{ color: "var(--text)" }}>{valor}</p>
        {extra}
      </div>
      <p className="text-xs mt-3" style={{ color: "var(--text-3)" }}>{detalhe}</p>
    </div>
  );
}

function Minigrafico({ pontos, cor }: { pontos: number[]; cor: string }) {
  const max = Math.max(...pontos, 1);
  const w = 96, h = 32;
  const d = pontos.map((v, i) => `${(i / Math.max(pontos.length - 1, 1)) * w},${h - 2 - (v / max) * (h - 4)}`).join(" ");
  if (pontos.every((v) => v === 0)) return <svg width={w} height={h} aria-hidden className="hidden sm:block"><line x1="0" x2={w} y1={h - 2} y2={h - 2} stroke="var(--line-2)" strokeWidth="1.5" /></svg>;
  return <svg width={w} height={h} aria-hidden className="hidden sm:block"><polyline points={d} fill="none" stroke={cor} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

function GraficoAtendimento({ serie, bucket }: { serie: Dados["serie"]; bucket: string }) {
  const W = 760, H = 220, PL = 36, PB = 26, PT = 10, PR = 8;
  const max = Math.max(...serie.flatMap((s) => [s.mensagens, s.clientes]), 1);
  const topo = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const x = (i: number) => PL + (i / Math.max(serie.length - 1, 1)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - v / topo) * (H - PT - PB);
  const linha = (k: "mensagens" | "clientes") => serie.map((s, i) => `${x(i)},${y(s[k])}`).join(" ");
  const area = `${PL},${y(0)} ${linha("mensagens")} ${x(serie.length - 1)},${y(0)}`;
  const rot = (iso: string) => {
    const d = new Date(iso + "T12:00:00");
    return bucket === "month" ? d.toLocaleDateString("pt-BR", { month: "short" }) : d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
  };
  const marcas = serie.length <= 8 ? serie.map((_, i) => i) : [0, Math.round((serie.length - 1) / 4), Math.round((serie.length - 1) / 2), Math.round(((serie.length - 1) * 3) / 4), serie.length - 1];
  const sem = serie.every((s) => s.mensagens === 0 && s.clientes === 0);
  return (
    <div>
      <div className="flex gap-4 text-xs mb-2" style={{ color: "var(--text-3)" }}>
        <span className="flex items-center gap-1.5"><i className="w-2.5 h-0.5 rounded" style={{ background: "var(--accent)" }} /> Mensagens dos corretores à IA</span>
        <span className="flex items-center gap-1.5"><i className="w-2.5 h-0.5 rounded" style={{ background: "var(--info)" }} /> Clientes novos</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Mensagens e clientes novos ao longo do período">
        {[0, 1, 2, 3, 4].map((i) => {
          const v = (topo / 4) * i;
          return <g key={i}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={i ? "2 4" : undefined} /><text x={PL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--text-4)">{v}</text></g>;
        })}
        {!sem && <polygon points={area} fill="var(--accent)" opacity="0.1" />}
        {!sem && <polyline points={linha("mensagens")} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />}
        {!sem && <polyline points={linha("clientes")} fill="none" stroke="var(--info)" strokeWidth="2" strokeLinejoin="round" />}
        {marcas.map((i) => <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === serie.length - 1 ? "end" : "middle"} fontSize="11" fill="var(--text-4)">{rot(serie[i].dia)}</text>)}
        {sem && <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="13" fill="var(--text-3)">Sem atividade neste período.</text>}
      </svg>
    </div>
  );
}

function Barra({ rotulo, valor, max, cor, sufixo }: { rotulo: string; valor: number; max: number; cor: string; sufixo?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,9.5rem)_1fr_auto] items-center gap-3 text-sm">
      <span className="truncate flex items-center gap-2" style={{ color: "var(--text-2)" }}><i className="w-2 h-2 rounded-full shrink-0" style={{ background: cor }} />{rotulo}</span>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--card-2)" }}><div className="h-full rounded-full" style={{ width: `${max ? (valor / max) * 100 : 0}%`, background: cor }} /></div>
      <span className="tabular-nums text-xs text-right min-w-[3.5rem]" style={{ color: "var(--text-3)" }}>{n(valor)}{sufixo}</span>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <p className="text-sm py-6 text-center" style={{ color: "var(--text-3)" }}>{texto}</p>;
}

export default function VisaoGeral({ onAuthError, onIr }: { onAuthError: (e: unknown) => boolean; onIr?: (tab: string) => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [dias, setDias] = useState(30);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [espera, setEspera] = useState(false);
  const requisicao = useRef(0);
  const autenticacao = useRef(onAuthError);
  autenticacao.current = onAuthError;

  const carregar = useCallback(async () => {
    const minha = ++requisicao.current;
    setCarregando(true);
    try {
      const res = await fetchApi(`/admin/visao-geral?dias=${dias}`);
      if (minha !== requisicao.current) return;
      if (!res.ok) throw new Error("falha");
      setDados(await res.json()); setErro(null);
    } catch (e) {
      if (!autenticacao.current(e)) setErro("Não foi possível carregar os indicadores agora.");
    } finally {
      if (minha === requisicao.current) setCarregando(false);
    }
  }, [dias]);
  useEffect(() => { carregar(); }, [carregar]);

  const ir = (aba: string) => onIr?.(aba);
  const periodo = PERIODOS.find(([d]) => d === dias)?.[1].toLowerCase() || `${dias} dias`;
  const periodoCurto = dias === 365 ? "no ano" : `nos últimos ${dias} dias`;

  let corpo: React.ReactNode = null;
  if (dados) {
    const a = dados.assistente, c = dados.clientes, ag = dados.agenda, im = dados.imoveis, it = dados.integracoes;
    const funilMax = Math.max(...c.funil.map((f) => f.n), 1);
    const origemMax = Math.max(...c.origens.map((o) => o.n), 1);
    const rankMax = Math.max(...dados.ranking.map((r) => r.mensagens + r.atividades), 1);
    const atencao: { chave: string; icone: React.ReactNode; texto: string; aba?: string; tom: string }[] = [];
    if (dados.espera.total > 0) atencao.push({ chave: "espera", icone: <MessageCircle className="w-4 h-4" aria-hidden />, texto: `${n(dados.espera.total)} ${dados.espera.total === 1 ? "conversa esperando" : "conversas esperando"} resposta do corretor`, aba: "conversas", tom: "var(--warn)" });
    if (c.sem_responsavel > 0) atencao.push({ chave: "sem", icone: <UserX className="w-4 h-4" aria-hidden />, texto: `${n(c.sem_responsavel)} ${c.sem_responsavel === 1 ? "cliente" : "clientes"} sem responsável`, aba: "leads", tom: "var(--warn)" });
    if (ag.atrasadas > 0) atencao.push({ chave: "atraso", icone: <CalendarClock className="w-4 h-4" aria-hidden />, texto: `${n(ag.atrasadas)} ${ag.atrasadas === 1 ? "atividade atrasada" : "atividades atrasadas"} na agenda`, aba: "agenda", tom: "var(--danger)" });
    if (a.corretores_pendentes > 0) atencao.push({ chave: "pend", icone: <AlertTriangle className="w-4 h-4" aria-hidden />, texto: `${n(a.corretores_pendentes)} ${a.corretores_pendentes === 1 ? "corretor aguardando" : "corretores aguardando"} aprovação`, aba: "corretores", tom: "var(--warn)" });
    if (it.imoview_erro) atencao.push({ chave: "imoview", icone: <XCircle className="w-4 h-4" aria-hidden />, texto: "A sincronização com o Imoview falhou na última tentativa", aba: "configuracoes", tom: "var(--danger)" });
    if (it.pendencias_crm > 0) atencao.push({ chave: "crm", icone: <AlertTriangle className="w-4 h-4" aria-hidden />, texto: `${n(it.pendencias_crm)} ${it.pendencias_crm === 1 ? "pendência" : "pendências"} de CRM sem resolver`, aba: "pendencias", tom: "var(--warn)" });

    corpo = (
      <>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
          <Indicador rotulo="Conversas com a IA" valor={n(a.mensagens)} detalhe={variacao(a.mensagens, a.mensagens_antes) || `Mensagens dos corretores ${periodoCurto}`}
            extra={<Minigrafico pontos={dados.serie.map((s) => s.mensagens)} cor="var(--accent)" />} />
          <Indicador rotulo="Corretores usando" valor={`${n(a.corretores_usando)} de ${n(a.corretores_ativos)}`} detalhe={a.corretores_ativos === 0 ? "Nenhum corretor ativo ainda" : `Ativos que falaram com o Acessor ${periodoCurto}`} />
          <Indicador rotulo="Clientes novos" valor={n(c.novos)} detalhe={variacao(c.novos, c.novos_antes) || `${n(c.total)} na carteira, ${n(c.sem_responsavel)} sem responsável`}
            extra={<Minigrafico pontos={dados.serie.map((s) => s.clientes)} cor="var(--info)" />} />
          <Indicador rotulo="Resposta da IA" valor={a.resposta_media_s === null ? "—" : `${a.resposta_media_s.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`} detalhe={a.resposta_media_s === null ? "Ainda sem respostas medidas" : `Tempo médio por resposta · ${n(a.respostas)} respostas, ${n(a.audios)} áudios`} />
        </div>

        <section className="rounded-2xl p-5" style={cartao} aria-label="Pede atenção">
          <p className="text-[11px] uppercase tracking-[0.08em] flex items-center gap-2" style={{ color: "var(--text-4)" }}>
            <i className="w-1.5 h-1.5 rounded-full" style={{ background: atencao.length ? "var(--warn)" : "var(--accent)" }} /> Pede atenção
          </p>
          {atencao.length === 0 ? (
            <p className="mt-3 text-sm flex items-center gap-2" style={{ color: "var(--text-2)" }}><CheckCircle2 className="w-4 h-4" style={{ color: "var(--accent)" }} aria-hidden /> Tudo em dia: nada esperando, sem atrasos e integrações funcionando.</p>
          ) : (
            <ul className="mt-3 grid md:grid-cols-2 gap-x-6">
              {atencao.map((x) => (
                <li key={x.chave}>
                  <button type="button" onClick={() => (x.chave === "espera" ? setEspera((v) => !v) : x.aba && ir(x.aba))} className="w-full flex items-center gap-3 py-2.5 text-left text-sm rounded-lg hover:bg-[var(--hover-solid)] px-2 -mx-2">
                    <span style={{ color: x.tom }}>{x.icone}</span>
                    <span className="flex-1" style={{ color: "var(--text-2)" }}>{x.texto}</span>
                    <ChevronRight className={`w-4 h-4 transition-transform ${x.chave === "espera" && espera ? "rotate-90" : ""}`} style={{ color: "var(--text-4)" }} aria-hidden />
                  </button>
                  {x.chave === "espera" && espera && (
                    <ul className="pb-2 pl-9 space-y-1 text-[13px] assist-fade" style={{ color: "var(--text-3)" }}>
                      {dados.espera.itens.map((e) => <li key={e.id}>{e.nome || "Contato sem nome"}{e.corretor ? ` · com ${e.corretor}` : ""}{e.desde ? ` · cliente escreveu ${quandoCurto(e.desde)}` : ""}</li>)}
                      <li><button type="button" className="underline underline-offset-2" style={{ color: "var(--accent-text)" }} onClick={() => ir("conversas")}>Abrir conversas</button></li>
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)] gap-4 items-start">
          <div className="space-y-4 min-w-0">
            <Cartao rotulo="Atendimento" titulo="Movimento no período" direita={<span className="text-xs" style={{ color: "var(--text-3)" }}>{n(a.mensagens)} mensagens · {n(c.novos)} clientes novos</span>}>
              <GraficoAtendimento serie={dados.serie} bucket={dados.periodo.bucket} />
            </Cartao>

            <Cartao rotulo="Clientes" titulo="Funil de atendimento" direita={<span className="text-xs" style={{ color: "var(--text-3)" }}>{n(c.funil.reduce((s, f) => s + f.n, 0))} negócios abertos</span>}>
              {c.funil.every((f) => f.n === 0) ? <Vazio texto="Nenhum cliente em acompanhamento nas etapas ainda." /> : (
                <div className="space-y-3">{c.funil.map((f) => <Barra key={f.etapa} rotulo={f.etapa} valor={f.n} max={funilMax} cor={COR_ETAPA[f.cor] || "var(--accent)"} />)}</div>
              )}
              <div className="flex flex-wrap gap-x-6 gap-y-1 mt-5 pt-4 text-sm" style={{ borderTop: "1px solid var(--line)", color: "var(--text-3)" }}>
                <span>Temperatura da carteira:</span>
                {([["quente", "var(--danger)"], ["morno", "var(--warn)"], ["frio", "var(--info)"]] as const).map(([t, cor]) => (
                  <span key={t} className="flex items-center gap-1.5" style={{ color: "var(--text-2)" }}><i className="w-2 h-2 rounded-full" style={{ background: cor }} />{n(c.temperaturas[t] || 0)} {t === "quente" ? "quentes" : t === "morno" ? "mornos" : "frios"}</span>
                ))}
              </div>
            </Cartao>

            <div className="grid md:grid-cols-2 gap-4">
              <Cartao rotulo="Agenda" titulo="Compromissos">
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  {([["Próximos 7 dias", ag.proximas, ""], ["Atrasadas", ag.atrasadas, ag.atrasadas ? "var(--danger)" : ""], [`Concluídas ${periodoCurto}`, ag.concluidas, ""], ["Visitas feitas", ag.visitas_feitas, ""]] as const).map(([r, v, cor]) => (
                        <div key={r}><dt className="text-xs" style={{ color: "var(--text-3)" }}>{r}</dt><dd className="text-2xl font-light tabular-nums mt-1" style={{ color: cor || "var(--text)" }}>{n(v)}</dd></div>
                  ))}
                </dl>
                <p className="text-xs mt-4" style={{ color: "var(--text-3)" }}>{ag.visitas_marcadas ? `${n(ag.visitas_marcadas)} ${ag.visitas_marcadas === 1 ? "visita marcada" : "visitas marcadas"} pela frente.` : "Nenhuma visita marcada pela frente."}</p>
              </Cartao>

              <Cartao rotulo="Aquisição" titulo="Origem dos clientes" direita={<span className="text-xs" style={{ color: "var(--text-3)" }}>{n(c.novos)} {periodoCurto}</span>}>
                {c.origens.length === 0 ? <Vazio texto="Nenhum cliente novo neste período." /> : (
                  <div className="space-y-3">{c.origens.map((o) => <Barra key={o.origem} rotulo={rotuloOrigem(o.origem)} valor={o.n} max={origemMax} cor="var(--accent)" sufixo={` · ${Math.round((o.n / Math.max(c.novos, 1)) * 100)}%`} />)}</div>
                )}
              </Cartao>
            </div>
          </div>

          <div className="space-y-4 min-w-0">
            <Cartao rotulo="Equipe" titulo="Corretores" direita={<button type="button" onClick={() => ir("corretores")} className="text-xs underline underline-offset-2" style={{ color: "var(--text-3)" }}>Ver todos</button>}>
              {dados.ranking.length === 0 ? <Vazio texto="Nenhum corretor ativo ainda." /> : (
                <ul className="space-y-4">
                  {dados.ranking.map((r) => (
                    <li key={r.id} className="flex items-center gap-3">
                      <AvatarCorretor nome={r.nome} fotoUrl={r.foto_url} tamanho={36} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate" style={{ color: "var(--text)" }}>{r.nome || "Sem nome"}</p>
                        <div className="h-1 rounded-full overflow-hidden mt-1.5" style={{ background: "var(--card-2)" }}><div className="h-full rounded-full" style={{ width: `${((r.mensagens + r.atividades) / rankMax) * 100}%`, background: "var(--accent)" }} /></div>
                      </div>
                      <p className="text-xs text-right tabular-nums leading-relaxed" style={{ color: "var(--text-3)" }}>{n(r.mensagens)} msgs<br />{n(r.atividades)} ativ. · {n(r.clientes)} cli.</p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs mt-4 pt-3" style={{ color: "var(--text-4)", borderTop: "1px solid var(--line)" }}>Mensagens à IA e atividades concluídas {periodoCurto}; clientes na carteira de cada um.</p>
            </Cartao>

            <Cartao rotulo="Carteira" titulo="Imóveis" direita={<button type="button" onClick={() => ir("imoveis")} className="text-xs underline underline-offset-2" style={{ color: "var(--text-3)" }}>Abrir</button>}>
              {im.total === 0 ? <Vazio texto="Nenhum imóvel na carteira. Conecte o Imoview em Configurações." /> : (
                <>
                  <p className="text-3xl font-light tabular-nums" style={{ color: "var(--text)" }}>{n(im.ativos)} <span className="text-sm" style={{ color: "var(--text-3)" }}>ativos</span></p>
                  <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>{n(im.venda)} à venda · {n(im.aluguel)} para alugar · {n(im.destaques)} em destaque</p>
                  <h3 className="text-xs uppercase tracking-[0.08em] mt-5 mb-2" style={{ color: "var(--text-4)" }}>Mais indicados {periodoCurto}</h3>
                  {im.indicados.length === 0 ? <p className="text-sm" style={{ color: "var(--text-3)" }}>Nenhum imóvel foi indicado a clientes neste período.</p> : (
                    <ul className="space-y-2">
                      {im.indicados.map((i) => (
                        <li key={i.codigo} className="flex items-center gap-3 text-sm">
                          <Home className="w-4 h-4 shrink-0" style={{ color: "var(--text-4)" }} aria-hidden />
                          <span className="flex-1 truncate" style={{ color: "var(--text-2)" }}>{[i.tipo, i.bairro].filter(Boolean).join(" · ") || `Código ${i.codigo}`}{i.valor ? ` · ${brl(i.valor)}` : ""}</span>
                          <span className="text-xs tabular-nums" style={{ color: "var(--text-3)" }}>{n(i.vezes)}×</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </Cartao>

            <Cartao rotulo="Sistema" titulo="Integrações">
              <ul className="space-y-3 text-sm">
                {([
                  ["WhatsApp do agente", it.whatsapp_agente, it.whatsapp_agente ? "Conectado" : "Desconectado"],
                  ["WhatsApp pessoal dos corretores", it.whatsapp_pessoais > 0, `${n(it.whatsapp_pessoais)} ${it.whatsapp_pessoais === 1 ? "conectado" : "conectados"}`],
                  ["Imoview", it.imoview_configurado && !it.imoview_erro, !it.imoview_configurado ? "Não configurado" : it.imoview_erro ? "Falhou na última vez" : `Sincronizado ${quandoCurto(it.imoview_ultima_sync)}`],
                ] as [string, boolean, string][]).map(([nome, ok, rot]) => (
                  <li key={nome} className="flex items-center gap-3">
                    <i className="w-2 h-2 rounded-full shrink-0" style={{ background: ok ? "var(--accent)" : "var(--warn)" }} />
                    <span className="flex-1" style={{ color: "var(--text-2)" }}>{nome}</span>
                    <span className="text-xs" style={{ color: "var(--text-3)" }}>{rot}</span>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => ir("configuracoes")} className="text-xs underline underline-offset-2 mt-4" style={{ color: "var(--text-3)" }}>Ajustar em Configurações</button>
            </Cartao>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--text)" }}>{saudacao()}{dados?.imobiliaria ? `, ${dados.imobiliaria}` : ""}</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-3)" }}>
            {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }).replace(/^./, (l) => l.toUpperCase())}
            {dados && <> · {n(dados.clientes.novos)} {dados.clientes.novos === 1 ? "cliente novo" : "clientes novos"} · {n(dados.assistente.mensagens)} mensagens à IA {periodoCurto}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Período" className="flex p-1 rounded-full" style={cartao}>
            {PERIODOS.map(([d, r]) => (
              <button key={d} type="button" aria-pressed={dias === d} onClick={() => setDias(d)} className="h-8 px-3 sm:px-3.5 rounded-full text-[13px] whitespace-nowrap transition-colors" style={{ background: dias === d ? "var(--hover-solid)" : "transparent", color: dias === d ? "var(--text)" : "var(--text-3)" }}>{r}</button>
            ))}
          </div>
          <button type="button" onClick={carregar} className="flex items-center gap-2 h-10 px-4 rounded-full text-sm" style={{ border: "1px solid var(--line)", color: "var(--text-2)" }}>
            <RefreshCw className={`w-4 h-4 ${carregando ? "animate-spin" : ""}`} aria-hidden /> Atualizar
          </button>
        </div>
      </header>
      {erro && <p role="alert" className="text-sm rounded-xl px-4 py-3" style={{ background: "var(--card)", border: "1px solid var(--line)", color: "var(--danger)" }}>{erro}</p>}
      {!dados && !erro && <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" aria-hidden>{[0, 1, 2, 3].map((i) => <div key={i} className="h-[138px] rounded-2xl animate-pulse" style={{ background: "var(--card)" }} />)}</div>}
      <div style={{ opacity: carregando && dados ? 0.6 : 1, transition: "opacity .15s" }} className="space-y-4" aria-busy={carregando}>{corpo}</div>
      <span className="sr-only">Período: {periodo}</span>
    </div>
  );
}
