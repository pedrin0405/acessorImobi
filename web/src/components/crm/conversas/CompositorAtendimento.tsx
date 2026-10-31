"use client";

import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Lightbulb, Loader2, RefreshCw, Settings2 } from "lucide-react";
import CompositorConversa, { type AcaoRapidaCompositor } from "./CompositorConversa";

export const ID_CAMPO_ATENDIMENTO = "campo-mensagem-atendimento";
const VARIACOES = ["Mais curta", "Mais formal", "Mais amigável", "Fazer follow-up"];

/**
 * Campo de mensagem dos atendimentos: o corretor escreve ao cliente e o Acessor envia pelo WhatsApp pessoal dele
 * (só quando ele manda, nunca sozinho). "Sugerir resposta" gera o texto na hora a partir da conversa e o coloca no
 * campo, editável; trechos [entre colchetes] são o que só o corretor sabe e precisam ser completados antes de enviar.
 */
export default function CompositorAtendimento({
  texto, onTexto, onEnviar, enviando, semWhatsapp, onConectar, onAcao, erro, nomeCliente,
  onSugerir, gerando, temMensagens, jaSugeriu,
}: {
  texto: string;
  onTexto: (t: string) => void;
  onEnviar: () => void;
  enviando: boolean;
  semWhatsapp: boolean;
  onConectar: () => void;
  onAcao: (a: AcaoRapidaCompositor) => void;
  erro: string | null;
  nomeCliente: string;
  /** Gera uma sugestão (com `instrucao` opcional, ex.: "Mais curta") e preenche o campo. */
  onSugerir: (instrucao?: string) => void;
  gerando: boolean;
  temMensagens: boolean;
  /** Já houve uma sugestão: aparecem "Gerar outra" e as variações. */
  jaSugeriu: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const caixa = useRef<HTMLDivElement | null>(null);
  const pendentes = Array.from(new Set(texto.match(/\[[^\]\n]{1,80}\]/g) ?? []));

  useEffect(() => {
    if (!menu) return;
    const fora = (e: MouseEvent) => !caixa.current?.contains(e.target as Node) && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [menu]);

  if (semWhatsapp) {
    return (
      <div className="px-4 pb-4 pt-3 flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm" style={{ color: "var(--warn)" }}>Seu WhatsApp não está conectado: conecte para enviar mensagens e materiais aos clientes por aqui.</p>
        <button type="button" onClick={onConectar} className="inline-flex items-center gap-2 h-10 px-4 rounded-full text-sm font-medium" style={{ background: "var(--chip)", color: "var(--chip-text)" }}>
          <Settings2 className="w-4 h-4" aria-hidden /> Conectar WhatsApp
        </button>
      </div>
    );
  }

  const botao = "inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] hover:bg-[var(--hover-solid)] disabled:opacity-50 disabled:cursor-not-allowed";
  const borda = { border: "1px solid var(--line-2)", color: "var(--text-2)" } as const;
  const topo = (
    <>
      <div ref={caixa} className="relative mb-2 flex flex-wrap items-center gap-2 px-1">
        <button type="button" onClick={() => onSugerir()} disabled={!temMensagens || gerando} className={botao} style={borda}>
          {gerando ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Lightbulb className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} aria-hidden />}
          {gerando ? "Gerando…" : "Sugerir resposta"}
        </button>
        {jaSugeriu && (
          <>
            <button type="button" onClick={() => onSugerir()} disabled={gerando} className={botao} style={borda}><RefreshCw className="w-3.5 h-3.5" aria-hidden /> Gerar outra</button>
            <button type="button" onClick={() => setMenu((v) => !v)} disabled={gerando} aria-haspopup="menu" aria-expanded={menu} className={botao} style={borda}>
              Variações <ChevronDown className="w-3.5 h-3.5" aria-hidden />
            </button>
            {menu && (
              <div role="menu" aria-label="Variações da sugestão" className="assist-pop absolute left-0 bottom-full mb-1 z-20 w-48 p-1.5 rounded-xl shadow-2xl" style={{ background: "var(--card)", border: "1px solid var(--line-2)" }}>
                {VARIACOES.map((v) => (
                  <button key={v} type="button" role="menuitem" onClick={() => { setMenu(false); onSugerir(v); }} className="w-full px-3 py-2 rounded-lg text-sm text-left hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-2)" }}>{v}</button>
                ))}
              </div>
            )}
          </>
        )}
        {!temMensagens && <span className="text-xs" style={{ color: "var(--text-4)" }}>Sem mensagens ainda para o Acessor se basear.</span>}
      </div>
      {pendentes.length > 0 && (
        <p role="status" className="assist-fade mb-2 px-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: "var(--warn)" }}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden /> Complete os trechos entre colchetes antes de enviar:
          {pendentes.map((p) => <mark key={p} className="px-1.5 py-0.5 rounded-md" style={{ background: "color-mix(in srgb, var(--warn) 18%, transparent)", color: "var(--text)" }}>{p}</mark>)}
        </p>
      )}
    </>
  );

  return (
    <CompositorConversa
      modo="mensagem" onModo={() => undefined} texto={texto} onTexto={onTexto} onEnviar={onEnviar} enviando={enviando}
      semWhatsapp={false} erro={erro} onAcao={onAcao} semNota acoes={["imoveis", "book"]} topo={topo} idCampo={ID_CAMPO_ATENDIMENTO}
      textos={{
        placeholder: `Escreva para ${nomeCliente}…`, rotulo: "Mensagem ao cliente", bloqueado: "",
        dica: "Enter envia pelo seu WhatsApp",
      }}
    />
  );
}
