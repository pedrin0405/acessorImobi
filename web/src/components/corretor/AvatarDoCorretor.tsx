"use client";

import React from "react";
import AvatarCorretor from "./AvatarCorretor";
import { useFotoCorretor } from "./useCorretoresFoto";

/** Avatar a partir do id do corretor: a foto do WhatsApp vem do mapa compartilhado, com iniciais como reserva. */
export default function AvatarDoCorretor({ id, nome, tamanho = 28, fotoUrl }: { id?: string | null; nome: string | null; tamanho?: number; fotoUrl?: string | null }) {
  const foto = useFotoCorretor(id);
  return <AvatarCorretor nome={nome} fotoUrl={fotoUrl ?? foto} tamanho={tamanho} />;
}
