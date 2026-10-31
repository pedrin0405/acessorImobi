"use client";

import React, { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

/** Mesma preferência do AppShell (`acessor_tema`): claro ou escuro, lembrado entre as telas e os portais. */
export type Tema = "escuro" | "claro";

const ler = (): Tema => {
  try {
    return localStorage.getItem("acessor_tema") === "claro" ? "claro" : "escuro";
  } catch {
    return "escuro";
  }
};

export function useTema() {
  const [tema, setTema] = useState<Tema>("escuro");
  useEffect(() => setTema(ler()), []);
  const alternar = () => {
    const novo: Tema = tema === "escuro" ? "claro" : "escuro";
    setTema(novo);
    try {
      localStorage.setItem("acessor_tema", novo);
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  };
  return { tema, alternar, classe: `app-tema ${tema === "claro" ? "app-claro" : ""}` };
}

/** Botão circular sol/lua, igual ao da barra do portal. */
export function BotaoTema({ tema, onClick }: { tema: Tema; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-11 h-11 rounded-full flex items-center justify-center transition-colors hover:bg-[var(--hover-solid)]"
      style={{ border: "1px solid var(--line)", color: "var(--text-3)", background: "var(--card)", boxShadow: "var(--sombra)" }}
      aria-label={tema === "escuro" ? "Usar tema claro" : "Usar tema escuro"}
      title={tema === "escuro" ? "Tema claro" : "Tema escuro"}
    >
      {tema === "escuro" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

/** Página de entrada: moldura do tema, brilho verde discreto atrás do cartão e o botão de tema no canto. */
export function TelaDeEntrada({ children }: { children: React.ReactNode }) {
  const { tema, alternar, classe } = useTema();
  return (
    <div className={`${classe} fixed inset-0 z-50 overflow-y-auto`} style={{ background: "var(--shell)", color: "var(--text-2)" }}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(560px 380px at 50% 48%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 70%)" }}
      />
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-10"><BotaoTema tema={tema} onClick={alternar} /></div>
      <div className="relative min-h-full flex flex-col items-center justify-center gap-6 px-4 py-16">{children}</div>
    </div>
  );
}
