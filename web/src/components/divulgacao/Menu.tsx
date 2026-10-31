"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MarcaHorizontal } from "@/components/marca/Marca";
import { useAoRolar } from "./ganchos";

const PORTAIS: Record<string, string> = { admin: "/tenant", corretor: "/corretor", developer: "/admin" };

const LINKS = [
  { id: "como-funciona", rotulo: "Como funciona" },
  { id: "recursos", rotulo: "Recursos" },
  { id: "seguranca", rotulo: "Segurança" },
  { id: "perguntas", rotulo: "Perguntas" },
];

/** Barra flutuante: pílula translúcida afastada da borda; no celular o menu abre em painel de altura inteira. */
export default function Menu() {
  const [portal, setPortal] = useState<string | null>(null);
  const [rolou, setRolou] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState<string | null>(null);

  // Quem já entrou vai direto ao portal do seu perfil (lido depois de hidratar, para não piscar no servidor).
  useEffect(() => {
    try {
      const papel = localStorage.getItem("acessor_role");
      if (localStorage.getItem("acessor_token") && papel && PORTAIS[papel]) setPortal(PORTAIS[papel]);
    } catch { /* sem armazenamento: segue como visitante */ }
  }, []);

  // Seção atual: a última cujo topo já passou de 40% da altura da janela.
  useAoRolar(() => {
    setRolou(window.scrollY > 24);
    let atual: string | null = null;
    for (const l of LINKS) {
      const el = document.getElementById(l.id);
      if (el && el.getBoundingClientRect().top < window.innerHeight * 0.4) atual = l.id;
    }
    setAtivo(atual);
  }, []);

  useEffect(() => {
    document.body.style.overflow = aberto ? "hidden" : "";
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [aberto]);

  const painel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (aberto) painel.current?.removeAttribute("inert");
    else painel.current?.setAttribute("inert", "");
  }, [aberto]);

  const destino = portal ?? "/login";
  const rotuloEntrar = portal ? "Ir para o portal" : "Entrar";

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4 pointer-events-none">
        <div className="dv-pilula pointer-events-auto w-full max-w-[880px] h-[56px] pl-4 pr-2 rounded-full flex items-center justify-between gap-4" data-rolou={rolou ? "" : undefined}>
          <Link href="/" className="dv-foco rounded-lg shrink-0" aria-label="Acessor Imobi, página inicial" onClick={() => setAberto(false)}>
            <MarcaHorizontal animada cor="#5cb98d" tinta="#f4f6f6" className="h-8 w-auto" />
          </Link>

          <nav aria-label="Seções da página" className="hidden md:flex items-center gap-1">
            {LINKS.map((l) => (
              <a key={l.id} href={`#${l.id}`} aria-current={ativo === l.id ? "true" : undefined} className="dv-link-menu dv-foco">{l.rotulo}</a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link href={destino} className="dv-botao-claro dv-foco h-10 px-4 rounded-full text-[14px] font-semibold inline-flex items-center">
              {rotuloEntrar}
            </Link>
            <button
              type="button" className="dv-menu-botao dv-foco md:hidden" aria-label={aberto ? "Fechar menu" : "Abrir menu"} aria-expanded={aberto} aria-controls="dv-painel"
              onClick={() => setAberto((v) => !v)}
            >
              <span aria-hidden className="dv-menu-linhas" data-aberto={aberto ? "" : undefined}><i /><i /></span>
            </button>
          </div>
        </div>
      </header>

      <div id="dv-painel" className="dv-painel md:hidden" data-aberto={aberto ? "" : undefined} aria-hidden={!aberto} ref={painel}>
        <nav aria-label="Menu" className="flex flex-col gap-2 px-6 pt-[96px]">
          {LINKS.map((l, i) => (
            <a key={l.id} href={`#${l.id}`} onClick={() => setAberto(false)} className="dv-painel-link dv-foco" style={{ ["--i" as string]: i }} aria-current={ativo === l.id ? "true" : undefined}>
              {l.rotulo}
            </a>
          ))}
          <Link href={destino} onClick={() => setAberto(false)} className="dv-painel-link dv-botao-verde dv-foco mt-4 h-14 rounded-full inline-flex items-center justify-center text-[16px] font-semibold text-white" style={{ ["--i" as string]: LINKS.length }}>
            {rotuloEntrar}
          </Link>
        </nav>
      </div>
    </>
  );
}
