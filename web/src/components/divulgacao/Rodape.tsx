import React from "react";
import Link from "next/link";
import { MarcaHorizontal } from "@/components/marca/Marca";

export default function Rodape() {
  return (
    <footer style={{ background: "#040807", borderTop: "1px solid rgb(255 255 255 / .08)", color: "#8fa49d" }}>
      <div className="mx-auto max-w-[1200px] px-5 sm:px-8 py-8 flex flex-wrap items-center justify-between gap-4 text-[13.5px]">
        <MarcaHorizontal cor="#5cb98d" tinta="#f4f6f6" className="h-8 w-auto" alt="Acessor Imobi" />
        <p>© {new Date().getFullYear()} Acessor Imobi. Todos os direitos reservados.</p>
        <Link href="/login" className="dv-foco font-semibold transition-colors hover:text-white" style={{ color: "#c9d8d2" }}>Entrar</Link>
      </div>
    </footer>
  );
}
