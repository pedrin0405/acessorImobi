"use client";

import React from "react";
import Revelar from "./Revelar";
import { useProgressoDeRolagem } from "./ganchos";

const PEDIDOS = [
  "3 opções com vista para o lago",
  "registra a Ana: 2 quartos, até 3 mil",
  "agenda visita amanhã às 15h",
  "move o Carlos para proposta",
];

const PASSOS = [
  {
    titulo: "O corretor pede, do jeito que fala",
    texto: "Por texto ou por áudio, no WhatsApp. Buscar imóveis, registrar um cliente e o que ele procura, abrir ou mover um negócio, marcar uma visita.",
  },
  {
    titulo: "O Acessor consulta o seu CRM e responde",
    texto: "Os imóveis vêm do cadastro sincronizado do seu CRM: cartão com foto, dados e o link do anúncio no site da imobiliária, ou um book em PDF. Antes de gravar qualquer coisa no CRM, ele pede a confirmação do corretor.",
  },
  {
    titulo: "O resultado cai no CRM e no portal",
    texto: "Cliente, perfil de busca, negócio no funil e compromisso na agenda aparecem no portal do corretor e no da imobiliária, sem digitar duas vezes.",
  },
];

export default function ComoFunciona() {
  const { ref, progresso } = useProgressoDeRolagem<HTMLOListElement>();
  return (
    <section id="como-funciona" className="app-tema app-claro dv-ancora" style={{ background: "var(--bg)" }} aria-labelledby="dv-como">
      <div className="mx-auto max-w-[1200px] px-5 sm:px-8 py-24 lg:py-32 grid lg:grid-cols-[.85fr_1.15fr] gap-14 lg:gap-24">
        <Revelar className="lg:sticky lg:top-28 self-start">
          <h2 id="dv-como" className="dv-h2" style={{ color: "var(--text)" }}>Do pedido ao CRM, sem sair do WhatsApp</h2>
          <p className="mt-5 text-[17px] leading-relaxed max-w-[30rem]" style={{ color: "var(--text-3)" }}>
            O corretor continua conversando como já conversa. O trabalho de buscar, anotar e atualizar fica com o assistente.
          </p>
          <ul className="mt-8 flex flex-wrap gap-2.5" aria-label="Exemplos de pedidos">
            {PEDIDOS.map((p) => (
              <li key={p} className="px-4 h-10 inline-flex items-center rounded-full text-[14px]" style={{ background: "var(--card)", border: "1px solid var(--line)", color: "var(--text-2)", boxShadow: "var(--sombra)" }}>
                “{p}”
              </li>
            ))}
          </ul>
        </Revelar>

        <ol ref={ref} className="relative space-y-12">
          <span aria-hidden className="dv-linha-base" />
          <span aria-hidden className="dv-linha-prog" style={{ ["--p" as string]: progresso }} />
          {PASSOS.map((p, i) => (
            <Revelar como="li" key={p.titulo} atraso={i * 90} className="relative pl-14">
              <span aria-hidden className="dv-no absolute left-0 top-1.5 w-[24px] h-[24px] rounded-full flex items-center justify-center" data-ativo={progresso >= (i + 0.2) / PASSOS.length ? "" : undefined}>
                <i className="w-2 h-2 rounded-full" />
              </span>
              <h3 className="dv-h3" style={{ color: "var(--text)" }}>{p.titulo}</h3>
              <p className="mt-3 text-[16.5px] leading-relaxed max-w-[36rem]" style={{ color: "var(--text-3)" }}>{p.texto}</p>
            </Revelar>
          ))}
        </ol>
      </div>
    </section>
  );
}
