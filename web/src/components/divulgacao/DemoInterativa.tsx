"use client";

import React, { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import FotoImovel from "./FotoImovel";
import Revelar from "./Revelar";
import { useMovimentoReduzido } from "./ganchos";

type Id = "opcoes" | "book" | "resposta";

const PEDIDOS: { id: Id; rotulo: string }[] = [
  { id: "opcoes", rotulo: "3 opções com vista para o lago" },
  { id: "book", rotulo: "Monte um book em PDF" },
  { id: "resposta", rotulo: "O que respondo ao cliente?" },
];

const IMOVEIS = [
  { tom: 0, titulo: "Apartamento · Vista lago", dados: "2 quartos · 1 vaga · 55 m²" },
  { tom: 1, titulo: "Casa · Condomínio fechado", dados: "3 suítes · 2 vagas · 180 m²" },
  { tom: 2, titulo: "Casa · Piscina e área gourmet", dados: "4 suítes · 4 vagas · 320 m²" },
];

function Realce({ texto }: { texto: string }) {
  return (
    <>
      {texto.split(/(\[[^\]]+\])/g).map((t, i) =>
        t.startsWith("[") ? <mark key={i} className="rounded px-1" style={{ background: "rgb(92 185 141 / .22)", color: "#8fe9be" }}>{t.slice(1, -1)}</mark> : <React.Fragment key={i}>{t}</React.Fragment>,
      )}
    </>
  );
}

