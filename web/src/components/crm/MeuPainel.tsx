"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, CheckCircle2, ChevronRight, Flame, MessageCircle, RefreshCw, Timer } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { brl } from "@/lib/crm";

interface Dados {
  periodo_dias: number;
  corretor: string | null;
  imobiliaria: string;
  carteira: { total: number; quentes: number; mornos: number; frios: number; novos: number };
  funil: { etapa: string; cor: string; quantidade: number; total: number; esperado: number }[];
  negocios: { abertos: number; valor_aberto: number; valor_esperado: number; ganhos: number; valor_ganho: number; perdidos: number };
  agenda: { hoje: number; atrasadas: number; semana: number; concluidas: number };
  proximas_atividades: { id: string; tipo: string; titulo: string; inicio: string | null; cliente: string | null }[];
  aguardando_resposta: { id: string; nome: string | null; desde: string | null }[];
  mensagens: { enviadas_ao_agente: number; respostas: number };
  clientes_quentes: { id: string; nome: string; telefone: string | null; ultimo_contato: string | null }[];
  negocios_travados: { id: string; nome: string; etapa: string; valor: number; dias: number }[];
}

const PERIODOS: [number, string][] = [[7, "7 dias"], [30, "30 dias"], [90, "90 dias"], [365, "Ano"]];
const COR_ETAPA: Record<string, string> = { slate: "#94a3b8", blue: "#84b3c6", violet: "#a99ad1", amber: "#d2b277", orange: "#d29a77", sky: "#84b3c6", emerald: "#5cb98d", green: "#5cb98d", rose: "#d08070" };
const n = (v: number) => v.toLocaleString("pt-BR");
const cartao = { background: "var(--card)", border: "1px solid var(--line)" } as const;

const saudacao = () => {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
};
const quando = (iso: string | null) => {
  if (!iso) return "sem data";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `há ${Math.max(1, min)} min`;
  if (min < 1440) return `há ${Math.round(min / 60)} h`;
  return `há ${Math.round(min / 1440)} d`;
};
const dataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "sem data";

