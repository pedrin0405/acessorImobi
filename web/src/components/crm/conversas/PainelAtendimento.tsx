"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, Check, Copy, ExternalLink, Handshake, Loader2, RefreshCw, Sparkles, UserRound, Users, X } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { brl, Perfil, resumoPerfil } from "@/lib/crm";
import { Avatar } from "./ListaConversas";
import { corTemperatura, dataHora, Linha, Secao, vazio } from "./PainelDetalhes";
import type { AtendimentoDetalhe, AtendimentoItem, TipoContato } from "./tipos";

export type AbaAtendimento = "info" | "cliente" | "analise";

const ABAS: { id: AbaAtendimento; rotulo: string }[] = [
  { id: "info", rotulo: "Info" },
  { id: "cliente", rotulo: "Cliente" },
  { id: "analise", rotulo: "Análise" },
];

interface FichaCliente {
  id: string; nome: string; telefone: string | null; email: string | null; temperatura: string | null; origem: string | null; observacoes: string | null;
  perfil: Perfil | null;
  negocios: { id: string; etapa_nome: string; valor: number; status: string; im_valor_tipo?: string | null }[];
  atividades: { id: string; titulo: string; inicio: string | null; atrasada: boolean; status: string }[];
}

const ROTULO_CAMPO: Record<string, string> = {
  resumo: "Resumo", temperatura: "Temperatura", proximo_passo: "Próximo passo", sugestao_resposta: "Sugestão de resposta",
  objecoes: "Objeções", alertas: "Alertas", etapa_sugerida: "Etapa sugerida", perfil: "Perfil de busca",
};
const ORDEM = ["resumo", "proximo_passo", "sugestao_resposta", "objecoes", "alertas", "etapa_sugerida", "perfil", "temperatura"];

const TIPOS: { id: Exclude<TipoContato, null> | "auto"; rotulo: string }[] = [
  { id: "imobiliario", rotulo: "Imobiliário" }, { id: "pessoal", rotulo: "Pessoal" }, { id: "outro", rotulo: "Outro" }, { id: "auto", rotulo: "Automático" },
];

/** Controle segmentado do tipo de contato: o corretor corrige a classificação da IA (ou volta ao automático). */
function SeletorTipo({ item, salvando, onTrocar, compacto }: { item: AtendimentoItem; salvando: boolean; onTrocar: (t: TipoContato) => void; compacto?: boolean }) {
  const atual = item.tipo_manual && item.tipo_contato ? item.tipo_contato : "auto";
  return (
    <div role="radiogroup" aria-label="Tipo de contato" className={`inline-flex flex-wrap ${compacto ? "gap-1" : "gap-1.5"}`}>
      {TIPOS.map((t) => {
        const ativo = atual === t.id;
        return (
          <button
            key={t.id} type="button" role="radio" aria-checked={ativo} disabled={salvando}
            onClick={() => !ativo && onTrocar(t.id === "auto" ? null : t.id)}
            className={`rounded-full font-medium transition-colors disabled:opacity-60 ${compacto ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs"}`}
            style={{ background: ativo ? "var(--chip)" : "var(--card-2)", color: ativo ? "var(--chip-text)" : "var(--text-2)", border: "1px solid var(--line)" }}
          >{t.rotulo}</button>
        );
      })}
    </div>
  );
}

