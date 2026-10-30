"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchApi } from "@/lib/api";
import type { StatusSync } from "./tipos";

export interface StatusIntegracao {
  configurado: boolean;
  base_url: string;
  chave_mascarada: string;
  sincronizacao: StatusSync;
}

/**
 * Estado da integração com o Imoview e da sincronização do cache. Enquanto uma
 * sincronização está na fila ou rodando, consulta o andamento a cada 2 s e avisa
 * (`onConcluida`) quando ela termina.
 */
export function useSincronizacao(onAuthError: (e: unknown) => boolean, onConcluida?: () => void) {
  const [status, setStatus] = useState<StatusIntegracao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const anterior = useRef<string | null>(null);
  const concluida = useRef(onConcluida);
  concluida.current = onConcluida;

  const aplicar = useCallback((novo: StatusIntegracao) => {
    const antes = anterior.current;
    const agora = novo.sincronizacao.estado;
    if ((antes === "na_fila" || antes === "executando") && (agora === "ok" || agora === "erro")) concluida.current?.();
    anterior.current = agora;
    setStatus(novo);
  }, []);

  const carregar = useCallback(async () => {
    try {
      const res = await fetchApi("/admin/integracoes/imoview");
      if (!res.ok) throw new Error("falha");
      aplicar(await res.json());
      setErro(null);
    } catch (e) {
      if (!onAuthError(e)) setErro("Não foi possível consultar a integração com o Imoview.");
    }
  }, [aplicar, onAuthError]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const estado = status?.sincronizacao.estado;
  useEffect(() => {
    if (estado !== "na_fila" && estado !== "executando") return;
    const id = setInterval(carregar, 2000);
    return () => clearInterval(id);
  }, [estado, carregar]);

  const sincronizar = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetchApi("/admin/integracoes/imoview/sincronizar", { method: "POST" });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) return typeof dados.detail === "string" ? dados.detail : "Não foi possível iniciar a sincronização.";
      aplicar(dados);
      return null;
    } catch (e) {
      return onAuthError(e) ? null : "Falha de conexão ao pedir a sincronização.";
    }
  }, [aplicar, onAuthError]);

  return { status, erro, carregar, aplicar, sincronizar, sincronizando: estado === "na_fila" || estado === "executando" };
}
