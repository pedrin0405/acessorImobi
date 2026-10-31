"use client";

import React, { useEffect, useMemo } from "react";
import Conversas from "./Conversas";
import { atendimentoParaConversa, type AtendimentoItem } from "./tipos";

/** "Conversas" do corretor: os clientes que falam com ele no WhatsApp pessoal, na mesma tela das Conversas da gestão. */
export default function ConversasAtendimentos({
  itens, carregando, todos, onTodos, onRecarregar, meuId, onAuthError, onIr, onAbrirCliente,
}: {
  itens: AtendimentoItem[];
  carregando: boolean;
  todos: boolean;
  onTodos: (v: boolean) => void;
  onRecarregar: () => void;
  meuId: string;
  onAuthError: (e: unknown) => boolean;
  onIr: (tab: string) => void;
  onAbrirCliente?: (leadId: string) => void;
}) {
  const conversas = useMemo(() => itens.map(atendimentoParaConversa), [itens]);

  // A lista se atualiza sozinha enquanto a tela está aberta e ao voltar o foco para a aba.
  useEffect(() => {
    const periodico = setInterval(() => { if (document.visibilityState === "visible") onRecarregar(); }, 30000);
    const aoVoltar = () => { if (document.visibilityState === "visible") onRecarregar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { clearInterval(periodico); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [onRecarregar]);

  return (
    <Conversas
      conversas={conversas}
      carregando={carregando}
      onRecarregar={onRecarregar}
      onAuthError={onAuthError}
      onIr={onIr}
      atendimentos={{ itens, todos, onTodos, meuId, onAbrirCliente }}
    />
  );
}
