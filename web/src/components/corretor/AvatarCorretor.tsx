"use client";

import React, { useEffect, useState } from "react";
import { fetchApi } from "@/lib/api";

// A foto sai por rota autenticada (não há URL pública), então vem como blob e fica em cache por versão.
const cache = new Map<string, Promise<string | null>>();

function carregarFoto(caminho: string): Promise<string | null> {
  let p = cache.get(caminho);
  if (!p) {
    p = fetchApi(caminho)
      .then(async (r) => (r.ok ? URL.createObjectURL(await r.blob()) : null))
      .catch(() => null);
    cache.set(caminho, p);
  }
  return p;
}

export default function AvatarCorretor({ nome, fotoUrl, tamanho = 40 }: { nome: string | null; fotoUrl?: string | null; tamanho?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    setSrc(null);
    if (fotoUrl) carregarFoto(fotoUrl).then((u) => vivo && setSrc(u));
    return () => { vivo = false; };
  }, [fotoUrl]);

  const iniciais = (nome || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="shrink-0 rounded-full object-cover" style={{ width: tamanho, height: tamanho, background: "var(--card-2)" }} onError={() => setSrc(null)} />
  ) : (
    <span aria-hidden className="shrink-0 rounded-full flex items-center justify-center font-semibold" style={{ width: tamanho, height: tamanho, fontSize: tamanho * 0.38, background: "var(--accent-soft)", color: "var(--accent-text)" }}>{iniciais}</span>
  );
}
