"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fetchApi } from "@/lib/api";
import Conversas from "./Conversas";
import { atendimentoParaConversa, type AtendimentoItem } from "./tipos";

/** "Conversas" do corretor: os clientes que falam com ele no WhatsApp pessoal, na mesma tela das Conversas da gestão. */
export default function ConversasAtendimentos({
  itens, erro, carregando, todos, onTodos, onRecarregar, meuId, onAuthError, onIr, onAbrirCliente,
}: {
  itens: AtendimentoItem[];
  /** A busca da lista falhou: a tela diz isso em vez de fingir que não há conversas. */
  erro?: string | null;
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

  // Lista vazia: descobre o motivo (assistente desligado, WhatsApp fora, nada lido ainda) e oferece o próximo passo.
  const [diag, setDiag] = useState<{ whatsapp: string; assistente_ativo: boolean; ultima_leitura_em: string | null; atendimentos: number; dias_lidos: number } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const carregarDiag = useCallback(async () => {
    try { const r = await fetchApi("/corretor/atendimentos/diagnostico"); if (r.ok) setDiag(await r.json()); } catch { /* sem diagnóstico: fica o texto padrão */ }
  }, []);
  useEffect(() => { if (itens.length === 0 && !carregando) carregarDiag(); }, [itens.length, carregando, carregarDiag]);

  const executar = async (chamada: () => Promise<Response>, depois?: string) => {
    setOcupado(true); setAviso(null);
    try {
      const r = await chamada();
      if (!r.ok) { const d = await r.json().catch(() => null); setAviso(d?.detail || "Não foi possível agora."); }
      else if (depois) setAviso(depois);
    } catch (e) { if (!onAuthError(e)) setAviso("Não foi possível agora."); }
    setOcupado(false);
    await carregarDiag(); onRecarregar();
  };

  const vazio = useMemo(() => {
    if (itens.length > 0) return undefined;
    if (erro) return { titulo: "Não foi possível carregar seus atendimentos", detalhe: erro, acao: { rotulo: "Tentar de novo", onClick: onRecarregar } };
    if (!diag) return undefined;
    if (diag.whatsapp !== "connected") return { titulo: "WhatsApp não conectado", detalhe: "Conecte seu número em Configurações para o Acessor acompanhar suas conversas com clientes.", acao: { rotulo: "Ir para Configurações", onClick: () => onIr("configuracoes") } };
    if (!diag.assistente_ativo) return {
      titulo: "O assistente está desligado",
      detalhe: "Com ele desligado nada é lido do seu WhatsApp. Ligue para o Acessor buscar as conversas dos últimos dias e acompanhar as novas.",
      acao: { rotulo: "Ligar o assistente", ocupado, onClick: () => executar(async () => {
        const atual = await fetchApi("/corretor/assistente"); const prefs = atual.ok ? await atual.json() : { avisos: true, carteira_auto: true };
        return fetchApi("/corretor/assistente", { method: "PUT", body: JSON.stringify({ ...prefs, ativo: true }) });
      }, "Assistente ligado. As conversas dos últimos dias aparecem em instantes.") },
    };
    return {
      titulo: aviso ?? "Nenhum atendimento nos últimos dias",
      detalhe: `Seu WhatsApp está conectado. O Acessor lê as conversas individuais dos últimos ${diag.dias_lidos} dias (grupos ficam de fora) e as novas assim que chegam.`,
      acao: { rotulo: "Buscar conversas agora", ocupado, onClick: () => executar(() => fetchApi("/corretor/atendimentos/sincronizar", { method: "POST" })) },
    };
  }, [itens.length, erro, diag, ocupado, aviso, onIr]); // eslint-disable-line react-hooks/exhaustive-deps

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
      atendimentos={{ itens, todos, onTodos, meuId, onAbrirCliente, vazio }}
    />
  );
}
