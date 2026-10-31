import React from "react";

/** Imagens de exemplo geradas por IA (imóveis fictícios), otimizadas em /public/divulgacao. */
const FOTOS = [
  { src: "/divulgacao/apartamento.jpg", pos: "30% 50%" },
  { src: "/divulgacao/casa-condominio.jpg", pos: "45% 50%" },
  { src: "/divulgacao/casa-piscina.jpg", pos: "40% 50%" },
];

export default function FotoImovel({ tom = 0, className = "" }: { tom?: number; className?: string }) {
  const f = FOTOS[tom % FOTOS.length];
  return (
    <div aria-hidden className={`relative overflow-hidden bg-[#dfe7e4] ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={f.src} alt="" loading="lazy" decoding="async" draggable={false} className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: f.pos }} />
    </div>
  );
}
