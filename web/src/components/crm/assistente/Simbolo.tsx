import React from "react";
import LogoAcessor from "@/components/shell/LogoAcessor";

/** Símbolo do assistente: respira em repouso e orbita mais rápido enquanto a IA pensa. */
export default function Simbolo({ pensando = false, tamanho = 64 }: { pensando?: boolean; tamanho?: number }) {
  const miolo = Math.round(tamanho * 0.75);
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: tamanho, height: tamanho }} aria-hidden>
      <span className="absolute inset-0 rounded-full blur-xl assist-breathe" style={{ background: "var(--accent)", opacity: 0.35 }} />
      <span className={`absolute inset-0 ${pensando ? "assist-orbit-fast" : "assist-orbit"}`}>
        <span className="absolute left-1/2 top-0 -translate-x-1/2 rounded-full" style={{ width: 5, height: 5, background: "var(--accent)", boxShadow: "0 0 8px var(--accent)" }} />
      </span>
      <span className="relative flex items-center justify-center overflow-hidden rounded-2xl" style={{ width: miolo, height: miolo }}>
        <LogoAcessor className="w-full h-full" />
      </span>
    </span>
  );
}
