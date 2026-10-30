"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, Lock, Smile } from "lucide-react";

const EMOJIS = ["😀", "😊", "😉", "😍", "🙂", "😅", "😂", "🤝", "👍", "👏", "🙏", "💪", "🎉", "✅", "⚠️", "❗", "📍", "🏠", "🏢", "🔑", "📅", "⏰", "📞", "💬", "📎", "💰", "📄", "👋", "🤔", "😬", "🙌", "✨"];

export type ModoCompositor = "mensagem" | "nota";

export default function CompositorConversa({
  modo,
  onModo,
  texto,
  onTexto,
  onEnviar,
  enviando,
  semWhatsapp,
  erro,
}: {
  modo: ModoCompositor;
  onModo: (m: ModoCompositor) => void;
  texto: string;
  onTexto: (t: string) => void;
  onEnviar: () => void;
  enviando: boolean;
  /** WhatsApp do agente desconectado: mensagem não pode ser entregue (nota continua valendo). */
  semWhatsapp: boolean;
  erro: string | null;
}) {
  const area = useRef<HTMLTextAreaElement | null>(null);
  const caixa = useRef<HTMLDivElement | null>(null);
  const [emojis, setEmojis] = useState(false);
  const nota = modo === "nota";
  const bloqueado = !nota && semWhatsapp;
  const pode = texto.trim().length > 0 && !enviando && !bloqueado;

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [texto]);

  useEffect(() => {
    if (!emojis) return;
    const fora = (e: MouseEvent) => !caixa.current?.contains(e.target as Node) && setEmojis(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setEmojis(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [emojis]);

  const inserir = (emoji: string) => {
    const el = area.current;
    const ini = el?.selectionStart ?? texto.length;
    const fim = el?.selectionEnd ?? texto.length;
    onTexto(texto.slice(0, ini) + emoji + texto.slice(fim));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(ini + emoji.length, ini + emoji.length);
    });
  };

  const segmento = (ativo: boolean) => ({
    background: ativo ? "var(--hover-solid)" : "transparent",
    color: ativo ? "var(--text)" : "var(--text-3)",
  });

  return (
    <div ref={caixa} className="relative px-4 pb-4 pt-2">
      {erro && <p role="alert" className="assist-fade mb-2 px-2 text-xs" style={{ color: "var(--danger)" }}>{erro}</p>}
      {bloqueado && (
        <p role="status" className="mb-2 px-2 text-xs" style={{ color: "var(--warn)" }}>
          O WhatsApp do agente está desconectado, então a mensagem não seria entregue. Você ainda pode salvar uma nota interna.
        </p>
      )}

      <div
        className="flex items-end gap-1 rounded-3xl border pl-4 pr-2 py-1.5 transition-colors focus-within:border-[var(--accent)]"
        style={{
          background: nota ? "color-mix(in srgb, var(--warn) 7%, var(--card))" : "var(--card)",
          borderColor: nota ? "color-mix(in srgb, var(--warn) 40%, transparent)" : "var(--line-2)",
        }}
      >
        <textarea
          ref={area}
          rows={1}
          value={texto}
          onChange={(e) => onTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (pode) onEnviar();
            }
          }}
          placeholder={nota ? "Anotação visível só para a equipe…" : "Escreva uma mensagem ao corretor…"}
          aria-label={nota ? "Nota interna" : "Mensagem ao corretor"}
          className="flex-1 resize-none py-2.5 text-[15px] leading-snug outline-none"
          // O tema pinta todo textarea com --input; aqui vale o fundo da própria pílula.
          style={{ background: "transparent", border: 0, color: "var(--text)" }}
        />
        <button
          type="button"
          onClick={() => setEmojis((v) => !v)}
          aria-label="Inserir emoji"
          aria-expanded={emojis}
          className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center hover:bg-[var(--hover-solid)]"
          style={{ color: emojis ? "var(--accent)" : "var(--text-3)" }}
        >
          <Smile className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => pode && onEnviar()}
          disabled={!pode}
          aria-label={nota ? "Salvar nota" : "Enviar mensagem"}
          className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center transition-colors disabled:cursor-not-allowed"
          style={pode ? { background: "var(--chip)", color: "var(--chip-text)" } : { background: "var(--card-2)", color: "var(--text-4)" }}
        >
          {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : nota ? <Lock className="w-4 h-4" /> : <ArrowUp className="w-[18px] h-[18px]" />}
        </button>
      </div>

      {emojis && (
        <div role="dialog" aria-label="Emojis" className="assist-pop absolute right-6 bottom-full mb-1 z-20 grid grid-cols-8 gap-0.5 p-2 rounded-2xl shadow-2xl" style={{ background: "var(--card)", border: "1px solid var(--line-2)" }}>
          {EMOJIS.map((e) => (
            <button key={e} type="button" onClick={() => inserir(e)} className="w-8 h-8 rounded-lg text-lg hover:bg-[var(--hover-solid)]" aria-label={`Inserir ${e}`}>
              {e}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div role="radiogroup" aria-label="Tipo de envio" className="inline-flex p-0.5 rounded-full" style={{ background: "var(--card-2)", border: "1px solid var(--line)" }}>
          <button type="button" role="radio" aria-checked={!nota} onClick={() => onModo("mensagem")} className="px-3.5 py-1 rounded-full text-[13px] font-medium transition-colors" style={segmento(!nota)}>
            Mensagem
          </button>
          <button type="button" role="radio" aria-checked={nota} onClick={() => onModo("nota")} className="px-3.5 py-1 rounded-full text-[13px] font-medium transition-colors" style={segmento(nota)}>
            Nota interna
          </button>
        </div>
        <p className="text-[11px]" style={{ color: "var(--text-4)" }}>
          {nota ? "A nota não é enviada ao corretor" : "Enter envia pelo número do agente"} · Shift ↵ nova linha
        </p>
      </div>
    </div>
  );
}
