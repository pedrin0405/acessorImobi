"use client";

import AvatarDoCorretor from "@/components/corretor/AvatarDoCorretor";
import React, { useMemo, useState } from "react";
import { Image as ImagemIcone, MessageSquare, Mic, RefreshCw, Search } from "lucide-react";
import type { ConversaResumo } from "./tipos";

export type Filtro = "todas" | "sem-resposta" | "hoje" | "inativos";

export const FILTROS: { id: Filtro; rotulo: string }[] = [
  { id: "todas", rotulo: "Todas" },
  { id: "sem-resposta", rotulo: "Sem resposta" },
  { id: "hoje", rotulo: "Hoje" },
  { id: "inativos", rotulo: "Inativos" },
];

const mesmoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export function rotuloLista(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const hoje = new Date();
  if (mesmoDia(d, hoje)) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);
  if (mesmoDia(d, ontem)) return "Ontem";
  if (hoje.getTime() - d.getTime() < 6 * 86400000) {
    const dia = d.toLocaleDateString("pt-BR", { weekday: "long" });
    return dia.charAt(0).toUpperCase() + dia.slice(1);
  }
  return d.toLocaleDateString("pt-BR");
}

/** Prévia da última mensagem; foto e áudio levam um ícone desenhado em vez de emoji. */
export function previaDaConversa(c: ConversaResumo): { tipo: "foto" | "audio" | null; texto: string } {
  const prefixo = c.ultima_direcao === "outbound" ? "Acessor: " : "";
  if (!c.ultima_mensagem) {
    if (c.ultimo_tipo === "audio") return { tipo: "audio", texto: `${prefixo}Áudio` };
    if (c.ultimo_tipo === "image") return { tipo: "foto", texto: `${prefixo}Foto` };
    if (c.ultimo_tipo === "document") return { tipo: null, texto: `${prefixo}Documento` };
    return { tipo: null, texto: "Sem prévia" };
  }
  if (c.ultimo_tipo === "image") {
    const titulo = c.ultima_mensagem.split("\n")[0].replace(/^[^A-Za-z0-9À-ÿ]+/, "").replace(/\*/g, "").trim();
    return { tipo: "foto", texto: `${prefixo}${titulo || "Foto"}` };
  }
  if (c.ultimo_tipo === "audio") return { tipo: "audio", texto: `${prefixo}${c.ultima_mensagem}` };
  return { tipo: null, texto: `${prefixo}${c.ultima_mensagem.replace(/\*/g, "")}` };
}

export function Avatar({ nome, tamanho = 44, id }: { nome: string | null; tamanho?: number; id?: string | null }) {
  if (id) return <AvatarDoCorretor id={id} nome={nome} tamanho={tamanho} />;
  return (
    <span
      className="shrink-0 rounded-full flex items-center justify-center font-semibold"
      style={{ width: tamanho, height: tamanho, fontSize: tamanho * 0.38, background: "var(--accent-soft)", color: "var(--accent-text)" }}
      aria-hidden
    >
      {(nome || "?").trim().charAt(0).toUpperCase()}
    </span>
  );
}

