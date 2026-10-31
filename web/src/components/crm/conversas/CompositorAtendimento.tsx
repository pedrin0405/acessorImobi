"use client";

import React, { useState } from "react";
import { BookOpen, Building2, Check, Copy, Lightbulb, UserRound, X } from "lucide-react";
import type { AcaoRapidaCompositor } from "./CompositorConversa";

/**
 * Lugar do campo de mensagem nos atendimentos. O corretor responde pelo próprio WhatsApp (o Acessor só observa),
 * então aqui ficam as ações rápidas, que mandam o material para o WhatsApp dele encaminhar, e a sugestão de resposta.
 */
export default function CompositorAtendimento({
  sugestao, onAcao, erro,
}: {
  sugestao: string | null;
  onAcao: (a: AcaoRapidaCompositor) => void;
  erro: string | null;
}) {
  const [aberta, setAberta] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const ACOES: [AcaoRapidaCompositor, string, React.ComponentType<{ className?: string }>][] = [
    ["imoveis", "Receber imóveis", Building2], ["book", "Receber book em PDF", BookOpen], ["lead", "Receber ficha do cliente", UserRound],
  ];

  const copiar = async () => {
    if (!sugestao) return;
    try { await navigator.clipboard.writeText(sugestao); setCopiado(true); setTimeout(() => setCopiado(false), 1800); } catch { /* sem permissão para a área de transferência */ }
  };

  return (
    <div className="px-4 pb-4 pt-3">
      {erro && <p role="alert" className="mb-2 text-xs" style={{ color: "var(--danger)" }}>{erro}</p>}
      {aberta && sugestao && (
        <div className="assist-fade mb-3 rounded-2xl p-3.5" style={{ background: "var(--card)", border: "1px solid var(--line-2)" }}>
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--accent-text)" }}><Lightbulb className="w-3.5 h-3.5" aria-hidden /> Sugestão do Acessor</p>
            <button type="button" onClick={() => setAberta(false)} aria-label="Fechar sugestão" className="p-1 rounded hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}><X className="w-4 h-4" /></button>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text)" }}>{sugestao}</p>
          <button type="button" onClick={copiar} className="mt-2.5 inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] hover:bg-[var(--hover-solid)]" style={{ border: "1px solid var(--line-2)", color: "var(--text-2)" }}>
            {copiado ? <Check className="w-3.5 h-3.5" aria-hidden /> : <Copy className="w-3.5 h-3.5" aria-hidden />} {copiado ? "Copiado" : "Copiar para colar no WhatsApp"}
          </button>
        </div>
      )}
      <p className="text-xs mb-2" style={{ color: "var(--text-3)" }}>Você responde pelo seu WhatsApp; aqui o Acessor acompanha e ajuda.</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => sugestao && setAberta((v) => !v)}
          disabled={!sugestao}
          title={sugestao ? undefined : "Ainda sem sugestão: peça uma nova análise nos detalhes."}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-full text-sm hover:bg-[var(--hover-solid)] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ border: "1px solid var(--line-2)", color: "var(--text-2)" }}
        >
          <Lightbulb className="w-4 h-4" style={{ color: "var(--accent)" }} aria-hidden /> Sugerir resposta
        </button>
        {ACOES.map(([id, rotulo, Icone]) => (
          <button key={id} type="button" onClick={() => onAcao(id)} className="inline-flex items-center gap-2 h-10 px-4 rounded-full text-sm hover:bg-[var(--hover-solid)]" style={{ border: "1px solid var(--line-2)", color: "var(--text-2)" }}>
            <Icone className="w-4 h-4" aria-hidden /> {rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}
