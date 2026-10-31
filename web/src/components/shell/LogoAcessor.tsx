import React from "react";
import { MarcaIconeApp } from "@/components/marca/Marca";

interface Props {
  className?: string;
  /** Deixe vazio quando a marca já estiver descrita ao lado. */
  alt?: string;
  animada?: boolean;
  carregando?: boolean;
}

/** Ícone do Acessor Imobi (quadrado verde com o arco e o ponto). */
export default function LogoAcessor({ className = "w-9 h-9", alt = "", animada, carregando }: Props) {
  return <MarcaIconeApp className={className} alt={alt} animada={animada} carregando={carregando} />;
}
