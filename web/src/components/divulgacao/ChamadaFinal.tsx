import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MarcaSimbolo } from "@/components/marca/Marca";
import Revelar from "./Revelar";

export default function ChamadaFinal() {
  return (
    <section className="relative overflow-hidden" style={{ background: "#040807", color: "#d7e3df" }} aria-labelledby="dv-final">
      <div aria-hidden className="dv-luz pointer-events-none absolute inset-0" style={{ background: "radial-gradient(900px 560px at 50% 110%, rgb(52 130 96 / .6), transparent 65%), radial-gradient(500px 340px at 50% 20%, rgb(70 190 140 / .18), transparent 70%)" }} />
      <Revelar className="relative mx-auto max-w-[880px] px-5 sm:px-8 py-28 lg:py-36 text-center">
        <MarcaSimbolo animada cor="#8fe9be" className="w-16 h-auto mx-auto" />
        <h2 id="dv-final" className="dv-h2 mt-8" style={{ color: "#f4f8f6" }}>Entre no portal da sua imobiliária</h2>
        <p className="mt-5 text-[17px] leading-relaxed max-w-[34rem] mx-auto" style={{ color: "#a9bcb5" }}>
          Corretor, imobiliária ou desenvolvedor: o acesso é pelo mesmo lugar. Tema claro e escuro, no computador e no celular.
        </p>
        <Link
          href="/login"
          className="dv-foco mt-9 h-[56px] px-8 rounded-full inline-flex items-center gap-2 text-[16px] font-semibold text-white transition-[filter,transform] hover:brightness-110 active:scale-[0.99]"
          style={{ background: "#2f8460", boxShadow: "0 16px 36px -14px rgb(80 210 150 / .6)" }}
        >
          Acessar o portal <ArrowRight className="w-4 h-4" aria-hidden />
        </Link>
      </Revelar>
    </section>
  );
}
