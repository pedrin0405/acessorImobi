"use client";

import AvatarDoCorretor from "@/components/corretor/AvatarDoCorretor";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, ExternalLink, Handshake, History, Loader2, Sparkles, Users, X } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { brl } from "@/lib/crm";
import type { MensagemChat } from "../ChatMensagens";
import ListaProcessos from "./ProcessoIA";

export type AbaDetalhes = "info" | "carteira" | "bot" | "ia";

export interface ResumoEstado {
  estado: "ocioso" | "carregando" | "ok" | "erro";
  texto: string;
}

interface Detalhes {
  corretor: { id: string; nome: string | null; telefone_mascarado: string; email: string | null; status: string; cadastrado_em: string | null };
  atendimento: {
    iniciado_em: string | null; ultima_em: string | null; mensagens: number; recebidas: number; enviadas: number;
    audios: number; fotos: number; fallbacks: number; da_equipe: number;
  };
  carteira: { id: string; nome: string; temperatura: string | null; perfil: string; negocios_abertos: number }[];
  negocios: { id: string; cliente: string; etapa: string; valor: number; dias: number; travado: boolean }[];
  negocios_abertos: number;
  atividades: { id: string; titulo: string; inicio: string | null; tipo: string | null; atrasada: boolean }[];
  acoes: { acao: string; descricao: string; origem: string; quando: string }[];
}

const ABAS: { id: AbaDetalhes; rotulo: string }[] = [
  { id: "info", rotulo: "Info" },
  { id: "carteira", rotulo: "Carteira" },
  { id: "bot", rotulo: "Bot" },
  { id: "ia", rotulo: "IA" },
];

const STATUS: Record<string, string> = { active: "Ativo", pending: "Pendente", blocked: "Bloqueado", rejected: "Recusado" };

export const dataHora = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} · ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
};

export const relativo = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  if (min < 60 * 24) return `há ${Math.floor(min / 60)} h`;
  return dataHora(iso);
};

export function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="py-3">
      <h4 className="px-1 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-4)" }}>{titulo}</h4>
      {children}
    </section>
  );
}

export function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-1 py-2.5 text-[13px]" style={{ borderTop: "1px solid var(--line)" }}>
      <span style={{ color: "var(--text-3)" }}>{rotulo}</span>
      <span className="text-right min-w-0 truncate" style={{ color: "var(--text)" }}>{valor}</span>
    </div>
  );
}

export const vazio = (texto: string) => <p className="px-1 py-6 text-center text-sm" style={{ color: "var(--text-3)" }}>{texto}</p>;

export const corTemperatura = (t: string | null) => (t === "quente" ? "var(--danger)" : t === "frio" ? "var(--info)" : "var(--warn)");

