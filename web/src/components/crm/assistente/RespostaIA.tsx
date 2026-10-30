"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import Markdown from "./Markdown";

const reduzirMovimento = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Resposta da IA. Com `animar`, o texto aparece aos poucos (no máximo ~3 s, mesmo
 * para respostas longas); `pular` mostra tudo de uma vez.
 */
export default function RespostaIA({
  texto,
  animar,
  pular,
  onFim,
  onCresce,
}: {
  texto: string;
  animar: boolean;
  pular: boolean;
  onFim: () => void;
  onCresce: () => void;
}) {
  const direto = !animar || reduzirMovimento();
  const [n, setN] = useState(direto ? texto.length : 0);
  const [copiado, setCopiado] = useState(false);
  const fim = useRef(onFim);
  const cresce = useRef(onCresce);
  fim.current = onFim;
  cresce.current = onCresce;
  const terminou = n >= texto.length;

  useEffect(() => {
    if (direto) {
      fim.current();
      return;
    }
    const passo = Math.max(2, Math.ceil(texto.length / 180));
    let quadro = 0;
    let id = 0;
    const andar = () => {
      quadro += 1;
      setN((atual) => {
        const proximo = Math.min(texto.length, atual + passo);
        if (proximo >= texto.length) fim.current();
        return proximo;
      });
      if (quadro % 6 === 0) cresce.current();
      id = requestAnimationFrame(andar);
    };
    id = requestAnimationFrame(andar);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, direto]);

  useEffect(() => {
    if (pular && !terminou) {
      setN(texto.length);
      fim.current();
    }
  }, [pular, terminou, texto.length]);

  useEffect(() => {
    if (terminou) cresce.current();
  }, [terminou]);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      /* clipboard indisponível (http sem permissão): sem ação */
    }
  };

  return (
    <div className="group min-w-0">
      <Markdown texto={texto.slice(0, n)} />
      {!terminou && <span aria-hidden className="assist-caret inline-block w-[2px] h-4 ml-0.5 align-middle" style={{ background: "var(--accent)" }} />}
      {terminou && (
        <button
          type="button"
          onClick={copiar}
          aria-label="Copiar resposta"
          className="assist-fade mt-2 inline-flex items-center gap-1.5 px-2 py-1 -ml-2 rounded-lg text-xs opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-[var(--hover-solid)]"
          style={{ color: "var(--text-3)" }}
        >
          {copiado ? <Check className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} /> : <Copy className="w-3.5 h-3.5" />}
          {copiado ? "Copiado" : "Copiar"}
        </button>
      )}
    </div>
  );
}
