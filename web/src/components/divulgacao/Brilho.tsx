"use client";

import React, { useEffect, useRef } from "react";

/**
 * Luz discreta que acompanha o ponteiro sobre o palco escuro. Fica atrás do conteúdo, só aparece com mouse
 * (não em toque) e não existe com movimento reduzido. Coloque dentro de uma seção `relative`.
 */
export default function Brilho() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    const pai = el?.parentElement;
    if (!el || !pai) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !window.matchMedia("(hover: hover)").matches) return;
    let quadro = 0;
    let x = 0;
    let y = 0;
    const mover = (e: PointerEvent) => {
      const r = pai.getBoundingClientRect();
      x = e.clientX - r.left;
      y = e.clientY - r.top;
      if (quadro) return;
      quadro = requestAnimationFrame(() => {
        quadro = 0;
        el.style.setProperty("--mx", `${x}px`);
        el.style.setProperty("--my", `${y}px`);
      });
    };
    const entrar = () => el.setAttribute("data-ativo", "");
    const sair = () => el.removeAttribute("data-ativo");
    pai.addEventListener("pointermove", mover, { passive: true });
    pai.addEventListener("pointerenter", entrar);
    pai.addEventListener("pointerleave", sair);
    return () => {
      pai.removeEventListener("pointermove", mover);
      pai.removeEventListener("pointerenter", entrar);
      pai.removeEventListener("pointerleave", sair);
      if (quadro) cancelAnimationFrame(quadro);
    };
  }, []);

  return <div ref={ref} aria-hidden className="dv-brilho" />;
}
