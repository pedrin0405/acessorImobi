"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Loader2, RefreshCw } from "lucide-react";
import { AuthError } from "@/lib/api";
import { buscarPdf } from "@/lib/books";

/**
 * Pré-visualização de um PDF gerado pela API. `gerar` devolve o caminho e o corpo da chamada; a prévia só
 * é refeita no botão "Atualizar" ou quando `chave` muda (com debounce), nunca a cada tecla.
 */
export default function PreviaPdf({
  caminho, corpo, chave, nomeArquivo = "book.pdf", altura = "70vh", onAuthError, automatica = true,
}: {
  caminho: string;
  corpo: unknown;
  /** Muda quando o conteúdo da prévia mudou; dispara nova geração depois do debounce. */
  chave: string;
  nomeArquivo?: string;
  altura?: string;
  onAuthError?: (e: unknown) => boolean;
  automatica?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [defasada, setDefasada] = useState(false);
  const corpoRef = useRef(corpo);
  corpoRef.current = corpo;
  const contagem = useRef(0);
  const primeira = useRef(true);

  const gerar = useCallback(async () => {
    const minha = ++contagem.current;
    setGerando(true); setErro(null);
    try {
      const blob = await buscarPdf(caminho, corpoRef.current);
      if (minha !== contagem.current) return;
      setUrl((antigo) => { if (antigo) URL.revokeObjectURL(antigo); return URL.createObjectURL(blob); });
      setDefasada(false);
    } catch (e) {
      if (minha !== contagem.current) return;
      if (e instanceof AuthError && onAuthError?.(e)) return;
      setErro(e instanceof Error ? e.message : "Não consegui gerar o PDF agora.");
    } finally {
      if (minha === contagem.current) setGerando(false);
    }
  }, [caminho, onAuthError]);

  useEffect(() => () => { setUrl((u) => { if (u) URL.revokeObjectURL(u); return null; }); }, []);

  useEffect(() => {
    if (primeira.current) { primeira.current = false; gerar(); return; }
    setDefasada(true);
    if (!automatica) return;
    const t = setTimeout(gerar, 1000);
    return () => clearTimeout(t);
  }, [chave, automatica, gerar]);

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs flex items-center gap-1.5" style={{ color: defasada && !gerando ? "var(--warn)" : "var(--text-3)" }}>
          {gerando ? <><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Gerando a prévia…</> : defasada ? "Há alterações ainda fora da prévia." : "Prévia com imóveis da sua carteira."}
        </p>
        <span className="flex items-center gap-1">
          <button type="button" onClick={gerar} disabled={gerando} className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium hover:bg-[var(--hover-solid)] disabled:opacity-50" style={{ border: "1px solid var(--line-2)", color: "var(--text-2)" }}>
            <RefreshCw className={`w-3.5 h-3.5 ${gerando ? "animate-spin" : ""}`} aria-hidden /> Atualizar prévia
          </button>
          {url && (
            <a href={url} download={nomeArquivo} className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium hover:bg-[var(--hover-solid)]" style={{ border: "1px solid var(--line-2)", color: "var(--text-2)" }}>
              <Download className="w-3.5 h-3.5" aria-hidden /> Baixar
            </a>
          )}
        </span>
      </div>
      <div className="relative rounded-xl overflow-hidden" style={{ height: altura, minHeight: "22rem", background: "var(--card-2)", border: "1px solid var(--line)" }}>
        {url ? (
          <iframe title="Prévia do book em PDF" src={url} className="w-full h-full border-0" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm" style={{ color: "var(--text-3)" }}>
            {gerando ? <Loader2 className="w-6 h-6 animate-spin" aria-hidden /> : <FileText className="w-6 h-6" aria-hidden />}
            {erro ? <p role="alert" className="px-6 text-center" style={{ color: "var(--danger)" }}>{erro}</p> : <p>{gerando ? "Montando o PDF…" : "A prévia aparece aqui."}</p>}
          </div>
        )}
        {url && erro && <p role="alert" className="absolute bottom-0 inset-x-0 px-3 py-2 text-xs" style={{ background: "var(--card)", color: "var(--danger)" }}>{erro}</p>}
      </div>
    </div>
  );
}
