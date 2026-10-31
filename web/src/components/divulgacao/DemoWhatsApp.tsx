import React from "react";
import { FileText } from "lucide-react";
import { MarcaSimbolo } from "@/components/marca/Marca";
import FotoImovel from "./FotoImovel";

const IMOVEIS = [
  { tom: 0, titulo: "Apartamento · Orla 14", dados: "2 quartos · 1 vaga · 55 m²", valor: "R$ 480.000" },
  { tom: 1, titulo: "Flat · Graciosa", dados: "1 quarto · 35 m²", valor: "R$ 430.000" },
  { tom: 2, titulo: "Cobertura · Orla 14", dados: "3 suítes · 2 vagas · 140 m²", valor: "R$ 1.150.000" },
];

/** Conversa de exemplo com o agente no WhatsApp. É ilustrativa: os imóveis e valores não são reais. */
export default function DemoWhatsApp({ atrasoBase = 0.9 }: { atrasoBase?: number }) {
  const t = (n: number) => ({ animationDelay: `${atrasoBase + n}s` });
  return (
    <figure
      className="relative mx-auto w-full max-w-[372px] rounded-[2.4rem] p-2.5"
      style={{ background: "rgb(14 22 23 / .9)", border: "1px solid rgb(255 255 255 / .1)", boxShadow: "0 40px 90px -30px rgb(0 0 0 / .8), 0 0 80px -20px rgb(80 210 150 / .35)" }}
      aria-label="Exemplo ilustrativo de conversa com o Acessor no WhatsApp"
    >
      <div className="rounded-[1.9rem] overflow-hidden" style={{ background: "#0a1211" }}>
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: "#0f1a19", borderBottom: "1px solid rgb(255 255 255 / .06)" }}>
          <span className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "#2f7a58" }}>
            <MarcaSimbolo cor="#ffffff" className="w-5 h-5" />
          </span>
          <div className="leading-tight">
            <p className="text-[14px] font-semibold" style={{ color: "#f1f6f4" }}>Acessor</p>
            <p className="text-[11.5px]" style={{ color: "#7fbf9f" }}>agente da imobiliária</p>
          </div>
        </div>

        <div className="px-3.5 py-4 space-y-2.5 text-[13.5px] leading-snug" style={{ minHeight: 520 }}>
          <p className="dv-msg ml-auto max-w-[82%] rounded-2xl rounded-br-md px-3.5 py-2.5" style={{ ...t(0), background: "#1d5c42", color: "#eaf6f0" }}>
            me dá 3 opções de apartamento na Orla de Palmas, para venda
          </p>

          <div className="dv-msg max-w-[94%] rounded-2xl rounded-bl-md p-2.5 space-y-2" style={{ ...t(0.55), background: "#16211f", color: "#d9e6e1" }}>
            <p className="px-1 pt-0.5">Achei 3 opções. Mando com foto e o link do anúncio no site:</p>
            {IMOVEIS.map((im, i) => (
              <div key={im.titulo} className="dv-msg flex gap-2.5 rounded-xl p-1.5" style={{ ...t(1.05 + i * 0.25), background: "#0f1817", border: "1px solid rgb(255 255 255 / .06)" }}>
                <FotoImovel tom={im.tom} className="w-[74px] h-[74px] rounded-lg shrink-0" />
                <div className="min-w-0 flex-1 py-0.5">
                  <p className="text-[12.5px] font-semibold truncate" style={{ color: "#f1f6f4" }}>{im.titulo}</p>
                  <p className="text-[11.5px] truncate" style={{ color: "#8fa49d" }}>{im.dados}</p>
                  <p className="mt-0.5 text-[13px] font-bold" style={{ color: "#8fe9be" }}>{im.valor}</p>
                  <p className="text-[11px] underline underline-offset-2" style={{ color: "#7fbf9f" }}>Ver anúncio no site</p>
                </div>
              </div>
            ))}
          </div>

          <p className="dv-msg ml-auto max-w-[80%] rounded-2xl rounded-br-md px-3.5 py-2.5" style={{ ...t(2.1), background: "#1d5c42", color: "#eaf6f0" }}>
            monta um book em PDF desses
          </p>

          <div className="dv-msg max-w-[88%] rounded-2xl rounded-bl-md p-2.5" style={{ ...t(2.75), background: "#16211f", color: "#d9e6e1" }}>
            <div className="flex items-center gap-3 rounded-xl p-2.5" style={{ background: "#0f1817", border: "1px solid rgb(255 255 255 / .06)" }}>
              <span className="w-10 h-12 rounded-md flex items-center justify-center shrink-0" style={{ background: "#f4efe6", color: "#2f7a58" }}>
                <FileText className="w-5 h-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold truncate" style={{ color: "#f1f6f4" }}>Book · Orla de Palmas.pdf</p>
                <p className="text-[11.5px]" style={{ color: "#8fa49d" }}>3 imóveis, com fotos e dados</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-2.5 mb-0.5 text-center text-[11.5px]" style={{ color: "#7f918b" }}>Exemplo ilustrativo</figcaption>
    </figure>
  );
}
