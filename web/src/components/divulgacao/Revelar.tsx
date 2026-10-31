"use client";

import React, { useEffect, useRef } from "react";

/**
 * Faz o bloco subir e aparecer quando entra na tela. Sem JavaScript (ou com movimento reduzido) o conteúdo
 * fica visível desde o início: só escondemos o que está abaixo da dobra, depois de hidratar.
 */
export default function Revelar({
  children, atraso = 0, className = "", como = "div", id,
}: {
  children: React.ReactNode; atraso?: number; className?: string; como?: "div" | "section" | "li" | "article"; id?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return; // já está à vista
    el.dataset.estado = "oculto";
    const obs = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          el.dataset.estado = "visto";
          obs.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const Tag = como as React.ElementType;
  return (
    <Tag ref={ref} id={id} className={`dv-revelar ${className}`} style={atraso ? { transitionDelay: `${atraso}ms` } : undefined}>
      {children}
    </Tag>
  );
}