function Cartao({ titulo, direita, children, className = "" }: { titulo: string; direita?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl p-5 ${className}`} style={cartao}>
      <header className="flex items-start justify-between gap-3 mb-4">
        <h2 className="text-base font-medium" style={{ color: "var(--text)" }}>{titulo}</h2>
        {direita}
      </header>
      {children}
    </section>
  );
}

function Indicador({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe: string }) {
  return (
    <div className="rounded-2xl p-4 sm:p-5 flex flex-col min-w-0" style={cartao}>
      <p className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-4)" }}>{rotulo}</p>
      <p className="text-[26px] sm:text-[32px] leading-none font-light tracking-tight tabular-nums mt-3" style={{ color: "var(--text)" }}>{valor}</p>
      <p className="text-xs mt-3" style={{ color: "var(--text-3)" }}>{detalhe}</p>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <p className="text-sm py-4 text-center" style={{ color: "var(--text-3)" }}>{texto}</p>;
}

/** Painel pessoal do corretor: primeiro o que pede ação agora, depois os números da carteira e do funil dele. */
export default function MeuPainel({ onAuthError, onIr }: { onAuthError: (e: unknown) => boolean; onIr?: (tab: string) => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [dias, setDias] = useState(30);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const requisicao = useRef(0);
  const autenticacao = useRef(onAuthError);
  autenticacao.current = onAuthError;

  const carregar = useCallback(async () => {
    const minha = ++requisicao.current;
    setCarregando(true);
    try {
      const res = await fetchApi(`/admin/visao-geral/meu?dias=${dias}`);
      if (minha !== requisicao.current) return;
      if (!res.ok) throw new Error("falha");
      setDados(await res.json());
      setErro(null);
    } catch (e) {
      if (!autenticacao.current(e)) setErro("Não foi possível carregar o seu painel agora.");
    } finally {
      if (minha === requisicao.current) setCarregando(false);
    }
  }, [dias]);
  useEffect(() => { carregar(); }, [carregar]);

  const ir = (aba: string) => onIr?.(aba);
  const periodoCurto = dias === 365 ? "no ano" : `nos últimos ${dias} dias`;

  let corpo: React.ReactNode = null;
  if (dados) {
    const { agenda: ag, negocios: ng, carteira: ct } = dados;
    const funilMax = Math.max(...dados.funil.map((f) => f.quantidade), 1);
    const tudoEmDia = ag.atrasadas === 0 && dados.aguardando_resposta.length === 0 && dados.negocios_travados.length === 0;
    corpo = (
      <>
        <section className="rounded-2xl p-5" style={cartao} aria-label="O que fazer agora">
          <p className="text-[11px] uppercase tracking-[0.08em] flex items-center gap-2" style={{ color: "var(--text-4)" }}>
            <i className="w-1.5 h-1.5 rounded-full" style={{ background: tudoEmDia ? "var(--accent)" : "var(--warn)" }} /> O que fazer agora
          </p>
          {tudoEmDia ? (
            <p className="mt-3 text-sm flex items-center gap-2" style={{ color: "var(--text-2)" }}>
              <CheckCircle2 className="w-4 h-4" style={{ color: "var(--accent)" }} aria-hidden /> Tudo em dia: ninguém esperando resposta, sem atrasos e sem negócio parado.
            </p>
          ) : (
            <ul className="mt-3 grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {dados.aguardando_resposta.length > 0 && (
                <li><button type="button" onClick={() => ir("atendimentos")} className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-2)" }}>
                  <MessageCircle className="w-4 h-4 shrink-0" style={{ color: "var(--warn)" }} aria-hidden />
                  <span className="flex-1">{n(dados.aguardando_resposta.length)} {dados.aguardando_resposta.length === 1 ? "cliente esperando" : "clientes esperando"} sua resposta</span>
                  <ChevronRight className="w-4 h-4" aria-hidden />
                </button></li>
              )}
              {ag.atrasadas > 0 && (
                <li><button type="button" onClick={() => ir("agenda")} className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-2)" }}>
                  <CalendarClock className="w-4 h-4 shrink-0" style={{ color: "var(--danger)" }} aria-hidden />
                  <span className="flex-1">{n(ag.atrasadas)} {ag.atrasadas === 1 ? "atividade atrasada" : "atividades atrasadas"}</span>
                  <ChevronRight className="w-4 h-4" aria-hidden />
                </button></li>
              )}
              {dados.negocios_travados.length > 0 && (
                <li><button type="button" onClick={() => ir("negociacoes")} className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-2)" }}>
                  <Timer className="w-4 h-4 shrink-0" style={{ color: "var(--warn)" }} aria-hidden />
                  <span className="flex-1">{n(dados.negocios_travados.length)} {dados.negocios_travados.length === 1 ? "negócio parado" : "negócios parados"} além do prazo</span>
                  <ChevronRight className="w-4 h-4" aria-hidden />
                </button></li>
              )}
            </ul>
          )}
        </section>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
          <Indicador rotulo="Negócios abertos" valor={n(ng.abertos)} detalhe={ng.valor_aberto > 0 ? `${brl(ng.valor_aberto)} no funil` : "Sem valor informado ainda"} />
          <Indicador rotulo="Previsão" valor={ng.valor_esperado > 0 ? brl(ng.valor_esperado) : "—"} detalhe="Valor × probabilidade de cada etapa" />
          <Indicador rotulo="Ganhos" valor={n(ng.ganhos)} detalhe={ng.ganhos > 0 ? `${brl(ng.valor_ganho)} ${periodoCurto}` : `Nenhum ${periodoCurto}`} />
          <Indicador rotulo="Clientes" valor={n(ct.total)} detalhe={`${n(ct.quentes)} quentes · ${n(ct.novos)} ${ct.novos === 1 ? "novo" : "novos"} ${periodoCurto}`} />
        </div>

        <div className="grid lg:grid-cols-5 gap-4">
          <Cartao titulo="Meu funil" className="lg:col-span-3" direita={<button type="button" onClick={() => ir("negociacoes")} className="text-xs underline underline-offset-2" style={{ color: "var(--text-3)" }}>Abrir o Fluxo</button>}>
            {dados.funil.every((f) => f.quantidade === 0) ? <Vazio texto="Você ainda não tem negócios abertos." /> : (
              <ul className="space-y-3">
                {dados.funil.map((f) => (
                  <li key={f.etapa} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
                    <span className="truncate flex items-center gap-2" style={{ color: "var(--text-2)" }}><i className="w-2 h-2 rounded-full shrink-0" style={{ background: COR_ETAPA[f.cor] || "var(--text-4)" }} />{f.etapa}</span>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--card-2)" }}><div className="h-full rounded-full" style={{ width: `${(f.quantidade / funilMax) * 100}%`, background: COR_ETAPA[f.cor] || "var(--accent)" }} /></div>
                    <span className="tabular-nums text-xs text-right min-w-[5.5rem]" style={{ color: "var(--text-3)" }}>{n(f.quantidade)}{f.total > 0 ? ` · ${brl(f.total)}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>

          <Cartao titulo="Agenda" className="lg:col-span-2" direita={<button type="button" onClick={() => ir("agenda")} className="text-xs underline underline-offset-2" style={{ color: "var(--text-3)" }}>Abrir agenda</button>}>
            <p className="text-xs mb-3" style={{ color: "var(--text-3)" }}>{n(ag.hoje)} hoje · {n(ag.semana)} nos próximos 7 dias · {n(ag.concluidas)} concluídas {periodoCurto}</p>
            {dados.proximas_atividades.length === 0 ? <Vazio texto="Nenhum compromisso em aberto." /> : (
              <ul className="space-y-2.5">
                {dados.proximas_atividades.map((a) => (
                  <li key={a.id} className="text-sm">
                    <p className="truncate" style={{ color: "var(--text)" }}>{a.titulo}</p>
                    <p className="text-xs" style={{ color: "var(--text-3)" }}>{dataHora(a.inicio)}{a.cliente ? ` · ${a.cliente}` : ""}</p>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          <Cartao titulo="Clientes quentes" direita={<Flame className="w-4 h-4" style={{ color: "var(--warn)" }} aria-hidden />}>
            {dados.clientes_quentes.length === 0 ? <Vazio texto="Nenhum cliente marcado como quente." /> : (
              <ul className="space-y-2.5">
                {dados.clientes_quentes.map((c) => (
                  <li key={c.id} className="text-sm flex items-center justify-between gap-3">
                    <span className="truncate" style={{ color: "var(--text)" }}>{c.nome}</span>
                    <span className="text-xs shrink-0" style={{ color: "var(--text-3)" }}>{c.ultimo_contato ? `contato ${quando(c.ultimo_contato)}` : "sem contato"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>

          <Cartao titulo="Esperando sua resposta">
            {dados.aguardando_resposta.length === 0 ? <Vazio texto="Ninguém esperando resposta." /> : (
              <ul className="space-y-2.5">
                {dados.aguardando_resposta.map((a) => (
                  <li key={a.id} className="text-sm flex items-center justify-between gap-3">
                    <span className="truncate" style={{ color: "var(--text)" }}>{a.nome || "Contato sem nome"}</span>
                    <span className="text-xs shrink-0" style={{ color: "var(--warn)" }}>{quando(a.desde)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>

          <Cartao titulo="Negócios parados">
            {dados.negocios_travados.length === 0 ? <Vazio texto="Nenhum negócio parado além do prazo." /> : (
              <ul className="space-y-2.5">
                {dados.negocios_travados.map((t) => (
                  <li key={t.id} className="text-sm">
                    <p className="truncate" style={{ color: "var(--text)" }}>{t.nome}</p>
                    <p className="text-xs" style={{ color: "var(--text-3)" }}>{t.etapa} há {t.dias} dias{t.valor > 0 ? ` · ${brl(t.valor)}` : ""}</p>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
        </div>

        <p className="text-xs" style={{ color: "var(--text-4)" }}>
          Você falou {n(dados.mensagens.enviadas_ao_agente)} {dados.mensagens.enviadas_ao_agente === 1 ? "vez" : "vezes"} com o Acessor {periodoCurto} e ele respondeu {n(dados.mensagens.respostas)}.
        </p>
      </>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--text)" }}>{saudacao()}{dados?.corretor ? `, ${dados.corretor.split(" ")[0]}` : ""}</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-3)" }}>
            {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }).replace(/^./, (l) => l.toUpperCase())}
            {dados?.imobiliaria ? ` · ${dados.imobiliaria}` : ""}
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
      {!dados && !erro && <div className="grid grid-cols-2 xl:grid-cols-4 gap-4" aria-hidden>{[0, 1, 2, 3].map((i) => <div key={i} className="h-[138px] rounded-2xl animate-pulse" style={{ background: "var(--card)" }} />)}</div>}
      <div style={{ opacity: carregando && dados ? 0.6 : 1, transition: "opacity .15s" }} className="space-y-4" aria-busy={carregando}>{corpo}</div>
    </div>
  );
}
