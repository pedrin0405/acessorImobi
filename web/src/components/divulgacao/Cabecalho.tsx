"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { MarcaHorizontal } from "@/components/marca/Marca";

const PORTAIS: Record<string, string> = { admin: "/tenant", corretor: "/corretor", developer: "/admin" };

export default function Cabecalho() {
  const [portal, setPortal] = useState<string | null>(null);
  const [rolou, setRolou] = useState(false);

  // Quem já entrou vai direto ao portal do seu perfil (lido depois de hidratar, para não piscar no servidor).
  useEffect(() => {
    try {
      const papel = localStorage.getItem("acessor_role");
      if (localStorage.getItem("acessor_token") && papel && PORTAIS[papel]) setPortal(PORTAIS[papel]);
    } catch { /* sem armazenamento: segue como visitante */ }
    const aoRolar = () => setRolou(window.scrollY > 12);
    aoRolar();
    window.addEventListener("scroll", aoRolar, { passive: true });
    return () => window.removeEventListener("scroll", aoRolar);
  }, []);

  const link = "text-[14px] font-medium transition-colors hover:text-white dv-foco px-1";
  return (
    <header
      className="fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300"
      style={{ background: rolou ? "rgb(4 8 7 / .94)" : "transparent", backdropFilter: rolou ? "blur(14px)" : "none", borderBottom: `1px solid ${rolou ? "rgb(255 255 255 / .07)" : "transparent"}` }}
    >
      <div className="mx-auto max-w-[1200px] h-[68px] px-5 sm:px-8 flex items-center justify-between gap-6">
        <Link href="/" className="dv-foco rounded-lg" aria-label="Acessor Imobi, página inicial">
          <MarcaHorizontal animada cor="#5cb98d" tinta="#f4f6f6" className="h-10 w-auto" />
        </Link>
        <nav aria-label="Seções da página" className="hidden md:flex items-center gap-7" style={{ color: "#a9bcb5" }}>
          <a href="#como-funciona" className={link}>Como funciona</a>
          <a href="#recursos" className={link}>Recursos</a>
          <a href="#seguranca" className={link}>Segurança</a>
        </nav>
        <Link
          href={portal ?? "/login"}
          className="dv-foco h-10 px-5 rounded-full text-[14px] font-semibold inline-flex items-center transition-colors hover:brightness-110"
          style={{ background: "#f4f6f6", color: "#0b1210" }}
        >
          {portal ? "Ir para o portal" : "Entrar"}
        </Link>
      </div>
    </header>
  );
}
