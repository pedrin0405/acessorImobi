"use client";

import { useEffect, useRef, useState } from "react";

/** Verdadeiro quando a pessoa pediu menos movimento no sistema; os efeitos mostram direto o estado final. */
export function useMovimentoReduzido(): boolean {
  const [reduzido, setReduzido] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduzido(m.matches);
    const f = () => setReduzido(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return reduzido;
}

/** Executa `f` no máximo uma vez por quadro enquanto a página rola ou muda de tamanho (nunca um listener solto). */
export function useAoRolar(f: () => void, deps: unknown[] = []) {
  useEffect(() => {
    let pendente = false;
    const rodar = () => {
      if (pendente) return;
      pendente = true;
      requestAnimationFrame(() => {
        pendente = false;
        f();
      });
    };
    rodar();
    window.addEventListener("scroll", rodar, { passive: true });
    window.addEventListener("resize", rodar);
    return () => {
      window.removeEventListener("scroll", rodar);
      window.removeEventListener("resize", rodar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Progresso (0 a 1) de um bloco atravessando a linha de leitura a 60% da altura da janela. */
export function useProgressoDeRolagem<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [progresso, setProgresso] = useState(0);
  useAoRolar(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const linha = window.innerHeight * 0.6;
    setProgresso(Math.min(1, Math.max(0, (linha - r.top) / r.height)));
  }, []);
  return { ref, progresso };
}
