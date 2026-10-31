import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import DemoWhatsApp from "./DemoWhatsApp";

const PARTICULAS = [
  { x: 8, y: 30, t: 3, d: 0, s: 7 }, { x: 46, y: 18, t: 2, d: 1.4, s: 8 }, { x: 92, y: 26, t: 3, d: 2.2, s: 6.5 },
  { x: 60, y: 70, t: 2, d: 0.8, s: 7.5 }, { x: 22, y: 76, t: 2, d: 3, s: 8.5 }, { x: 78, y: 86, t: 3, d: 1.8, s: 7 },
];

export default function Heroi() {
  return (
    <section className="relative overflow-hidden" style={{ background: "#040807", color: "#d7e3df" }} aria-labelledby="dv-titulo">
      <div
        aria-hidden
        className="dv-luz pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(900px 640px at 2% 0%, rgb(52 130 96 / .7), transparent 62%), radial-gradient(760px 560px at 100% 100%, rgb(40 110 80 / .5), transparent 60%), radial-gradient(520px 420px at 72% 38%, rgb(70 190 140 / .16), transparent 70%)" }}
      />
      {PARTICULAS.map((p, i) => (
        <span key={i} aria-hidden className="entrada-particula absolute rounded-full" style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.t, height: p.t, background: "#7be0b3", animationDelay: `${p.d}s`, animationDuration: `${p.s}s` }} />
      ))}

      <div className="relative mx-auto max-w-[1200px] px-5 sm:px-8 pt-32 pb-20 lg:pt-40 lg:pb-28 grid lg:grid-cols-[1.08fr_.92fr] gap-14 lg:gap-10 items-center">
        <div>
          <h1 id="dv-titulo" className="dv-h1 dv-entra" style={{ color: "#f4f8f6", animationDelay: ".05s" }}>
            Peça no WhatsApp.
            <br />
            <span style={{ color: "#8fe9be" }}>O Acessor busca no Imoview e organiza o resto.</span>
          </h1>
          <p className="dv-entra mt-6 max-w-[34rem] text-[17px] sm:text-[18px] leading-relaxed" style={{ color: "#a9bcb5", animationDelay: ".2s" }}>
            Assistente de IA para corretores de imóveis, com um portal para a imobiliária e outro para cada corretor, integrados ao CRM Imoview.
          </p>
          <div className="dv-entra mt-9 flex flex-wrap items-center gap-3" style={{ animationDelay: ".35s" }}>
            <Link
              href="/login"
              className="dv-foco h-[54px] px-7 rounded-full inline-flex items-center justify-center gap-2 w-full sm:w-auto text-[16px] font-semibold text-white transition-[filter,transform] hover:brightness-110 active:scale-[0.99]"
              style={{ background: "#2f8460", boxShadow: "0 16px 36px -14px rgb(80 210 150 / .6)" }}
            >
              Acessar o portal <ArrowRight className="w-4 h-4" aria-hidden />
            </Link>
            <a
              href="#como-funciona"
              className="dv-foco h-[54px] px-7 rounded-full inline-flex items-center justify-center w-full sm:w-auto text-[16px] font-semibold transition-colors hover:bg-white/5"
              style={{ border: "1px solid rgb(255 255 255 / .22)", color: "#e7f0ec" }}
            >
              Ver como funciona
            </a>
          </div>
          <ul className="dv-entra mt-10 flex flex-wrap gap-x-7 gap-y-2 text-[14px]" style={{ color: "#8fa49d", animationDelay: ".5s" }}>
            {["Texto ou áudio", "Cartão com foto ou book em PDF", "Confirma antes de gravar"].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: "#5cd1a0" }} />
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="dv-entra" style={{ animationDelay: ".45s" }}>
          <DemoWhatsApp />
        </div>
      </div>
    </section>
  );
}
