"use client";

import React, { useState } from "react";
import Revelar from "./Revelar";
import FotoImovel from "./FotoImovel";

const PAGINAS = [
  { t: "Capa", l1: "Seleção de imóveis", l2: "Preparada para você" },
  { t: "Imóvel", l1: "Apartamento, 3 quartos", l2: "Fotos, dados e link do anúncio" },
  { t: "Contracapa", l1: "Fale com o seu corretor", l2: "Contato e imobiliária" },
];

/** Três páginas A4 em leque que se abrem ao passar o mouse, tocar ou focar. Exemplo ilustrativo do estilo Editorial. */
export default function BookEmLeque() {
  const [aberto, setAberto] = useState(false);
  return (
    <section className="app-tema app-claro" style={{ background: "var(--bg)" }} aria-labelledby="dv-book">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-8 py-24 lg:py-[128px] grid lg:grid-cols-[1fr_1.1fr] gap-12 lg:gap-24 items-center">
        <Revelar>
          <h2 id="dv-book" className="dv-h2" style={{ color: "var(--text)" }}>Um book pronto para o cliente, em um pedido</h2>
          <p className="dv-corpo mt-4 max-w-[30rem]" style={{ color: "var(--text-3)" }}>
            O corretor escolhe os imóveis e o Acessor monta o PDF com capa, fotos, dados e link do anúncio. A imobiliária define o modelo e o corretor só envia.
          </p>
        </Revelar>
        <Revelar>
          <div
            className="dv-leque relative mx-auto w-full max-w-[560px] h-[420px] sm:h-[400px]" data-aberto={aberto ? "" : undefined}
            onPointerEnter={() => setAberto(true)} onPointerLeave={() => setAberto(false)}
            onFocus={() => setAberto(true)} onBlur={() => setAberto(false)} onClick={() => setAberto((v) => !v)}
            tabIndex={0} role="group" aria-label="Exemplo ilustrativo de book em PDF, três páginas"
          >
            {PAGINAS.map((pg, i) => (
              <div key={pg.t} className="dv-pagina dv-serifa" style={{ color: "#1b2420" }}>
                {i === 0 ? (
                  <div className="h-full p-6 flex flex-col justify-between" style={{ background: "linear-gradient(160deg,#0f2a20,#17402f)", color: "#f4f6f1" }}>
                    <span className="text-[11px] tracking-[.2em] uppercase opacity-80">{pg.t}</span>
                    <div>
                      <p className="text-[26px] leading-[1.1]">{pg.l1}</p>
                      <p className="mt-3 text-[13px] opacity-80">{pg.l2}</p>
                    </div>
                  </div>
                ) : i === 1 ? (
                  <div className="h-full flex flex-col">
                    <div className="h-[48%] overflow-hidden"><FotoImovel tom={2} className="w-full h-full" /></div>
                    <div className="p-4 flex-1 flex flex-col gap-2">
                      <p className="text-[18px] leading-tight">{pg.l1}</p>
                      <p className="text-[12px] opacity-70">{pg.l2}</p>
                      <div className="mt-auto grid grid-cols-3 gap-2 text-[11px]">
                        {["Quartos", "Suítes", "Vagas"].map((x) => <span key={x} className="rounded-lg px-2 py-2" style={{ background: "#eef0e8" }}>{x}</span>)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full p-6 flex flex-col justify-end" style={{ background: "#eef0e8" }}>
                    <p className="text-[20px] leading-tight">{pg.l1}</p>
                    <p className="mt-2 text-[12px] opacity-70">{pg.l2}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-center text-[13px] mt-4" style={{ color: "var(--text-3)" }}>Exemplo ilustrativo</p>
        </Revelar>
      </div>
    </section>
  );
}
