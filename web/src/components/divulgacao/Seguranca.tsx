import React from "react";
import { Check } from "lucide-react";
import Revelar from "./Revelar";

const GARANTIAS = [
  { t: "Dados isolados por imobiliária", d: "Cada imobiliária enxerga apenas o que é dela." },
  { t: "O corretor vê só o que é dele", d: "Clientes, negócios, agenda e conversas ficam restritos à carteira de cada um." },
  { t: "Corretor novo passa por aprovação", d: "Ninguém entra na equipe sem o aval da imobiliária." },
  { t: "Trilha de auditoria", d: "As ações importantes ficam registradas, com quem fez e quando." },
];

export default function Seguranca() {
  return (
    <section id="seguranca" className="app-tema app-claro dv-ancora" style={{ background: "var(--bg)" }} aria-labelledby="dv-seguranca">
      <div className="mx-auto max-w-[1200px] px-5 sm:px-8 py-24 lg:py-32 grid lg:grid-cols-[1fr_1fr] gap-14 lg:gap-24 items-start">
        <Revelar>
          <h2 id="dv-seguranca" className="dv-h2" style={{ color: "var(--text)" }}>O assistente nunca envia nada sozinho</h2>
          <p className="mt-6 text-[18px] leading-relaxed max-w-[32rem]" style={{ color: "var(--text-3)" }}>
            Ele busca, resume, sugere e prepara. Mensagem para cliente só sai quando o corretor manda, e o que vai para o CRM passa antes por uma confirmação.
          </p>
        </Revelar>

        <ul className="divide-y" style={{ borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", borderColor: "var(--line)" }}>
          {GARANTIAS.map((g, i) => (
            <Revelar como="li" key={g.t} atraso={i * 80} className="flex gap-4 py-6">
              <span aria-hidden className="mt-1 w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}>
                <Check className="w-3.5 h-3.5" strokeWidth={3} />
              </span>
              <div>
                <p className="text-[17px] font-semibold" style={{ color: "var(--text)" }}>{g.t}</p>
                <p className="mt-1 text-[15px] leading-relaxed" style={{ color: "var(--text-3)" }}>{g.d}</p>
              </div>
            </Revelar>
          ))}
        </ul>
      </div>
    </section>
  );
}
