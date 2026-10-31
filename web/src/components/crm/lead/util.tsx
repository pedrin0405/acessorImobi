"use client";

import React from "react";
import {
  Bot, Brain, Building2, CalendarDays, CircleDollarSign, FileText, Handshake, Home, MessageCircle, MessageSquare, Phone, Sparkles, UserPlus,
} from "lucide-react";

// Tipos e pequenos blocos compartilhados pela subpágina do lead e pelo popup do Fluxo.

export type Categoria = "cadastro" | "contato" | "funil" | "agenda" | "conversa" | "analise" | "acao" | "imoview" | "interacao" | "imovel";
export type AutorTipo = "corretor" | "cliente" | "equipe" | "imoview" | "sistema";

export interface EventoTempo {
  id: string;
  em: string;
  categoria: Categoria;
  tipo: string;
  titulo: string;
  detalhe: string | null;
  autor_tipo: AutorTipo;
  autor: string | null;
  origem: "crm" | "imoview" | "whatsapp" | "agenda" | "auditoria";
  meta: Record<string, unknown>;
}

export interface ResumoTempo {
  total: number;
  por_categoria: Partial<Record<Categoria, number>>;
  primeiro_evento: string | null;
  ultimo_evento: string | null;
  acoes_do_corretor: number;
  mensagens_corretor: number;
  mensagens_cliente: number;
  interacoes: number;
  visitas: number;
  propostas: number;
  negocios: number;
  primeira_resposta_min: number | null;
  valor_potencial: number | null;
  comissao: number | null;
}

export interface LinhaDoTempoDados { eventos: EventoTempo[]; resumo: ResumoTempo }

export const CATEGORIAS: Record<Categoria, { rotulo: string; Icone: React.ComponentType<{ className?: string }> }> = {
  cadastro: { rotulo: "Cadastro", Icone: UserPlus },
  contato: { rotulo: "Contato", Icone: Phone },
  funil: { rotulo: "Fluxo", Icone: Handshake },
  agenda: { rotulo: "Agenda", Icone: CalendarDays },
  conversa: { rotulo: "Conversa", Icone: MessageCircle },
  analise: { rotulo: "Análise da IA", Icone: Sparkles },
  acao: { rotulo: "Ações", Icone: Bot },
  imoview: { rotulo: "Imoview", Icone: Building2 },
  interacao: { rotulo: "Interações", Icone: MessageSquare },
  imovel: { rotulo: "Imóveis", Icone: Home },
};

export const AUTORES: Record<AutorTipo, { rotulo: string; cor: string }> = {
  corretor: { rotulo: "Corretor", cor: "var(--accent-text)" },
  cliente: { rotulo: "Cliente", cor: "var(--info)" },
  equipe: { rotulo: "Equipe", cor: "var(--warn)" },
  imoview: { rotulo: "Imoview", cor: "var(--text-2)" },
  sistema: { rotulo: "Sistema", cor: "var(--text-4)" },
};

export const ORIGEM_EVENTO: Record<string, string> = { crm: "CRM", imoview: "Imoview", whatsapp: "WhatsApp", agenda: "Agenda", auditoria: "Auditoria" };
export const ORIGENS: Record<string, string> = { whatsapp: "WhatsApp", imoview: "Imoview", manual: "Manual", portal: "Portal", whatsapp_pessoal: "WhatsApp pessoal" };
export const COR_TEMP: Record<string, string> = { quente: "var(--danger)", morno: "var(--warn)", frio: "var(--info)" };
export const ROTULO_VALOR: Record<string, string> = { negocio: "Negócio fechado", proposta: "Proposta", imovel: "Imóvel de interesse", orcamento: "Orçamento" };
export const TIPO_ATIV: Record<string, string> = { visita: "Visita", reuniao: "Reunião", ligacao: "Ligação", follow_up: "Follow-up", whatsapp: "WhatsApp", tarefa: "Tarefa", email: "E-mail", documento: "Documento" };
export const EVENTO_FUNIL: Record<string, string> = { criado: "Entrou no Fluxo", etapa: "Mudou de etapa", ganho: "Negócio ganho", perdido: "Negócio perdido", reaberto: "Negócio reaberto" };
export const AUTOR_FUNIL: Record<string, string> = { agent: "Corretor (agente)", portal: "Equipe do portal", imoview: "Imoview", scheduler: "Sistema" };

