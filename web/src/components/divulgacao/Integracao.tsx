import React from "react";
import Revelar from "./Revelar";

const DADOS = [
  { t: "Imóveis", d: "Com fotos, valores e o link do anúncio no site da imobiliária." },
  { t: "Leads e atendimentos", d: "Interações, visitas, propostas e negócios do CRM." },
  { t: "Etapa do funil", d: "Deduzida do que o Imoview registrou, não digitada de novo." },
];

export default function Integracao() {
  return (
    <section className="relative overflow-hidden" style={{ background: "#040807", color: "#d7e3df" }} aria-labelledby="dv-imoview">
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(700px 420px at 15% 100%, rgb(52 130 96 / .35), transparent 65%), radial-gradient(600px 380px at 90% 0%, rgb(40 110 80 / .3), transparent 65%)" }} />
      <div className="relative mx-auto max-w-[1200px] px-5 sm:px-8 py-24 lg:py-28">
        <Revelar>
          <h2 id="dv-imoview" className="dv-h2 max-w-[40rem]" style={{ color: "#f4f8f6" }}>Integrado ao Imoview</h2>
          <p className="mt-5 text-[17px] leading-relaxed max-w-[38rem]" style={{ color: "#a9bcb5" }}>
            O Acessor lê o que a imobiliária já mantém no CRM e devolve organizado: no WhatsApp, para quem está na rua, e no portal, para quem acompanha.
          </p>
        </Revelar>

        <Revelar atraso={100} className="mt-14">
          <div className="grid lg:grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-5 lg:gap-0">
            <No titulo="Imoview" sub="CRM da imobiliária" />
            <Linha />
            <No titulo="Acessor" sub="lê, organiza e responde" destaque />
            <Linha />
            <div className="space-y-3">
              <Destino>WhatsApp do corretor</Destino>
              <Destino>Portal do corretor</Destino>
              <Destino>Portal da imobiliária</Destino>
            </div>
          </div>
        </Revelar>

        <dl className="mt-16 grid md:grid-cols-3 gap-x-12 gap-y-8">
          {DADOS.map((x, i) => (
            <Revelar key={x.t} atraso={i * 90} className="pt-5" >
              <div style={{ borderTop: "1px solid rgb(255 255 255 / .14)" }} className="pt-5">
                <dt className="text-[17px] font-semibold" style={{ color: "#f1f6f4" }}>{x.t}</dt>
                <dd className="mt-2 text-[15px] leading-relaxed" style={{ color: "#9db0aa" }}>{x.d}</dd>
              </div>
            </Revelar>
          ))}
        </dl>
      </div>
    </section>
  );
}

function No({ titulo, sub, destaque }: { titulo: string; sub: string; destaque?: boolean }) {
  return (
    <div className="rounded-3xl px-7 py-6 text-center lg:min-w-[210px]" style={destaque ? { background: "rgb(47 132 96 / .18)", border: "1px solid rgb(143 233 190 / .5)", boxShadow: "0 0 60px -10px rgb(80 210 150 / .45)" } : { background: "rgb(255 255 255 / .04)", border: "1px solid rgb(255 255 255 / .12)" }}>
      <p className="text-[19px] font-bold" style={{ color: "#f4f8f6" }}>{titulo}</p>
      <p className="mt-1 text-[13px]" style={{ color: destaque ? "#9fe3c3" : "#8fa49d" }}>{sub}</p>
    </div>
  );
}

function Linha() {
  return (
    <div aria-hidden className="relative mx-auto lg:mx-0 w-px h-12 lg:w-auto lg:h-px lg:min-w-[64px]" style={{ background: "linear-gradient(90deg, rgb(143 233 190 / .1), rgb(143 233 190 / .5), rgb(143 233 190 / .1))" }}>
      <span className="dv-ponto hidden lg:block" />
    </div>
  );
}

function Destino({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl px-5 py-3 text-[14.5px] font-medium" style={{ background: "rgb(255 255 255 / .04)", border: "1px solid rgb(255 255 255 / .12)", color: "#e7f0ec" }}>
      {children}
    </div>
  );
}