export default function PainelDetalhes({
  corretorId,
  nome,
  versao,
  mensagens,
  focoProcesso,
  aba,
  onAba,
  resumo,
  onGerarResumo,
  onFechar,
  onIr,
  onAuthError,
}: {
  corretorId: string;
  nome: string;
  versao: number;
  mensagens: MensagemChat[];
  focoProcesso: string | null;
  aba: AbaDetalhes;
  onAba: (a: AbaDetalhes) => void;
  resumo: ResumoEstado;
  onGerarResumo: () => void;
  onFechar: () => void;
  onIr: (tab: string) => void;
  onAuthError: (e: unknown) => boolean;
}) {
  const [dados, setDados] = useState<Detalhes | null>(null);
  const [erro, setErro] = useState(false);
  const abas = useRef<(HTMLButtonElement | null)[]>([]);

  const carregar = useCallback(async () => {
    try {
      const res = await fetchApi(`/admin/conversas/${corretorId}/detalhes`);
      if (!res.ok) throw new Error("falha");
      setDados(await res.json());
      setErro(false);
    } catch (e) {
      if (!onAuthError(e)) setErro(true);
    }
  }, [corretorId, onAuthError]);

  useEffect(() => {
    setDados(null);
  }, [corretorId]);

  useEffect(() => {
    carregar();
  }, [carregar, versao]);

  const teclarAba = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const prox = (i + (e.key === "ArrowRight" ? 1 : -1) + ABAS.length) % ABAS.length;
    onAba(ABAS[prox].id);
    abas.current[prox]?.focus();
  };

  const a = dados?.atendimento;
  const acoesRapidas = [
    { rotulo: "Carteira", icone: Users, destino: "leads" },
    { rotulo: "Agenda", icone: CalendarDays, destino: "agenda" },
    { rotulo: "Fluxo", icone: Handshake, destino: "negociacoes" },
    { rotulo: "Auditoria", icone: History, destino: "auditoria" },
  ];

  return (
    <aside className="h-full flex flex-col min-h-0" aria-label="Detalhes do corretor" style={{ background: "var(--sidebar)" }}>
      <header className="flex items-center justify-between px-5 h-[60px] shrink-0" style={{ borderBottom: "1px solid var(--line)" }}>
        <h2 className="text-[15px] font-semibold" style={{ color: "var(--text)" }}>Detalhes</h2>
        <button type="button" onClick={onFechar} aria-label="Fechar detalhes" className="p-2 -mr-2 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}>
          <X className="w-5 h-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pb-8">
        <div className="pt-6 flex flex-col items-center text-center">
          <AvatarDoCorretor id={corretorId} nome={nome} tamanho={96} />
          <h3 className="mt-3 text-lg font-semibold" style={{ color: "var(--text)" }}>{nome}</h3>
          <div className="mt-1 flex items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded-md" style={{ background: "var(--card-2)", color: "var(--text-3)" }}>Corretor</span>
            {dados && <span style={{ color: dados.corretor.status === "active" ? "var(--accent-text)" : "var(--warn)" }}>{STATUS[dados.corretor.status] || dados.corretor.status}</span>}
          </div>

          <ul className="mt-4 flex items-start justify-center gap-4">
            {acoesRapidas.map(({ rotulo, icone: Icone, destino }) => (
              <li key={rotulo}>
                <button type="button" onClick={() => onIr(destino)} className="group flex flex-col items-center gap-1.5">
                  <span className="w-10 h-10 rounded-full flex items-center justify-center transition-colors group-hover:bg-[var(--hover-solid)]" style={{ background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--text-2)" }}>
                    <Icone className="w-[18px] h-[18px]" aria-hidden />
                  </span>
                  <span className="text-[10.5px]" style={{ color: "var(--text-3)" }}>{rotulo}</span>
                </button>
              </li>
            ))}
          </ul>

          <button type="button" onClick={() => onIr("corretores")} className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] hover:bg-[var(--hover-solid)]" style={{ border: "1px solid var(--line-2)", color: "var(--text-2)" }}>
            <ExternalLink className="w-3.5 h-3.5" aria-hidden /> Abrir ficha
          </button>
        </div>

        <section className="mt-6 rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
          <h4 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Atendimento</h4>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>{a ? `Iniciado em ${dataHora(a.iniciado_em)}` : "Carregando…"}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-full" style={{ background: "var(--card-2)", color: "var(--text-3)" }}>Origem · <span style={{ color: "var(--text-2)" }}>WhatsApp</span></span>
            {a && <span className="px-2.5 py-1 rounded-full" style={{ background: "var(--card-2)", color: "var(--text-3)" }}>Mensagens · <span style={{ color: "var(--text-2)" }}>{a.mensagens}</span></span>}
          </div>
          <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--line)" }}>
            {resumo.estado === "ok" ? (
              <div className="assist-fade">
                <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-2)" }}>{resumo.texto}</p>
                <button type="button" onClick={onGerarResumo} className="mt-2 text-xs hover:underline" style={{ color: "var(--accent-text)" }}>Gerar de novo</button>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs leading-relaxed" style={{ color: resumo.estado === "erro" ? "var(--danger)" : "var(--text-3)" }}>
                  {resumo.estado === "erro" ? resumo.texto : "O que o corretor pediu, o que o agente fez e o que fazer a seguir."}
                </p>
                <button
                  type="button"
                  onClick={onGerarResumo}
                  disabled={resumo.estado === "carregando"}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium hover:bg-[var(--hover-solid)] disabled:opacity-60"
                  style={{ border: "1px solid var(--line-2)", color: "var(--text)" }}
                >
                  {resumo.estado === "carregando" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />}
                  Gerar resumo
                </button>
              </div>
            )}
          </div>
        </section>

        <div role="tablist" aria-label="Seções dos detalhes" className="mt-5 flex" style={{ borderBottom: "1px solid var(--line)" }}>
          {ABAS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => { abas.current[i] = el; }}
              role="tab"
              id={`aba-${t.id}`}
              aria-selected={aba === t.id}
              aria-controls={`painel-${t.id}`}
              tabIndex={aba === t.id ? 0 : -1}
              onClick={() => onAba(t.id)}
              onKeyDown={(e) => teclarAba(e, i)}
              className="relative flex-1 px-2 py-2.5 text-[13px] transition-colors"
              style={{ color: aba === t.id ? "var(--text)" : "var(--text-3)", fontWeight: aba === t.id ? 600 : 400 }}
            >
              {t.rotulo}
              {aba === t.id && <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 rounded-full" style={{ background: "var(--accent)" }} />}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`painel-${aba}`} aria-labelledby={`aba-${aba}`} className="pt-2">
          {erro && vazio("Não foi possível carregar os detalhes agora.")}
          {!dados && !erro && aba !== "ia" && (
            <div className="space-y-3 py-4" aria-hidden>
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-9 rounded-lg animate-pulse" style={{ background: "var(--card-2)" }} />)}
            </div>
          )}

          {dados && aba === "info" && (
            <>
              <Secao titulo="Informações gerais">
                <Linha rotulo="Nome" valor={dados.corretor.nome || "—"} />
                <Linha rotulo="Telefone" valor={dados.corretor.telefone_mascarado} />
                <Linha rotulo="E-mail" valor={dados.corretor.email || "—"} />
                <Linha rotulo="Cadastrado em" valor={dataHora(dados.corretor.cadastrado_em)} />
                <Linha rotulo="Última mensagem" valor={dataHora(dados.atendimento.ultima_em)} />
              </Secao>
              <Secao titulo="Atendimento do agente">
                <Linha rotulo="Mensagens do corretor" valor={dados.atendimento.recebidas} />
                <Linha rotulo="Respostas enviadas" valor={dados.atendimento.enviadas} />
                <Linha rotulo="Áudios" valor={dados.atendimento.audios} />
                <Linha rotulo="Fotos de imóveis" valor={dados.atendimento.fotos} />
                <Linha rotulo="Mensagens da equipe" valor={dados.atendimento.da_equipe} />
                <Linha rotulo="Respostas de segurança" valor={<span style={{ color: dados.atendimento.fallbacks ? "var(--warn)" : undefined }}>{dados.atendimento.fallbacks}</span>} />
              </Secao>
            </>
          )}

          {dados && aba === "carteira" && (
            <>
              <Secao titulo={`Clientes (${dados.carteira.length})`}>
                {dados.carteira.length === 0 ? vazio("Nenhum cliente na carteira deste corretor.") : (
                  <ul>
                    {dados.carteira.map((l) => (
                      <li key={l.id} className="px-1 py-2.5" style={{ borderTop: "1px solid var(--line)" }}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[13px] font-medium truncate" style={{ color: "var(--text)" }}>{l.nome}</span>
                          {l.temperatura && <span className="text-[11px] shrink-0" style={{ color: corTemperatura(l.temperatura) }}>{l.temperatura}</span>}
                        </div>
                        {l.perfil && <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>{l.perfil}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </Secao>
              <Secao titulo={`Atendimentos em aberto (${dados.negocios_abertos})`}>
                {dados.negocios.length === 0 ? vazio("Sem atendimentos em aberto.") : (
                  <ul>
                    {dados.negocios.map((n) => (
                      <li key={n.id} className="px-1 py-2.5" style={{ borderTop: "1px solid var(--line)" }}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[13px] font-medium truncate" style={{ color: "var(--text)" }}>{n.cliente}</span>
                          <span className="text-xs tabular-nums shrink-0" style={{ color: "var(--text-2)" }}>{brl(n.valor)}</span>
                        </div>
                        <p className="text-xs mt-0.5" style={{ color: n.travado ? "var(--warn)" : "var(--text-3)" }}>{n.etapa} · {n.dias} {n.dias === 1 ? "dia" : "dias"}{n.travado ? " · travado" : ""}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Secao>
              <Secao titulo="Próximas atividades">
                {dados.atividades.length === 0 ? vazio("Nada agendado para os próximos 7 dias.") : (
                  <ul>
                    {dados.atividades.map((x) => (
                      <li key={x.id} className="px-1 py-2.5 flex items-center justify-between gap-3" style={{ borderTop: "1px solid var(--line)" }}>
                        <span className="text-[13px] truncate" style={{ color: "var(--text)" }}>{x.titulo}</span>
                        <span className="text-xs tabular-nums shrink-0" style={{ color: x.atrasada ? "var(--warn)" : "var(--text-3)" }}>{dataHora(x.inicio)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Secao>
            </>
          )}

          {dados && aba === "bot" && (
            <Secao titulo="Últimas ações do bot">
              {dados.acoes.length === 0 ? vazio("O agente ainda não gravou nada para este corretor.") : (
                <ul>
                  {dados.acoes.map((x, i) => (
                    <li key={i} className="px-1 py-2.5" style={{ borderTop: "1px solid var(--line)" }}>
                      <p className="text-[13px]" style={{ color: "var(--text)" }}>{x.descricao}</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-4)" }}>{relativo(x.quando)} · {x.origem === "portal" ? "pelo portal" : "pelo WhatsApp"}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
          )}

          {aba === "ia" && (
            <Secao titulo="Como o agente respondeu">
              <ListaProcessos mensagens={mensagens} focoId={focoProcesso} />
            </Secao>
          )}
        </div>
      </div>
    </aside>
  );
}
