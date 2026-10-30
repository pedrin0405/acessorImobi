import React from "react";

interface Props {
  tema: "claro" | "escuro";
  className?: string;
  alt?: string;
}

/**
 * Marca horizontal do acessorImobi para a barra lateral.
 * O arquivo claro tem o nome "Acessor" em preto; o escuro, em branco.
 */
export default function LogoAcessorHorizontal({
  tema,
  className = "w-36 h-auto",
  alt = "Acessor Imobi",
}: Props) {
  const src =
    tema === "claro"
      ? "/logo-acessorimobi-horizontal-claro.png"
      : "/logo-acessorimobi-horizontal-escuro.png";

  return (
    <img
      src={src}
      alt={alt}
      width={1080}
      height={349}
      className={`shrink-0 ${className}`}
      draggable={false}
    />
  );
}
