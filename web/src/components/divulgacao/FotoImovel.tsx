import React from "react";

const PALETAS = [
  { ceu: "#cfe9df", chao: "#f3ead9", predio: "#2f7a58", sol: "#fff6df" },
  { ceu: "#d8e6ef", chao: "#f2e5d3", predio: "#35617a", sol: "#fff3d6" },
  { ceu: "#e6e1cd", chao: "#f4ead8", predio: "#667a3d", sol: "#fffbe6" },
];

/** Foto ilustrativa desenhada em CSS (sem imagens externas): céu, sol e três prédios com janelas. */
export default function FotoImovel({ tom = 0, className = "" }: { tom?: number; className?: string }) {
  const p = PALETAS[tom % PALETAS.length];
  const janelas = "repeating-linear-gradient(0deg, transparent 0 9px, rgb(255 255 255 / .38) 9px 11px), repeating-linear-gradient(90deg, transparent 0 9px, rgb(255 255 255 / .22) 9px 10px)";
  return (
    <div aria-hidden className={`relative overflow-hidden ${className}`} style={{ background: `linear-gradient(180deg, ${p.ceu} 0%, ${p.chao} 100%)` }}>
      <span className="absolute rounded-full" style={{ width: "20%", aspectRatio: "1", right: "13%", top: "12%", background: p.sol, opacity: 0.9 }} />
      <span className="absolute bottom-0 left-[10%] w-[24%] h-[52%] rounded-t-[3px]" style={{ background: p.predio, opacity: 0.72, backgroundImage: janelas }} />
      <span className="absolute bottom-0 left-[36%] w-[27%] h-[72%] rounded-t-[3px]" style={{ background: p.predio, backgroundImage: janelas }} />
      <span className="absolute bottom-0 left-[65%] w-[22%] h-[44%] rounded-t-[3px]" style={{ background: p.predio, opacity: 0.58, backgroundImage: janelas }} />
      <span className="absolute inset-x-0 bottom-0 h-[8%]" style={{ background: "rgb(17 26 31 / .16)" }} />
    </div>
  );
}
