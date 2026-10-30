import React from "react";

interface Props {
  className?: string;
  /** Deixe vazio quando a marca já estiver descrita ao lado. */
  alt?: string;
}

/** Marca oficial do acessorImobi: casa e balão de conversa sobre o verde da marca. */
export default function LogoAcessor({ className = "w-9 h-9", alt = "" }: Props) {
  return (
    <img
      src="/logo-acessorimobi.svg"
      alt={alt}
      width={1024}
      height={1024}
      className={`shrink-0 ${className}`}
      draggable={false}
    />
  );
}