/** Demonstração clicável. Tudo é ilustrativo: nada aqui consulta dados reais. */
export default function DemoInterativa() {
  const reduzido = useMovimentoReduzido();
  const [id, setId] = useState<Id>("opcoes");
  const [etapa, setEtapa] = useState(3);
  const timers = useRef<number[]>([]);

  const limpar = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const rodar = (novo: Id) => {
    limpar();
    setId(novo);
    if (reduzido) { setEtapa(3); return; }
    setEtapa(0);
    [500, 1700, 2300].forEach((ms, i) => timers.current.push(window.setTimeout(() => setEtapa(i + 1), ms)));
  };
  useEffect(() => limpar, []);

  const pedido = PEDIDOS.find((p) => p.id === id)!.rotulo;
  const digitando = etapa === 1;

  return (
    <section className="relative overflow-hidden" style={{ background: "#07100d", color: "#f4f8f6" }} aria-labelledby="dv-demo">
      <div className="relative mx-auto max-w-[1200px] px-4 sm:px-8 py-24 lg:py-[128px] grid lg:grid-cols-[.9fr_1.1fr] gap-12 lg:gap-24 items-center">
        <Revelar>
          <h2 id="dv-demo" className="dv-h2">Experimente um pedido</h2>
          <p className="dv-corpo mt-4 max-w-[28rem]" style={{ color: "#9fb2aa" }}>Escolha uma das frases e veja como o Acessor responde no WhatsApp.</p>
          <div className="mt-8 flex flex-wrap gap-2" role="group" aria-label="Pedidos de exemplo">
            {PEDIDOS.map((p) => (
              <button
                key={p.id} type="button" onClick={() => rodar(p.id)} aria-pressed={id === p.id}
                className="dv-pedido dv-foco h-12 px-5 rounded-full text-[15px] font-semibold"
                style={id === p.id ? { background: "#f4f6f6", color: "#07100d", border: "1px solid #f4f6f6" } : { background: "rgb(255 255 255 / .05)", color: "#dce6e1", border: "1px solid rgb(255 255 255 / .12)" }}
              >
                {p.rotulo}
              </button>
            ))}
          </div>
          <p className="mt-6 text-[13px]" style={{ color: "#7d908a" }}>Exemplo ilustrativo</p>
        </Revelar>

        <Revelar>
          <div className="mx-auto w-full max-w-[420px] rounded-3xl p-3" style={{ background: "rgb(14 22 23 / .9)", border: "1px solid rgb(255 255 255 / .1)", boxShadow: "0 40px 90px -30px rgb(0 0 0 / .8)" }}>
            <div className="rounded-2xl p-4 space-y-3 text-[14px] leading-snug min-h-[420px]" style={{ background: "#0a1211" }} aria-live="polite">
              <p key={id} className="dv-msg ml-auto max-w-[82%] rounded-2xl rounded-br-md px-3.5 py-2.5" style={{ background: "#1d5c42", color: "#eaf6f0" }}>{pedido}</p>

              {digitando && (
                <div className="dv-digitando dv-msg inline-flex gap-1 rounded-2xl rounded-bl-md px-4 py-3.5" style={{ background: "#16211f" }} aria-label="O Acessor está digitando">
                  {[0, 1, 2].map((n) => <span key={n} className="w-1.5 h-1.5 rounded-full" style={{ background: "#8fa49d" }} />)}
                </div>
              )}

              {etapa >= 2 && id === "opcoes" && (
                <div className="dv-msg rounded-2xl rounded-bl-md p-2.5 space-y-2" style={{ background: "#16211f", color: "#d9e6e1" }}>
                  <p className="px-1">Achei 3 opções:</p>
                  {IMOVEIS.map((im, i) => (
                    <div key={im.titulo} className="dv-msg flex gap-2.5 rounded-xl p-1.5" style={{ animationDelay: `${i * 0.18}s`, background: "#0f1817", border: "1px solid rgb(255 255 255 / .06)" }}>
                      <FotoImovel tom={im.tom} className="w-[64px] h-[64px] rounded-lg shrink-0" />
                      <div className="min-w-0 py-0.5">
                        <p className="text-[13px] font-semibold truncate" style={{ color: "#f1f6f4" }}>{im.titulo}</p>
                        <p className="text-[12px]" style={{ color: "#8fa49d" }}>{im.dados}</p>
                        <p className="text-[11.5px] underline underline-offset-2" style={{ color: "#7fbf9f" }}>Ver anúncio no site</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {etapa >= 2 && id === "book" && (
                <div className="dv-msg rounded-2xl rounded-bl-md p-2.5" style={{ background: "#16211f", color: "#d9e6e1" }}>
                  <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: "#0f1817", border: "1px solid rgb(255 255 255 / .06)" }}>
                    <span className="dv-folha w-11 h-14 rounded-md flex items-center justify-center shrink-0" style={{ background: "#f4efe6", color: "#2f7a58" }}><FileText className="w-5 h-5" aria-hidden /></span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold" style={{ color: "#f1f6f4" }}>Book de imóveis.pdf</p>
                      <p className="text-[12px]" style={{ color: "#8fa49d" }}>Capa, 3 imóveis e contracapa</p>
                    </div>
                  </div>
                  <p className="px-1 pt-2">Pronto. Quer que eu envie ao cliente?</p>
                </div>
              )}

              {etapa >= 2 && id === "resposta" && (
                <div className="dv-msg rounded-2xl rounded-bl-md p-3 space-y-3" style={{ background: "#16211f", color: "#d9e6e1" }}>
                  <p><b style={{ color: "#f1f6f4" }}>Resumo.</b> O cliente busca <Realce texto="[2 quartos]" /> até <Realce texto="[R$ 500 mil]" /> e pediu para ver a <Realce texto="[Cobertura Orla 14]" />.</p>
                  <p className="rounded-xl p-2.5" style={{ background: "#0f1817", border: "1px solid rgb(255 255 255 / .06)" }}><b style={{ color: "#f1f6f4" }}>Sugestão.</b> Olá! Posso agendar a visita para <Realce texto="[amanhã às 15h]" />?</p>
                </div>
              )}

              {etapa >= 3 && (
                <p className="dv-msg text-[12px]" style={{ color: "#7d908a" }}>O Acessor prepara. Quem envia ao cliente é o corretor.</p>
              )}
            </div>
          </div>
        </Revelar>
      </div>
    </section>
  );
}
