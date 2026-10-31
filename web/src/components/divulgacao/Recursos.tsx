import React from "react";
import Revelar from "./Revelar";
import { DemoAnalise, DemoBook, DemoFluxo, DemoGestao } from "./Demos";

const BLOCOS = [
  {
    id: "imoveis",
    titulo: "Cartão com foto ou book em PDF, a escolha é de quem pede",
    texto: "O corretor pede imóveis e recebe cartões com foto, dados e o link do anúncio no site da imobiliária. Se prefere algo para mandar ao cliente, pede o book: capa, fotos, dados e contracapa, num PDF com a cara da imobiliária.",
    pontos: ["Modelos de book configuráveis pela própria imobiliária", "O mesmo pedido funciona no portal, no chat do Início"],
    demo: <DemoBook />,
  },
  {
    id: "fluxo",
    titulo: "O funil que o seu CRM já preenche",
    texto: "Leads e atendimentos do CRM viram o Fluxo do portal. A etapa de cada lead é deduzida do que o CRM registrou (visita, proposta, negócio) e os valores vêm do próprio CRM.",
    pontos: ["Valor do negócio vindo do CRM, com a origem de cada número", "Popup completo em cada card: linha do tempo, imóveis, interações e agenda"],
    demo: <DemoFluxo />,
    largo: true,
  },
  {
    id: "conversas",
    titulo: "Cada atendimento lido, resumido e com a próxima resposta pronta",
    texto: "No portal do corretor, as conversas dele com os clientes no WhatsApp pessoal são lidas pelo assistente: resumo, temperatura, próximos passos e uma sugestão de resposta gerada na hora. O corretor edita e envia pelo próprio WhatsApp.",
    pontos: ["Trechos que só o corretor sabe saem entre colchetes, para ele completar", "Nada é enviado sozinho"],
    demo: <DemoAnalise />,
  },
  {
    id: "gestao",
    titulo: "A imobiliária enxerga a equipe inteira",
    texto: "Visão Geral de gestão, conversas dos corretores com o agente, e a linha do tempo de cada cliente com tudo o que o corretor fez. Roleta de leads, modelos de book e configurações no mesmo lugar.",
    pontos: ["Painel por corretor, com foto do WhatsApp e preferências", "Trilha de auditoria das ações"],
    demo: <DemoGestao />,
  },
];

export default function Recursos() {
  return (
    <section id="recursos" className="app-tema app-claro dv-ancora" style={{ background: "var(--card-2)", borderTop: "1px solid var(--line)" }} aria-labelledby="dv-recursos">
      <div className="mx-auto max-w-[1200px] px-5 sm:px-8 pt-24 lg:pt-32 pb-8">
        <Revelar>
          <h2 id="dv-recursos" className="dv-h2 max-w-[44rem]" style={{ color: "var(--text)" }}>Um assistente para o corretor, um painel para quem gere</h2>
        </Revelar>
      </div>
      <div className="mx-auto max-w-[1200px] px-5 sm:px-8 pb-24 lg:pb-32 space-y-24 lg:space-y-32 mt-14">
        {BLOCOS.map((b, i) => (
          <article key={b.id} className={`grid gap-10 lg:gap-14 items-center ${b.largo ? "" : "lg:grid-cols-2 lg:gap-20"}`}>
            <Revelar className={b.largo ? "max-w-[44rem]" : i % 2 ? "lg:order-2" : ""}>
              <h3 className="dv-h3 !text-[clamp(1.5rem,2.4vw,2rem)] !leading-[1.12]" style={{ color: "var(--text)" }}>{b.titulo}</h3>
              <p className="mt-4 text-[16.5px] leading-relaxed max-w-[34rem]" style={{ color: "var(--text-3)" }}>{b.texto}</p>
              <ul className="mt-6 space-y-2.5 max-w-[34rem]">
                {b.pontos.map((p) => (
                  <li key={p} className="flex gap-3 text-[15px] leading-snug" style={{ color: "var(--text-2)" }}>
                    <span aria-hidden className="mt-[9px] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--accent)" }} />
                    {p}
                  </li>
                ))}
              </ul>
            </Revelar>
            <Revelar atraso={120} className={b.largo ? "" : i % 2 ? "lg:order-1" : ""}>{b.demo}</Revelar>
          </article>
        ))}
      </div>
    </section>
  );
}
