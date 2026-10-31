import React from "react";
import { MarcaHorizontal } from "@/components/marca/Marca";

interface Props {
  /** Mantido por compatibilidade: a marca segue o tema pelas variáveis CSS. */
  tema?: "claro" | "escuro";
  className?: string;
  alt?: string;
  animada?: boolean;
}

/** Marca horizontal do Acessor Imobi para a barra lateral e cabeçalhos. */
export default function LogoAcessorHorizontal({ className = "w-36 h-auto", alt = "Acessor Imobi", animada }: Props) {
  return <MarcaHorizontal className={className} alt={alt} animada={animada} />;
}
