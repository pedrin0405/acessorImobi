"use client";

import React, { useState } from "react";
import Revelar from "./Revelar";
import { PERGUNTAS } from "./perguntas";

export default function Faq() {
  const [aberta, setAberta] = useState<number | null>(0);
  return (
    <section id="perguntas" className="app-tema app-claro dv-ancora" style={{ background: "var(--card-2)", borderTop: "1px solid var(--line)" }} aria-labelledby="dv-faq">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-8 py-24 lg:py-[128px] grid lg:grid-cols-[.8fr_1.2fr] gap-12 lg:gap-24">
        <Revelar className="lg:sticky lg:top-[112px] self-start">
          <h2 id="dv-faq" className="dv-h2" style={{ color: "var(--text)" }}>Perguntas frequentes</h2>
          <p className="dv-corpo mt-4 max-w-[28rem]" style={{ color: "var(--text-3)" }}>
            O que costuma aparecer antes de começar. Se a sua dúvida não está aqui, fale com a nossa equipe.
          </p>
        </Revelar>

        <Revelar>
          <ul className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--line)", boxShadow: "var(--sombra)" }}>
            {PERGUNTAS.map((q, i) => {
              const abre = aberta === i;
              return (
                <li key={q.p} style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
                  <h3>
                    <button
                      type="button" id={`dv-q-${i}`} aria-expanded={abre} aria-controls={`dv-r-${i}`}
                      onClick={() => setAberta(abre ? null : i)}
                      className="dv-faq-botao dv-foco-quadrado w-full flex items-center justify-between gap-4 px-6 py-4 text-left"
                    >
                      <span className="text-[17px] font-semibold" style={{ color: "var(--text)" }}>{q.p}</span>
                      <span aria-hidden className="dv-faq-mais" data-aberto={abre ? "" : undefined}><i /><i /></span>
                    </button>
                  </h3>
                  <div id={`dv-r-${i}`} role="region" aria-labelledby={`dv-q-${i}`} className="dv-faq-corpo" data-aberto={abre ? "" : undefined}>
                    <div className="overflow-hidden min-h-0">
                      <p className="dv-corpo px-6 pb-6 max-w-[40rem]" style={{ color: "var(--text-3)" }}>{q.r}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Revelar>
      </div>
    </section>
  );
}
