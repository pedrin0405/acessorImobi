"use client";

import React, { useEffect, useState } from "react";
import { Copy, Check, RefreshCw, Sparkles, MessagesSquare } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { Perfil, resumoPerfil } from "@/lib/crm";

interface Item {
  id: string;
  nome: string | null;
  telefone_cliente: string;
  aguardando_corretor: boolean;
  ultima_mensagem_em: string;
  ultima_do_cliente_em: string | null;
  resumo: string | null;
  temperatura: string | null;
  imobiliario: boolean | null;
}

interface Analise {
  resumo?: string;
  perfil?: Perfil;
  objecoes?: string[];
  alertas?: string[];
  temperatura?: string;
  proximo_passo?: string;
  sugestao_resposta?: string | null;
  etapa_sugerida?: string | null;
}

interface Detalhe {
  id: string;
  nome: string | null;
  telefone_cliente: string;
  aguardando_corretor: boolean;
  imobiliario: boolean | null;
  analise: Analise;
  analisado_em: string | null;
  mensagens: { autor: "cliente" | "corretor"; tipo: string; conteudo: string | null; transcricao: string | null; created_at: string }[];
}

const COR_TEMPERATURA: Record<string, string> = {
  quente: "bg-rose-50 text-rose-700 border-rose-200",
  morno: "bg-amber-50 text-amber-700 border-amber-200",
  frio: "bg-sky-50 text-sky-700 border-sky-200",
};

function tempoDesde(iso: string | null): string {
  if (!iso) return "";
  const min = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} dias`;
}

export default function Atendimentos({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const [itens, setItens] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Detalhe | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = async () => {
    setLoading(true);
    try {
      const res = await fetchApi("/corretor/atendimentos");
      if (res.ok) setItens(await res.json());
    } catch (e) {
      onAuthError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abrir = async (id: string) => {
    setAviso(null);
    setCopiado(false);
    try {
      const res = await fetchApi(`/corretor/atendimentos/${id}`);
      if (res.ok) setSel(await res.json());
    } catch (e) {
      onAuthError(e);
    }
  };

  const reanalisar = async () => {
    if (!sel) return;
    try {
      const res = await fetchApi(`/corretor/atendimentos/${sel.id}/analisar`, { method: "POST" });
      if (res.ok) setAviso("Análise pedida. Atualize em alguns segundos.");
    } catch (e) {
      onAuthError(e);
    }
  };

  const copiar = async (texto: string) => {
    await navigator.clipboard.writeText(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  const a = sel?.analise ?? {};

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center gap-3">
        <div>
          <h2 className="font-semibold text-slate-900 flex items-center gap-2">
            <MessagesSquare className="w-4 h-4 text-amber-600" /> Meus atendimentos
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Conversas com clientes no seu WhatsApp, analisadas pelo assistente. Só você vê esta lista.
          </p>
        </div>
        <button onClick={carregar} title="Atualizar" className="p-2 text-slate-400 hover:text-slate-600">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] lg:min-h-[420px]">
        <ul className="border-b lg:border-b-0 lg:border-r border-slate-100 divide-y divide-slate-100 max-h-[640px] overflow-y-auto">
          {itens.length === 0 && !loading && (
            <li className="p-6 text-sm text-slate-500">
              Nenhum atendimento ainda. Conecte seu número em <strong>Meu WhatsApp</strong>; as próximas conversas com
              clientes aparecem aqui.
            </li>
          )}
          {itens.map((it) => (
            <li key={it.id}>
              <button
                onClick={() => abrir(it.id)}
                className={`w-full text-left px-4 py-3 hover:bg-amber-50/40 ${sel?.id === it.id ? "bg-amber-50/60" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900 truncate">{it.nome || it.telefone_cliente}</span>
                  {it.aguardando_corretor ? (
                    <span className="shrink-0 text-[11px] font-medium text-rose-600">espera há {tempoDesde(it.ultima_do_cliente_em)}</span>
                  ) : (
                    <span className="shrink-0 text-[11px] text-slate-400">{tempoDesde(it.ultima_mensagem_em)}</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{it.resumo || "Aguardando análise…"}</p>
              </button>
            </li>
          ))}
        </ul>

        <div className="p-6">
          {!sel ? (
            <p className="text-sm text-slate-400">Escolha um atendimento para ver a análise e a sugestão de resposta.</p>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-slate-900">{sel.nome || sel.telefone_cliente}</h3>
                  {a.temperatura && (
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${COR_TEMPERATURA[a.temperatura] ?? ""}`}>{a.temperatura}</span>
                  )}
                </div>
                <button onClick={reanalisar} className="flex items-center gap-1.5 text-xs font-medium text-amber-700 hover:text-amber-800">
                  <Sparkles className="w-3.5 h-3.5" /> Analisar de novo
                </button>
              </div>
              {aviso && <p className="text-xs text-emerald-600">{aviso}</p>}

              {sel.imobiliario === false ? (
                <p className="text-sm text-slate-500">Esta conversa não parece ser um atendimento imobiliário.</p>
              ) : !sel.analisado_em ? (
                <p className="text-sm text-slate-500">A análise sai alguns minutos depois da última mensagem.</p>
              ) : (
                <div className="space-y-4">
                  {a.resumo && <p className="text-sm text-slate-700">{a.resumo}</p>}
                  {a.perfil && Object.keys(a.perfil).length > 0 && (
                    <p className="text-sm"><span className="text-slate-500">Procura:</span> {resumoPerfil(a.perfil)}</p>
                  )}
                  <div className="grid sm:grid-cols-2 gap-4">
                    {!!a.objecoes?.length && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Objeções</p>
                        <ul className="text-sm text-slate-700 list-disc pl-5">{a.objecoes.map((o) => <li key={o}>{o}</li>)}</ul>
                      </div>
                    )}
                    {!!a.alertas?.length && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Pendências</p>
                        <ul className="text-sm text-slate-700 list-disc pl-5">{a.alertas.map((o) => <li key={o}>{o}</li>)}</ul>
                      </div>
                    )}
                  </div>
                  {a.proximo_passo && (
                    <p className="text-sm"><span className="text-slate-500">Próximo passo:</span> {a.proximo_passo}</p>
                  )}
                  {a.sugestao_resposta && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Sugestão de resposta</p>
                        <button onClick={() => copiar(a.sugestao_resposta!)} className="flex items-center gap-1 text-xs font-medium text-amber-800 hover:text-amber-900">
                          {copiado ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copiado ? "Copiado" : "Copiar"}
                        </button>
                      </div>
                      <p className="text-sm text-slate-800 whitespace-pre-wrap">{a.sugestao_resposta}</p>
                      <p className="text-[11px] text-amber-700 mt-2">Complete os trechos entre [colchetes] antes de enviar.</p>
                    </div>
                  )}
                </div>
              )}

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Conversa</p>
                <div className="space-y-2 max-h-80 overflow-y-auto rounded-xl bg-slate-50 p-3">
                  {sel.mensagens.map((m, i) => (
                    <div key={i} className={`flex ${m.autor === "corretor" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                          m.autor === "corretor" ? "bg-amber-100 text-slate-800" : "bg-white border border-slate-200 text-slate-800"
                        }`}
                      >
                        {m.tipo === "audio" && <span className="text-[11px] text-slate-500 block">🎤 Áudio</span>}
                        {m.transcricao || m.conteudo || (m.tipo === "image" ? "📷 Foto" : m.tipo === "document" ? "📄 Documento" : "")}
                        <span className="block text-[10px] text-slate-400 mt-1 text-right">
                          {new Date(m.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
