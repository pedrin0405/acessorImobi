import React from "react";
import { MARCA } from "./caminhos";

/**
 * Marca do Acessor Imobi: um arco com extremidades redondas e um ponto, e o nome em duas linhas.
 * Em linha (SVG), então segue o tema pelas variáveis CSS: o símbolo usa o verde de ação e o nome a cor do texto.
 * Animações (entrada e carregamento) ficam em globals.css (.marca-animada / .marca-carregando) e respeitam
 * `prefers-reduced-motion`.
 */
const [SX, SY, SW, SH] = MARCA.simboloBox;
const [PX, PY, PR] = MARCA.ponto;

interface Base {
  className?: string;
  /** Texto para leitores de tela; vazio quando o nome já está escrito ao lado. */
  alt?: string;
  /** Desenha o arco, salta o ponto e sobe o nome uma vez ao aparecer. */
  animada?: boolean;
  /** Anima sem parar (telas de carregamento). */
  carregando?: boolean;
}

const classes = (b: Base, extra = "") =>
  [extra, b.animada ? "marca-animada" : "", b.carregando ? "marca-carregando" : "", b.className ?? ""].filter(Boolean).join(" ");

const aria = (alt?: string) => (alt ? { role: "img" as const, "aria-label": alt } : { "aria-hidden": true as const });

function Desenho({ cor, anim }: { cor: string; anim?: boolean }) {
  return (
    <>
      <path
        className="m-arco" d={MARCA.arco} fill="none" stroke={cor} strokeWidth={MARCA.arcoLargura}
        strokeLinecap="round" strokeLinejoin="round" {...(anim ? { pathLength: 1 } : {})}
      />
      <circle className="m-ponto" cx={PX} cy={PY} r={PR} fill={cor} />
    </>
  );
}

/** Só o símbolo (arco e ponto), na cor pedida (padrão: verde de ação do tema). */
export function MarcaSimbolo({ cor = "var(--accent)", ...b }: Base & { cor?: string }) {
  return (
    <svg viewBox={`${SX} ${SY} ${SW} ${SH}`} className={classes(b, "shrink-0")} {...aria(b.alt)}>
      <Desenho cor={cor} anim />
    </svg>
  );
}

/** Ícone de aplicativo: quadrado arredondado verde com o símbolo branco. */
export function MarcaIconeApp({ raio = 58, ...b }: Base & { raio?: number }) {
  const esc = 0.62;
  return (
    <svg viewBox="0 0 256 256" className={classes(b, "shrink-0")} {...aria(b.alt)}>
      <rect width="256" height="256" rx={raio} fill="var(--accent-strong, #2f7a58)" />
      <g transform={`translate(${(256 - SW * esc) / 2 - SX * esc} ${(256 - SH * esc) / 2 - SY * esc + 4}) scale(${esc})`}>
        <Desenho cor="#ffffff" anim />
      </g>
    </svg>
  );
}

/** Símbolo à esquerda e "Acessor / Imobi" à direita. */
export function MarcaHorizontal({ cor = "var(--accent)", tinta = "var(--text)", ...b }: Base & { cor?: string; tinta?: string }) {
  const h = MARCA.horizontal;
  return (
    <svg viewBox={`0 0 ${h.w} ${h.h}`} className={classes(b, "shrink-0")} {...aria(b.alt)}>
      <g transform={`translate(${-SX} ${-SY})`}><Desenho cor={cor} anim /></g>
      <g transform={`translate(${h.textoX} ${h.topo})`}><g className="m-forte"><path d={MARCA.forte} fill={tinta} /></g></g>
      <g transform={`translate(${h.textoX} ${h.topo + h.linha2})`}><g className="m-leve"><path d={MARCA.leve} fill={tinta} /></g></g>
    </svg>
  );
}

/** Símbolo em cima, nome centralizado embaixo (telas de entrada). */
export function MarcaVertical({ cor = "var(--accent)", tinta = "var(--text)", ...b }: Base & { cor?: string; tinta?: string }) {
  const v = MARCA.vertical;
  const cx = v.w / 2;
  const base = SH + 26;
  return (
    <svg viewBox={`0 0 ${v.w} ${v.h}`} className={classes(b, "shrink-0")} {...aria(b.alt)}>
      <g transform={`translate(${cx - SW / 2 - SX} ${-SY})`}><Desenho cor={cor} anim /></g>
      <g transform={`translate(${cx - MARCA.forteLargura / 2} ${base + 74})`}><g className="m-forte"><path d={MARCA.forte} fill={tinta} /></g></g>
      <g transform={`translate(${cx - MARCA.leveLargura / 2} ${base + 74 + 74 + 18})`}><g className="m-leve"><path d={MARCA.leve} fill={tinta} /></g></g>
    </svg>
  );
}
