"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";

/** Diálogo centralizado (folha no celular), fecha com Esc e clicando fora. */
export default function Janela({ titulo, subtitulo, onFechar, children }: { titulo: string; subtitulo?: string; onFechar: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onFechar]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" style={{ background: "rgba(0,0,0,.55)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div role="dialog" aria-modal="true" aria-label={titulo} className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-2xl p-5 space-y-4" style={{ background: "var(--card)", border: "1px solid var(--line)", color: "var(--text)" }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><h3 className="font-semibold break-words">{titulo}</h3>{subtitulo && <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>{subtitulo}</p>}</div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="p-1.5 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