export const dia = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "");
export const diaHora = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
export const hora = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "");
export const dataCurta = (iso?: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("pt-BR") : "");
export const fone = (t?: string | null) => {
  const d = (t || "").replace(/\D/g, "");
  const l = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (l.length === 11) return `(${l.slice(0, 2)}) ${l.slice(2, 7)}-${l.slice(7)}`;
  if (l.length === 10) return `(${l.slice(0, 2)}) ${l.slice(2, 6)}-${l.slice(6)}`;
  return t || "";
};
export const linkWhatsApp = (t?: string | null) => {
  const d = (t || "").replace(/\D/g, "");
  return d ? `https://wa.me/${d.startsWith("55") ? d : `55${d}`}` : null;
};

export function duracao(min: number | null | undefined): string {
  if (min === null || min === undefined) return "—";
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

export function rotuloDia(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
  const mesmo = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (mesmo(d, hoje)) return "Hoje";
  if (mesmo(d, ontem)) return "Ontem";
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== hoje.getFullYear() ? { year: "numeric" } : {}) });
}

export function diasDesde(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86400000)) : null;
}

export function idade(nasc?: string) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(nasc || "");
  if (!m) return null;
  const hoje = new Date(), d = new Date(+m[3], +m[2] - 1, +m[1]);
  let a = hoje.getFullYear() - d.getFullYear();
  if (hoje < new Date(hoje.getFullYear(), d.getMonth(), d.getDate())) a--;
  return a >= 0 && a < 120 ? a : null;
}

/** Selo colorido de "quem fez" (corretor, cliente, equipe, Imoview, sistema). */
export function SeloAutor({ tipo, nome }: { tipo: AutorTipo; nome?: string | null }) {
  const a = AUTORES[tipo] ?? AUTORES.sistema;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium max-w-full" style={{ background: `color-mix(in srgb, ${a.cor} 13%, transparent)`, color: a.cor }}>
      <span className="shrink-0">{a.rotulo}</span>
      {nome && nome.trim() && <span className="truncate font-normal opacity-90">· {nome.trim()}</span>}
    </span>
  );
}

/** Painel com título, usado nas abas. */
export function Painel({ titulo, acao, children, className = "" }: { titulo?: string; acao?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl p-4 sm:p-5 ${className}`} style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
      {(titulo || acao) && (
        <div className="flex items-center justify-between gap-3 mb-3">
          {titulo && <h3 className="text-[13px] font-semibold" style={{ color: "var(--text)" }}>{titulo}</h3>}
          {acao}
        </div>
      )}
      {children}
    </section>
  );
}

export function Campos({ itens, colunas = 2 }: { itens: [string, React.ReactNode][]; colunas?: 1 | 2 | 3 }) {
  const lista = itens.filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== false);
  if (!lista.length) return null;
  const grade = colunas === 3 ? "grid-cols-2 lg:grid-cols-3" : colunas === 1 ? "grid-cols-1" : "grid-cols-2";
  return (
    <dl className={`grid ${grade} gap-x-4 gap-y-3 text-sm`}>
      {lista.map(([r, v]) => (
        <div key={r} className="min-w-0"><dt className="text-xs" style={{ color: "var(--text-3)" }}>{r}</dt><dd className="break-words" style={{ color: "var(--text)" }}>{v}</dd></div>
      ))}
    </dl>
  );
}

export function Vazio({ icone: Icone = Brain, texto }: { icone?: React.ComponentType<{ className?: string }>; texto: string }) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-10 gap-2">
      <span className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "var(--card-2)", color: "var(--text-3)" }}><Icone className="w-5 h-5" /></span>
      <p className="text-sm max-w-sm" style={{ color: "var(--text-3)" }}>{texto}</p>
    </div>
  );
}

export function Metrica({ rotulo, valor, sub, destaque, Icone }: { rotulo: string; valor: React.ReactNode; sub?: React.ReactNode; destaque?: boolean; Icone?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-xl p-3.5 min-w-0" style={{ background: destaque ? "var(--accent-soft)" : "var(--card-2)", border: "1px solid var(--line)" }}>
      <p className="flex items-center gap-1.5 text-[11px]" style={{ color: destaque ? "var(--accent-text)" : "var(--text-3)" }}>{Icone && <Icone className="w-3.5 h-3.5 shrink-0" />}<span className="truncate">{rotulo}</span></p>
      <p className="mt-1 text-lg font-semibold tabular-nums break-words" style={{ color: "var(--text)" }}>{valor}</p>
      {sub && <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--text-3)" }}>{sub}</p>}
    </div>
  );
}

export { CircleDollarSign, FileText };
