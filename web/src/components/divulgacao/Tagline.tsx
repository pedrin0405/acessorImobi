"use client";

import React, { useRef } from "react";
import Brilho from "./Brilho";
import { useAoRolar, useMovimentoReduzido } from "./ganchos";

const FRASE = "O corretor pede no WhatsApp. O Acessor busca no seu CRM, monta o book e deixa o funil em dia. Você só confirma o que importa.";

/**
 * Lema em tipografia grande. Cada palavra sai do tom apagado para o texto cheio quando cruza a linha de gatilho
 * (a 62% da altura da janela), na ordem de leitura. Com movimento reduzido já aparece tudo.
 */
export default function Tagline() {
  const reduzido = useMovimentoReduzido();
  const bloco = useRef<HTMLParagraphElement | null>(null);
  const palavras = FRASE.split(" ");

  useAoRolar(() => {
    const el = bloco.current;
    if (!el) return;
    const gatilho = window.innerHeight * 0.62;
    el.querySelectorAll<HTMLElement>("[data-p]").forEach((p) => {
      if (p.getBoundingClientRect().top < gatilho) p.setAttribute("data-ativa", "");
      else p.removeAttribute("data-ativa");
    });
  }, []);

  return (
    <section className="relative overflow-hidden" style={{ background: "#040807", color: "#f4f8f6" }} aria-labelledby="dv-lema">
      <Brilho />
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(700px 420px at 12% 100%, rgb(52 130 96 / .35), transparent 70%)" }} />
      <div className="relative mx-auto max-w-[1200px] px-4 sm:px-8 py-24 lg:py-[160px]">
        <h2 id="dv-lema" className="sr-only">Lema do Acessor Imobi</h2>
        <p ref={bloco} className="dv-lema max-w-[680px]" aria-hidden>
          {palavras.map((p, i) => (
            <React.Fragment key={i}>
              <span data-p data-ativa={reduzido ? "" : undefined} className="dv-palavra">{p}</span>{" "}
            </React.Fragment>
          ))}
        </p>
        <p className="sr-only">{FRASE}</p>
      </div>
    </section>
  );
}
