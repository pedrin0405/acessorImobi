"use client";

import { useEffect, useState } from "react";
import { fetchApi } from "@/lib/api";

// Fotos dos corretores por id, carregadas uma vez da lista de corretores e compartilhadas entre as telas.
type Mapa = Record<string, string | null>;
let mapa: Mapa = {};
let carregando: Promise<void> | null = null;
let carregado = false;
const ouvintes = new Set<() => void>();

function carregar(): Promise<void> {
  if (!carregando) {
    carregando = fetchApi("/admin/corretores")
      .then(async (r) => {
        if (!r.ok) return;
        const lista = (await r.json()) as { id: string; foto_url?: string | null }[];
        mapa = Object.fromEntries(lista.map((c) => [c.id, c.foto_url ?? null]));
        carregado = true;
        ouvintes.forEach((f) => f());
      })
      .catch(() => undefined)
      .finally(() => { carregando = null; });
  }
  return carregando;
}

/** Força nova leitura (ex.: depois de atualizar a foto de um corretor). */
export function atualizarFotosCorretores() { return carregar(); }

export function useFotoCorretor(id: string | null | undefined): string | null {
  const [, forcar] = useState(0);
  useEffect(() => {
    const f = () => forcar((n) => n + 1);
    ouvintes.add(f);
    if (!carregado) carregar();
    return () => { ouvintes.delete(f); };
  }, []);
  return id ? mapa[id] ?? null : null;
}
