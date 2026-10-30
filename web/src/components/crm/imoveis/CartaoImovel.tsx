"use client";

import React, { useState } from "react";
import { Bath, BedDouble, Car, Check, Home, Ruler, Star } from "lucide-react";

export interface CartaoImovelProps {
  foto?: string | null;
  titulo: string;
  /** Linha pequena sob o título (cidade, código). */
  subtitulo?: string;
  /** Texto do valor já formatado; aparece sobre a foto. */
  preco?: string;
  /** Selo no canto da foto ("Venda", "Aluguel"). */
  selo?: string;
  rotuloPreco?: string;
  codigo?: string | number | null;
  quartos?: number | string | null;
  banheiros?: number | string | null;
  vagas?: number | string | null;
  area?: number | string | null;
  destaque?: boolean;
  /** Imóvel que saiu do Imoview: aparece esmaecido e marcado. */
  inativo?: boolean;
  selecionado?: boolean;
  /** Clique no cartão inteiro (abrir o detalhe ou marcar). Sem isso o cartão é só leitura. */
  onAbrir?: () => void;
  /** Clique na foto (ampliar), usado onde o cartão em si não é clicável. */
  onFoto?: (src: string) => void;
  ariaLabel?: string;
}

/** Cartão de imóvel com foto: o mesmo desenho nas Conversas, na página Imóveis e nas ações rápidas. */
export default function CartaoImovel(p: CartaoImovelProps) {
  const [falhou, setFalhou] = useState(false);
  const foto = p.foto && !falhou ? p.foto : null;
  const specs = [
    { Icone: BedDouble, v: p.quartos, r: "quartos" },
    { Icone: Bath, v: p.banheiros, r: "banheiros" },
    { Icone: Car, v: p.vagas, r: "vagas" },
    { Icone: Ruler, v: p.area, r: "m²", sufixo: " m²" },
  ].filter((s) => s.v !== null && s.v !== undefined && s.v !== "" && Number(s.v) !== 0);

  const imagem = (
    <div className="relative aspect-[4/3] w-full overflow-hidden" style={{ background: "var(--card-2)" }}>
      {foto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={foto}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFalhou(true)}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center" style={{ color: "var(--text-4)" }} aria-hidden>
          <Home className="w-8 h-8" />
        </div>
      )}
      {p.selo && <span className="absolute left-2 top-2 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-black/65 text-white backdrop-blur-sm">{p.selo}</span>}
      {p.destaque && (
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-black/65 text-white backdrop-blur-sm">
          <Star className="w-3 h-3" fill="currentColor" aria-hidden /> Destaque
        </span>
      )}
      {p.preco && (
        <span className={`absolute left-2 bottom-2 px-2 py-0.5 rounded-lg text-xs font-semibold ${foto ? "bg-black/70 text-white backdrop-blur-sm" : ""}`} style={foto ? undefined : { background: "var(--accent-soft)", color: "var(--accent-text)" }}>
          {p.preco}
        </span>
      )}
      {p.inativo && <span className="absolute right-2 bottom-2 px-2 py-0.5 rounded-md text-[11px] font-semibold" style={{ background: "var(--warn)", color: "var(--bg)" }}>Fora do Imoview</span>}
      {p.selecionado && (
        <span className="absolute right-2 top-2 w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "var(--accent)", color: "var(--bg)" }} aria-hidden>
          <Check className="w-4 h-4" />
        </span>
      )}
    </div>
  );

  const corpo = (
    <div className="p-3 space-y-2 flex-1">
      <h4 className="text-[13px] font-semibold leading-snug line-clamp-2" style={{ color: "var(--text)" }}>{p.titulo}</h4>
      {specs.length > 0 && (
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums" style={{ color: "var(--text-3)" }} aria-label="Características">
          {specs.map(({ Icone, v, r, sufixo }) => (
            <li key={r} className="inline-flex items-center gap-1" title={`${v} ${r}`}>
              <Icone className="w-3.5 h-3.5" aria-hidden />
              <span><span className="sr-only">{r}: </span>{v}{sufixo || ""}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-2 text-[11px]" style={{ color: "var(--text-4)" }}>
        <span className="truncate">{[p.rotuloPreco, p.subtitulo].filter(Boolean).join(" · ")}</span>
        {p.codigo ? <span className="font-mono shrink-0">Cód. {p.codigo}</span> : null}
      </div>
    </div>
  );

  const estilo: React.CSSProperties = {
    background: "var(--card)",
    border: `1px solid ${p.selecionado ? "var(--accent)" : "var(--line)"}`,
    opacity: p.inativo ? 0.6 : 1,
    boxShadow: p.selecionado ? "0 0 0 1px var(--accent)" : undefined,
  };

  if (p.onAbrir) {
    return (
      <button
        type="button"
        onClick={p.onAbrir}
        aria-label={p.ariaLabel}
        aria-pressed={p.selecionado === undefined ? undefined : p.selecionado}
        className="group w-full h-full flex flex-col text-left rounded-2xl overflow-hidden transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-[var(--line-2)]"
        style={estilo}
      >
        {imagem}
        {corpo}
      </button>
    );
  }
  return (
    <article className="group rounded-2xl overflow-hidden flex flex-col h-full" style={estilo}>
      {p.onFoto && foto ? (
        <button type="button" onClick={() => p.onFoto!(foto)} className="block w-full" aria-label={`Ampliar foto: ${p.titulo}`}>{imagem}</button>
      ) : imagem}
      {corpo}
    </article>
  );
}
