"use client";

import React, { createContext, useContext } from "react";

export type Papel = "admin" | "corretor";

const PapelContext = createContext<Papel>("admin");

/** Quem está logado no portal compartilhado: a equipe da imobiliária ou um corretor (acesso só à própria carteira). */
export function PapelProvider({ papel, children }: { papel: Papel; children: React.ReactNode }) {
  return <PapelContext.Provider value={papel}>{children}</PapelContext.Provider>;
}

export const usePapel = (): Papel => useContext(PapelContext);
export const useEhCorretor = (): boolean => useContext(PapelContext) === "corretor";
