"use client";

import React, { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { MarcaSimbolo } from "@/components/marca/Marca";

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

/**
 * Página de entrada no desenho do Kleo: palco escuro com luz verde nos cantos, uma moldura arredondada dividida em
 * dois painéis (formulário claro à esquerda, painel escuro com a marca à direita). O palco é sempre escuro e o
 * formulário sempre claro, independentemente do tema do portal.
 */
export function TelaDeEntrada({ children, topo }: { children: React.ReactNode; topo?: React.ReactNode }) {
  return (
    <div className="app-tema fixed inset-0 z-50 overflow-y-auto" style={{ background: "#040807", color: "#d7e3df" }}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(900px 620px at 4% 2%, rgb(52 130 96 / .75), transparent 62%), radial-gradient(760px 560px at 98% 98%, rgb(40 110 80 / .55), transparent 60%), radial-gradient(520px 420px at 50% 110%, rgb(30 90 65 / .35), transparent 70%)",
        }}
      />
      <div className="relative min-h-full flex flex-col items-center justify-center gap-5 px-4 py-10 sm:px-8">
        {topo}
        <div
          className="w-full max-w-[1120px] rounded-[2.5rem] p-3 sm:p-4"
          style={{ background: "rgb(11 17 18 / .92)", border: "1px solid rgb(255 255 255 / .07)", boxShadow: "0 30px 80px -20px rgb(0 0 0 / .7), inset 0 1px 0 rgb(255 255 255 / .05)" }}
        >
          <div className="grid lg:grid-cols-2 rounded-[2rem] overflow-hidden min-h-[600px]">
            <div className="app-claro app-tema flex items-center justify-center px-6 py-10 sm:px-12 lg:px-14" style={{ background: "#f8faf9", color: "var(--text-2)" }}>
              <div className="w-full max-w-[420px]">{children}</div>
            </div>
            <PainelDaMarca />
          </div>
        </div>
      </div>
    </div>
  );
}

const PARTICULAS = [
  { x: 14, y: 22, t: 3, d: 0, s: 6.5 }, { x: 82, y: 16, t: 2, d: 1.2, s: 7.5 }, { x: 70, y: 52, t: 3, d: 2.1, s: 6 },
  { x: 24, y: 58, t: 2, d: 0.6, s: 8 }, { x: 90, y: 40, t: 2, d: 3, s: 7 }, { x: 8, y: 44, t: 3, d: 1.8, s: 6.8 },
  { x: 58, y: 12, t: 2, d: 2.6, s: 7.2 }, { x: 36, y: 30, t: 2, d: 3.4, s: 8.4 },
];

/** Painel escuro da direita: vidro verde com a marca acesa, partículas e o aviso de direitos autorais. */
function PainelDaMarca() {
  return (
    <div className="hidden lg:flex relative flex-col justify-between overflow-hidden" style={{ background: "#030606" }}>
      <div aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(420px 360px at 50% 34%, rgb(70 190 140 / .30), transparent 70%)" }} />
      {PARTICULAS.map((p, i) => (
        <span key={i} aria-hidden className="entrada-particula absolute rounded-full" style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.t, height: p.t, background: "#7be0b3", animationDelay: `${p.d}s`, animationDuration: `${p.s}s` }} />
      ))}
      <div className="relative flex-1 flex items-center justify-center pt-16">
        <div className="entrada-vidro relative flex items-center justify-center rounded-[2.2rem]" style={{ width: 210, height: 210 }}>
          <MarcaSimbolo animada cor="#8fe9be" className="w-[62%] h-auto" />
        </div>
      </div>
      <div className="relative m-6 sm:m-8 rounded-3xl px-6 py-5 text-center" style={{ background: "rgb(3 6 6 / .85)", border: "1px solid rgb(255 255 255 / .12)" }}>
        <p className="flex items-center justify-center gap-2 text-[15px] font-semibold" style={{ color: "#f1f6f4" }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#5cd1a0" }} />
          © {new Date().getFullYear()} Acessor Imobi. Todos os direitos reservados.
        </p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: "#9db0aa" }}>
          O uso ou reprodução não autorizada de qualquer conteúdo desta plataforma é estritamente proibido.
        </p>
      </div>
    </div>
  );
}