export default function ListaConversas({
  conversas,
  carregando,
  ativaId,
  online,
  onAbrir,
  onAtualizar,
  titulo = "Conversas",
  rotuloOnline,
  filtros = FILTROS,
  extra,
  textoVazio,
  semAvatarDoCorretor = false,
}: {
  conversas: ConversaResumo[];
  carregando: boolean;
  ativaId: string | null;
  online: boolean | null;
  onAbrir: (c: ConversaResumo) => void;
  onAtualizar: () => void;
  titulo?: string;
  /** Troca os textos "Online / WhatsApp desconectado" (ex.: WhatsApp pessoal do corretor). */
  rotuloOnline?: { on: string; off: string };
  filtros?: { id: Filtro; rotulo: string }[];
  /** Conteúdo logo abaixo dos filtros (ex.: alternador de conversas não imobiliárias). */
  extra?: React.ReactNode;
  textoVazio?: { titulo: string; detalhe: string; acao?: { rotulo: string; onClick: () => void; ocupado?: boolean } };
  /** Atendimentos: o id da linha é do atendimento, não de um corretor, então o avatar é só as iniciais. */
  semAvatarDoCorretor?: boolean;
}) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const hoje = new Date();
    return conversas.filter((c) => {
      if (filtro === "sem-resposta" && !(c.nao_respondidas > 0)) return false;
      if (filtro === "hoje" && !(c.ultima_em && mesmoDia(new Date(c.ultima_em), hoje))) return false;
      if (filtro === "inativos" && c.corretor_status === "active") return false;
      if (!q) return true;
      return `${c.corretor_nome || ""} ${c.ultima_mensagem || ""}`.toLowerCase().includes(q);
    });
  }, [conversas, busca, filtro]);

  return (
    <section className="h-full flex flex-col min-h-0" aria-label="Lista de conversas">
      <header className="px-5 pt-5 pb-3 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--text)" }}>{titulo}</h1>
            <p className="mt-1 flex items-center gap-1.5 text-xs" style={{ color: "var(--text-3)" }}>
              <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: online === null ? "var(--text-4)" : online ? "var(--accent)" : "var(--warn)" }} />
              {online === null ? "Verificando…" : online ? (rotuloOnline?.on ?? "Online") : (rotuloOnline?.off ?? "WhatsApp desconectado")}
            </p>
          </div>
          <button type="button" onClick={onAtualizar} aria-label="Atualizar conversas" className="p-2 -mr-2 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}>
            <RefreshCw className={`w-[18px] h-[18px] ${carregando ? "animate-spin" : ""}`} />
          </button>
        </div>

        <label className="relative mt-4 block">
          <span className="sr-only">Buscar nome ou mensagem</span>
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-4)" }} aria-hidden />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar nome ou mensagem"
            className="w-full pl-11 pr-4 py-2.5 rounded-full text-sm outline-none border focus:border-[var(--accent)]"
            style={{ background: "var(--card-2)", borderColor: "var(--line)", color: "var(--text)" }}
          />
        </label>

        <div role="radiogroup" aria-label="Filtrar conversas" className="mt-3 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {filtros.map((f) => {
            const ativo = filtro === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={ativo}
                onClick={() => setFiltro(f.id)}
                className="shrink-0 px-3.5 py-1.5 rounded-full text-[13px] transition-colors"
                style={ativo ? { background: "var(--chip)", color: "var(--chip-text)", fontWeight: 600 } : { background: "var(--card-2)", color: "var(--text-2)", border: "1px solid var(--line)" }}
              >
                {f.rotulo}
              </button>
            );
          })}
        </div>
        {extra}
      </header>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {carregando && conversas.length === 0 ? (
          <ul className="px-3 space-y-4 pt-3" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="w-11 h-11 rounded-full animate-pulse" style={{ background: "var(--card-2)" }} />
                <span className="flex-1 space-y-2">
                  <span className="block h-3 w-1/2 rounded animate-pulse" style={{ background: "var(--card-2)" }} />
                  <span className="block h-3 w-4/5 rounded animate-pulse" style={{ background: "var(--card-2)" }} />
                </span>
              </li>
            ))}
          </ul>
        ) : visiveis.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <span className="mx-auto w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "var(--card-2)", color: "var(--text-3)" }}>
              <MessageSquare className="w-6 h-6" aria-hidden />
            </span>
            <p className="mt-3 text-sm font-medium" style={{ color: "var(--text)" }}>
              {conversas.length === 0 ? (textoVazio?.titulo ?? "Nenhuma conversa ainda") : "Nada encontrado"}
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--text-3)" }}>
              {conversas.length === 0 ? (textoVazio?.detalhe ?? "Quando um corretor falar com o agente, a conversa aparece aqui.") : "Tente outro nome, outra palavra ou outro filtro."}
            </p>
            {conversas.length === 0 && textoVazio?.acao && (
              <button type="button" onClick={textoVazio.acao.onClick} disabled={textoVazio.acao.ocupado} className="mt-4 px-4 py-2 rounded-full text-sm font-medium disabled:opacity-60" style={{ background: "var(--chip)", color: "var(--chip-text)" }}>
                {textoVazio.acao.ocupado ? "Aguarde…" : textoVazio.acao.rotulo}
              </button>
            )}
          </div>
        ) : (
          <ul>
            {visiveis.map((c) => {
              const ativa = ativaId === c.corretor_id;
              const naoLida = c.nao_respondidas > 0;
              return (
                <li key={c.corretor_id}>
                  <button
                    type="button"
                    onClick={() => onAbrir(c)}
                    aria-current={ativa ? "true" : undefined}
                    className="w-full flex items-start gap-3 px-3 py-3 rounded-2xl text-left transition-colors hover:bg-[var(--card-2)]"
                    style={ativa ? { background: "var(--hover-solid)" } : undefined}
                  >
                    <Avatar nome={c.corretor_nome} id={semAvatarDoCorretor ? null : c.corretor_id} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[15px] font-medium" style={{ color: "var(--text)" }}>{c.corretor_nome || c.telefone_mascarado}</span>
                        <span className="shrink-0 text-xs tabular-nums" style={{ color: naoLida ? "var(--accent-text)" : "var(--text-4)" }}>{rotuloLista(c.ultima_em)}</span>
                      </span>
                      <span className="mt-0.5 flex items-start justify-between gap-2">
                        <span className="text-[13px] leading-snug line-clamp-2" style={{ color: "var(--text-3)" }}>
                          {(() => {
                            const previa = previaDaConversa(c);
                            return (
                              <>
                                {previa.tipo === "foto" && <ImagemIcone className="inline w-3.5 h-3.5 mr-1 -mt-0.5" aria-hidden />}
                                {previa.tipo === "audio" && <Mic className="inline w-3.5 h-3.5 mr-1 -mt-0.5" aria-hidden />}
                                {previa.texto}
                              </>
                            );
                          })()}
                        </span>
                        {naoLida && (
                          <span className="shrink-0 mt-0.5 min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center" style={{ background: "var(--accent)", color: "var(--bg)" }} aria-label={`${c.nao_respondidas} sem resposta`}>
                            {c.nao_respondidas}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