const texto = (v: unknown): string => (v == null ? "" : typeof v === "string" ? v : Array.isArray(v) ? v.map(texto).filter(Boolean).join("; ") : typeof v === "object" ? Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${texto(x)}`).join(" · ") : String(v));

export default function PainelAtendimento({
  item, detalhe, aba, onAba, onFechar, onIr, onAbrirCliente, onReanalisar, reanalisando, onAuthError, erroAnalise, onLigarAssistente, onAlterou,
}: {
  item: AtendimentoItem;
  detalhe: AtendimentoDetalhe | null;
  aba: AbaAtendimento;
  onAba: (a: AbaAtendimento) => void;
  onFechar: () => void;
  onIr: (tab: string) => void;
  onAbrirCliente?: (leadId: string) => void;
  onReanalisar: () => void;
  reanalisando: boolean;
  onAuthError: (e: unknown) => boolean;
  /** Motivo da última análise que falhou (assistente desligado, IA indisponível…). */
  erroAnalise?: string | null;
  onLigarAssistente?: () => void;
  /** O atendimento mudou (tipo, foto ou nome): a tela atualiza o item na hora e recarrega a lista. */
  onAlterou?: (patch: Partial<AtendimentoItem>) => void;
}) {
  const [salvandoTipo, setSalvandoTipo] = useState(false);
  const [avisoTipo, setAvisoTipo] = useState<string | null>(null);
  const [buscandoFoto, setBuscandoFoto] = useState(false);
  const [avisoFoto, setAvisoFoto] = useState<string | null>(null);
  const [ficha, setFicha] = useState<FichaCliente | null>(null);
  const [erroFicha, setErroFicha] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);
  const abas = useRef<(HTMLButtonElement | null)[]>([]);
  const leadId = detalhe?.lead_id ?? item.lead_id;

  const carregarFicha = useCallback(async () => {
    if (!leadId) { setFicha(null); return; }
    try {
      const res = await fetchApi(`/admin/crm/clientes/${leadId}`);
      if (!res.ok) throw new Error("falha");
      setFicha(await res.json());
      setErroFicha(false);
    } catch (e) {
      if (!onAuthError(e)) setErroFicha(true);
    }
  }, [leadId, onAuthError]);

  useEffect(() => { setFicha(null); setErroFicha(false); }, [leadId]);
  useEffect(() => { if (aba === "cliente" || aba === "info") carregarFicha(); }, [aba, carregarFicha]);

  const trocarTipo = async (tipo: TipoContato) => {
    setSalvandoTipo(true); setAvisoTipo(null);
    try {
      const res = await fetchApi(`/corretor/atendimentos/${item.id}/tipo`, { method: "PATCH", body: JSON.stringify({ tipo }) });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(dados?.detail || "Não foi possível salvar o tipo agora.");
      onAlterou?.({ tipo_contato: dados.tipo_contato ?? null, tipo_manual: !!dados.tipo_manual, imobiliario: dados.imobiliario ?? null });
      setAvisoTipo(tipo === "pessoal" || tipo === "outro"
        ? "Conversas pessoais saem da lista e não são analisadas; veja em “Incluir conversas não imobiliárias”."
        : tipo === null ? "Voltou ao automático: o Acessor classifica na próxima análise." : "Tipo salvo. O Acessor passa a tratar esta conversa como imobiliária.");
    } catch (e) {
      if (!onAuthError(e)) setAvisoTipo(e instanceof Error ? e.message : "Não foi possível salvar o tipo agora.");
    } finally { setSalvandoTipo(false); }
  };

  const atualizarFoto = async () => {
    setBuscandoFoto(true); setAvisoFoto(null);
    try {
      const res = await fetchApi(`/corretor/atendimentos/${item.id}/foto/atualizar`, { method: "POST" });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(dados?.detail || "Não foi possível buscar agora.");
      setAvisoFoto(dados.mensagem || null);
      onAlterou?.({ foto_url: dados.foto_url ?? item.foto_url ?? null, nome: dados.nome ?? item.nome });
    } catch (e) {
      if (!onAuthError(e)) setAvisoFoto(e instanceof Error ? e.message : "Não foi possível buscar agora.");
    } finally { setBuscandoFoto(false); }
  };

  const teclarAba = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const prox = (i + (e.key === "ArrowRight" ? 1 : -1) + ABAS.length) % ABAS.length;
    onAba(ABAS[prox].id);
    abas.current[prox]?.focus();
  };

  const copiar = async (chave: string, t: string) => {
    try { await navigator.clipboard.writeText(t); setCopiado(chave); setTimeout(() => setCopiado(null), 1800); } catch { /* sem permissão para a área de transferência */ }
  };

  const analise = (detalhe?.analise ?? {}) as Record<string, unknown>;
  const msgs = detalhe?.mensagens ?? [];
  const contagem = {
    corretor: msgs.filter((m) => m.autor === "corretor").length, cliente: msgs.filter((m) => m.autor !== "corretor").length,
    audios: msgs.filter((m) => m.tipo === "audio").length, fotos: msgs.filter((m) => m.tipo === "image").length,
  };
  const temperatura = (analise.temperatura as string | undefined) ?? item.temperatura;
  const resumoIA = (analise.resumo as string | undefined) ?? item.resumo;
  const atalhos = [
    { rotulo: "Ficha", icone: UserRound, acao: () => leadId && onAbrirCliente?.(leadId), desligado: !leadId || !onAbrirCliente },
    { rotulo: "Carteira", icone: Users, acao: () => onIr("leads"), desligado: false },
    { rotulo: "Agenda", icone: CalendarDays, acao: () => onIr("agenda"), desligado: false },
    { rotulo: "Fluxo", icone: Handshake, acao: () => onIr("negociacoes"), desligado: false },
  ];
  const chaves = [...ORDEM.filter((k) => analise[k] != null && texto(analise[k]) !== ""), ...Object.keys(analise).filter((k) => !ORDEM.includes(k) && texto(analise[k]) !== "")];

  return (
    <aside className="h-full flex flex-col min-h-0" aria-label="Detalhes do atendimento" style={{ background: "var(--sidebar)" }}>
      <header className="flex items-center justify-between px-5 h-[60px] shrink-0" style={{ borderBottom: "1px solid var(--line)" }}>
        <h2 className="text-[15px] font-semibold" style={{ color: "var(--text)" }}>Detalhes</h2>
        <button type="button" onClick={onFechar} aria-label="Fechar detalhes" className="p-2 -mr-2 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}>
          <X className="w-5 h-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pb-8">
        <div className="pt-6 flex flex-col items-center text-center">
          <Avatar nome={item.nome} tamanho={96} fotoUrl={detalhe?.foto_url ?? item.foto_url} />
          <h3 className="mt-3 text-lg font-semibold" style={{ color: "var(--text)" }}>{item.nome || item.telefone_cliente}</h3>
          <button type="button" onClick={atualizarFoto} disabled={buscandoFoto} className="mt-1 inline-flex items-center gap-1.5 text-[11.5px] hover:underline disabled:opacity-60" style={{ color: "var(--text-3)" }}>
            {buscandoFoto ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> : <RefreshCw className="w-3 h-3" aria-hidden />} Atualizar foto e nome do WhatsApp
          </button>
          {avisoFoto && <p role="status" className="mt-1 text-[11.5px] max-w-[16rem]" style={{ color: "var(--text-3)" }}>{avisoFoto}</p>}
          <div className="mt-1 flex items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded-md" style={{ background: "var(--card-2)", color: "var(--text-3)" }}>Cliente</span>
            {temperatura && <span style={{ color: corTemperatura(temperatura) }}>{temperatura}</span>}
            {(detalhe?.aguardando_corretor ?? item.aguardando_corretor) && <span style={{ color: "var(--warn)" }}>Aguardando você</span>}
          </div>

          <div className="mt-3"><SeletorTipo item={item} salvando={salvandoTipo} onTrocar={trocarTipo} compacto /></div>
          {avisoTipo && <p role="status" className="mt-1.5 text-[11.5px] max-w-[18rem]" style={{ color: "var(--text-3)" }}>{avisoTipo}</p>}

          <ul className="mt-4 flex items-start justify-center gap-4">
            {atalhos.map(({ rotulo, icone: Icone, acao, desligado }) => (
              <li key={rotulo}>
                <button type="button" onClick={acao} disabled={desligado} className="group flex flex-col items-center gap-1.5 disabled:opacity-40">
                  <span className="w-10 h-10 rounded-full flex items-center justify-center transition-colors group-hover:bg-[var(--hover-solid)]" style={{ background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--text-2)" }}>
                    <Icone className="w-[18px] h-[18px]" aria-hidden />
                  </span>
                  <span className="text-[10.5px]" style={{ color: "var(--text-3)" }}>{rotulo}</span>
                </button>
              </li>
            ))}
          </ul>

          {leadId && onAbrirCliente && (
            <button type="button" onClick={() => onAbrirCliente(leadId)} className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] hover:bg-[var(--hover-solid)]" style={{ border: "1px solid var(--line-2)", color: "var(--text-2)" }}>
              <ExternalLink className="w-3.5 h-3.5" aria-hidden /> Abrir ficha completa
            </button>
          )}
        </div>

        {erroAnalise && (
          <div role="alert" className="assist-fade mt-6 rounded-2xl p-3.5 text-[13px]" style={{ background: "color-mix(in srgb, var(--danger) 10%, var(--card))", border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)", color: "var(--text)" }}>
            <p>{erroAnalise}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {/desligado/i.test(erroAnalise) && onLigarAssistente && (
                <button type="button" onClick={onLigarAssistente} disabled={reanalisando} className="px-3 py-1.5 rounded-full text-xs font-medium disabled:opacity-60" style={{ background: "var(--chip)", color: "var(--chip-text)" }}>Ligar o assistente</button>
              )}
              <button type="button" onClick={onReanalisar} disabled={reanalisando} className="px-3 py-1.5 rounded-full text-xs font-medium hover:bg-[var(--hover-solid)] disabled:opacity-60" style={{ border: "1px solid var(--line-2)", color: "var(--text)" }}>Tentar de novo</button>
            </div>
          </div>
        )}

        <section className="mt-6 rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
          <h4 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Atendimento</h4>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>{detalhe ? `Última mensagem ${dataHora(detalhe.ultima_mensagem_em)}` : "Carregando…"}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-full" style={{ background: "var(--card-2)", color: "var(--text-3)" }}>Origem · <span style={{ color: "var(--text-2)" }}>WhatsApp pessoal</span></span>
            {detalhe && <span className="px-2.5 py-1 rounded-full" style={{ background: "var(--card-2)", color: "var(--text-3)" }}>Mensagens · <span style={{ color: "var(--text-2)" }}>{msgs.length}</span></span>}
          </div>
          <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--line)" }}>
            {resumoIA ? (
              <div className="assist-fade">
                <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-2)" }}>{resumoIA}</p>
                <button type="button" onClick={onReanalisar} disabled={reanalisando} className="mt-2 inline-flex items-center gap-1.5 text-xs hover:underline disabled:opacity-60" style={{ color: "var(--accent-text)" }}>
                  {reanalisando ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Reanalisar
                </button>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs leading-relaxed" style={{ color: "var(--text-3)" }}>O que o cliente quer, o que falta responder e o que fazer a seguir.</p>
                <button type="button" onClick={onReanalisar} disabled={reanalisando} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium hover:bg-[var(--hover-solid)] disabled:opacity-60" style={{ border: "1px solid var(--line-2)", color: "var(--text)" }}>
                  {reanalisando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />}
                  Analisar
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
              id={`aba-at-${t.id}`}
              aria-selected={aba === t.id}
              aria-controls={`painel-at-${t.id}`}
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

        <div role="tabpanel" id={`painel-at-${aba}`} aria-labelledby={`aba-at-${aba}`} className="pt-2">
          {aba === "info" && (
            <>
              <Secao titulo="Informações gerais">
                <Linha rotulo="Nome" valor={item.nome ? <span>{item.nome} <span className="text-[11px]" style={{ color: "var(--text-4)" }}>· {leadId ? "do CRM" : "do WhatsApp"}</span></span> : "—"} />
                <Linha rotulo="Telefone" valor={item.telefone_cliente} />
                <Linha rotulo="Tipo de contato" valor={<span className="inline-flex flex-col items-end gap-1.5">
                  <SeletorTipo item={item} salvando={salvandoTipo} onTrocar={trocarTipo} compacto />
                  {!item.tipo_manual && item.imobiliario != null && <span className="text-[11px]" style={{ color: "var(--text-4)" }}>A IA classificou como {item.imobiliario ? "imobiliário" : "pessoal / não imobiliário"}</span>}
                </span>} />
                <Linha rotulo="No CRM" valor={leadId ? "Sim" : "Ainda não"} />
                <Linha rotulo="Última mensagem" valor={dataHora(detalhe?.ultima_mensagem_em ?? item.ultima_mensagem_em)} />
                <Linha rotulo="Última do cliente" valor={dataHora(item.ultima_do_cliente_em)} />
                <Linha rotulo="Analisado em" valor={dataHora(detalhe?.analisado_em ?? item.analisado_em)} />
              </Secao>
              <Secao titulo="Conversa">
                <Linha rotulo="Mensagens suas" valor={contagem.corretor} />
                <Linha rotulo="Mensagens do cliente" valor={contagem.cliente} />
                <Linha rotulo="Áudios" valor={contagem.audios} />
                <Linha rotulo="Fotos" valor={contagem.fotos} />
                <Linha rotulo="Sem resposta" valor={<span style={{ color: item.nao_respondidas ? "var(--warn)" : undefined }}>{item.nao_respondidas}</span>} />
              </Secao>
            </>
          )}

          {aba === "cliente" && (
            !leadId ? (
              <p className="px-1 py-6 text-center text-sm" style={{ color: "var(--text-3)" }}>
                Cliente ainda fora do CRM. Peça ao Acessor no seu WhatsApp para registrá-lo e ele passa a aparecer na sua carteira e no Fluxo.
              </p>
            ) : erroFicha ? vazio("Não foi possível carregar o cliente agora.") : !ficha ? (
              <div className="space-y-3 py-4" aria-hidden>{[0, 1, 2, 3].map((i) => <div key={i} className="h-9 rounded-lg animate-pulse" style={{ background: "var(--card-2)" }} />)}</div>
            ) : (
              <>
                <Secao titulo="No CRM">
                  <Linha rotulo="Telefone" valor={ficha.telefone || "—"} />
                  <Linha rotulo="E-mail" valor={ficha.email || "—"} />
                  <Linha rotulo="Temperatura" valor={<span style={{ color: corTemperatura(ficha.temperatura) }}>{ficha.temperatura || "—"}</span>} />
                  <Linha rotulo="Origem" valor={ficha.origem || "—"} />
                  <Linha rotulo="Procura" valor={ficha.perfil ? resumoPerfil(ficha.perfil) || "—" : "—"} />
                </Secao>
                <Secao titulo={`Negócios (${ficha.negocios.length})`}>
                  {ficha.negocios.length === 0 ? vazio("Sem negócio no Fluxo.") : (
                    <ul>
                      {ficha.negocios.map((n) => (
                        <li key={n.id} className="px-1 py-2.5 flex items-center justify-between gap-3" style={{ borderTop: "1px solid var(--line)" }}>
                          <span className="min-w-0">
                            <span className="block text-[13px] font-medium truncate" style={{ color: "var(--text)" }}>{n.status === "aberto" ? n.etapa_nome : n.status === "ganho" ? "Ganho" : "Perdido"}</span>
                            <span className="block text-xs" style={{ color: "var(--text-3)" }}>{n.etapa_nome}</span>
                          </span>
                          <span className="text-xs tabular-nums shrink-0" style={{ color: "var(--text-2)" }}>{n.valor > 0 ? brl(n.valor) : "Sem valor"}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Secao>
                <Secao titulo="Compromissos">
                  {ficha.atividades.filter((a) => a.status === "aberta").length === 0 ? vazio("Nada agendado com este cliente.") : (
                    <ul>
                      {ficha.atividades.filter((a) => a.status === "aberta").slice(0, 6).map((x) => (
                        <li key={x.id} className="px-1 py-2.5 flex items-center justify-between gap-3" style={{ borderTop: "1px solid var(--line)" }}>
                          <span className="text-[13px] truncate" style={{ color: "var(--text)" }}>{x.titulo}</span>
                          <span className="text-xs tabular-nums shrink-0" style={{ color: x.atrasada ? "var(--warn)" : "var(--text-3)" }}>{dataHora(x.inicio)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Secao>
              </>
            )
          )}

          {aba === "analise" && (
            chaves.length === 0 ? vazio("Ainda sem análise. Toque em Analisar para o Acessor ler a conversa.") : (
              <Secao titulo="O que o Acessor entendeu">
                <ul>
                  {chaves.map((k) => {
                    const t = k === "perfil" && analise.perfil && typeof analise.perfil === "object" ? resumoPerfil(analise.perfil as Perfil) || texto(analise.perfil) : texto(analise[k]);
                    return (
                      <li key={k} className="px-1 py-2.5" style={{ borderTop: "1px solid var(--line)" }}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-4)" }}>{ROTULO_CAMPO[k] ?? k.replace(/_/g, " ")}</span>
                          {k === "sugestao_resposta" && (
                            <button type="button" onClick={() => copiar(k, t)} className="inline-flex items-center gap-1 text-xs hover:underline" style={{ color: "var(--accent-text)" }}>
                              {copiado === k ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copiado === k ? "Copiado" : "Copiar"}
                            </button>
                          )}
                        </div>
                        <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text)" }}>{t}</p>
                      </li>
                    );
                  })}
                </ul>
              </Secao>
            )
          )}
        </div>
      </div>
    </aside>
  );
}
