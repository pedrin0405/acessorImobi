"use client";

import React, { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, FileText, Image as ImagemIcone, Loader2, Mic, Paperclip, Sparkles, Square, X } from "lucide-react";
import { Habilidade, sugestoes } from "./habilidades";

export const MAX_ANEXOS = 3;
export const MAX_BYTES = 4 * 1024 * 1024;
const EXTENSOES_TEXTO = [".txt", ".csv", ".md"];
const MIMES_ACEITOS = ["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain", "text/csv", "text/markdown"];

export function mimeDoArquivo(f: File): string {
  if (f.type) return f.type;
  const nome = f.name.toLowerCase();
  if (nome.endsWith(".csv")) return "text/csv";
  if (nome.endsWith(".md")) return "text/markdown";
  if (nome.endsWith(".txt")) return "text/plain";
  return "";
}

function validar(atuais: File[], novos: File[]): { aceitos: File[]; erro: string | null } {
  const aceitos: File[] = [];
  let erro: string | null = null;
  for (const f of novos) {
    const mime = mimeDoArquivo(f);
    if (!MIMES_ACEITOS.includes(mime) && !EXTENSOES_TEXTO.some((e) => f.name.toLowerCase().endsWith(e))) {
      erro = `"${f.name}" não é aceito. Use imagem, PDF, TXT ou CSV.`;
    } else if (f.size > MAX_BYTES) {
      erro = `"${f.name}" passa de ${MAX_BYTES / (1024 * 1024)} MB.`;
    } else if (atuais.length + aceitos.length >= MAX_ANEXOS) {
      erro = `Até ${MAX_ANEXOS} arquivos por mensagem.`;
    } else {
      aceitos.push(f);
    }
  }
  return { aceitos, erro };
}

const tamanho = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`);

export interface CompositorRef {
  focar: () => void;
}

interface Props {
  texto: string;
  onTexto: (t: string) => void;
  anexos: File[];
  onAnexos: (a: File[]) => void;
  onEnviar: () => void;
  /** Aguardando a resposta da IA. */
  ocupado: boolean;
  /** A resposta está sendo exibida; o botão vira "parar". */
  digitando: boolean;
  onParar: () => void;
  menuAcima?: boolean;
  autoFocus?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Reconhecimento = any;

const Compositor = forwardRef<CompositorRef, Props>(function Compositor(
  { texto, onTexto, anexos, onAnexos, onEnviar, ocupado, digitando, onParar, menuAcima = false, autoFocus = false },
  ref
) {
  const idMenu = useId();
  const area = useRef<HTMLTextAreaElement | null>(null);
  const caixa = useRef<HTMLDivElement | null>(null);
  const arquivoInput = useRef<HTMLInputElement | null>(null);
  const reconhecimento = useRef<Reconhecimento>(null);
  const baseVoz = useRef("");
  const aoTexto = useRef(onTexto);
  aoTexto.current = onTexto;

  const [menuAberto, setMenuAberto] = useState(false);
  const [menuOculto, setMenuOculto] = useState(false);
  const [indice, setIndice] = useState(0);
  const [ouvindo, setOuvindo] = useState(false);
  const [vozSuportada, setVozSuportada] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);

  useImperativeHandle(ref, () => ({ focar: () => area.current?.focus() }));

  const comBarra = /^\/[^\s]*$/.test(texto);
  const menuVisivel = (menuAberto || comBarra) && !menuOculto;
  const itens = sugestoes(comBarra ? texto.slice(1) : "");
  const navegaveis = itens.filter((h) => !h.emBreve);
  const ativo = navegaveis[Math.min(indice, Math.max(navegaveis.length - 1, 0))];
  const pode = (texto.trim().length > 0 || anexos.length > 0) && !ocupado && !digitando;

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    setVozSuportada(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    if (autoFocus) area.current?.focus();
    return () => reconhecimento.current?.abort?.();
  }, [autoFocus]);

  // A caixa cresce com o texto, até ~8 linhas.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [texto]);

  useEffect(() => setIndice(0), [texto, menuAberto]);

  useEffect(() => {
    if (!menuVisivel) return;
    document.getElementById(`${idMenu}-op-${ativo?.id}`)?.scrollIntoView({ block: "nearest" });
  }, [indice, menuVisivel, idMenu, ativo?.id]);

  useEffect(() => {
    if (!menuAberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setMenuAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [menuAberto]);

  const escolher = useCallback(
    (h: Habilidade) => {
      if (h.emBreve) return;
      onTexto(h.prompt);
      setMenuAberto(false);
      setMenuOculto(false);
      requestAnimationFrame(() => {
        const el = area.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(h.prompt.length, h.prompt.length);
      });
    },
    [onTexto]
  );

  const adicionar = (novos: File[]) => {
    if (!novos.length) return;
    const { aceitos, erro } = validar(anexos, novos);
    setAviso(erro);
    if (aceitos.length) onAnexos([...anexos, ...aceitos]);
  };

  const aoTeclar = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuVisivel) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = navegaveis.length || 1;
        setIndice((i) => (e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n));
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && ativo) {
        e.preventDefault();
        escolher(ativo);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuAberto(false);
        setMenuOculto(true);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (pode) onEnviar();
    }
  };

  const alternarVoz = () => {
    if (ouvindo) {
      reconhecimento.current?.stop();
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const Classe = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Classe) return;
    const rec: Reconhecimento = new Classe();
    rec.lang = "pt-BR";
    rec.interimResults = true;
    rec.continuous = true;
    baseVoz.current = texto && !texto.endsWith(" ") ? `${texto} ` : texto;
    rec.onresult = (e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => {
      let final = "";
      let parcial = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else parcial += r[0].transcript;
      }
      aoTexto.current((baseVoz.current + final + parcial).trimStart());
    };
    rec.onerror = (e: { error?: string }) => {
      setOuvindo(false);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setAviso("Permita o uso do microfone no navegador para ditar.");
      else if (e.error !== "no-speech" && e.error !== "aborted") setAviso("Não consegui ouvir agora. Tente de novo.");
    };
    rec.onend = () => setOuvindo(false);
    reconhecimento.current = rec;
    setAviso(null);
    try {
      rec.start();
      setOuvindo(true);
    } catch {
      setOuvindo(false);
    }
  };

  const botao = "w-9 h-9 rounded-full flex items-center justify-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

  return (
    <div ref={caixa} className="relative">
      <div
        onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => { e.preventDefault(); setArrastando(false); adicionar(Array.from(e.dataTransfer.files)); }}
        className="relative rounded-3xl border transition-[border-color,box-shadow] duration-200 focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_13%,transparent)]"
        style={{ background: "var(--card)", borderColor: arrastando ? "var(--accent)" : "var(--line-2)" }}
      >
        {anexos.length > 0 && (
          <ul className="flex flex-wrap gap-2 px-4 pt-4" aria-label="Arquivos anexados">
            {anexos.map((f, i) => (
              <li key={`${f.name}-${i}`} className="assist-pop flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-xl text-xs max-w-[15rem]" style={{ background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--text-2)" }}>
                {mimeDoArquivo(f).startsWith("image/") ? <ImagemIcone className="w-3.5 h-3.5 shrink-0" aria-hidden /> : <FileText className="w-3.5 h-3.5 shrink-0" aria-hidden />}
                <span className="truncate">{f.name}</span>
                <span className="shrink-0" style={{ color: "var(--text-4)" }}>{tamanho(f.size)}</span>
                <button type="button" aria-label={`Remover ${f.name}`} onClick={() => onAnexos(anexos.filter((_, j) => j !== i))} className="shrink-0 p-1 rounded-full hover:bg-[var(--hover-solid)]">
                  <X className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <textarea
          ref={area}
          value={texto}
          rows={2}
          onChange={(e) => { onTexto(e.target.value); setMenuOculto(false); }}
          onKeyDown={aoTeclar}
          onPaste={(e) => {
            const arquivos = Array.from(e.clipboardData.files);
            if (arquivos.length) { e.preventDefault(); adicionar(arquivos); }
          }}
          placeholder="Pergunte ao Acessor, peça imóveis (“3 opções na Orla”) ou um book em PDF. Digite / para ver o que ele faz"
          aria-label="Pergunte ao Acessor"
          role="combobox"
          aria-expanded={menuVisivel}
          aria-controls={idMenu}
          aria-autocomplete="list"
          aria-activedescendant={menuVisivel && ativo ? `${idMenu}-op-${ativo.id}` : undefined}
          className="block w-full resize-none px-5 pt-5 pb-2 text-base leading-relaxed outline-none placeholder:text-[var(--text-4)]"
          // O tema pinta todo textarea com --input; aqui o fundo é o da própria caixa.
          style={{ color: "var(--text)", backgroundColor: "transparent", border: 0 }}
        />

        <div className="flex items-center justify-between px-3 pb-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { setMenuOculto(false); setMenuAberto((v) => !v); area.current?.focus(); }}
              aria-label="Ver o que o Acessor faz"
              aria-pressed={menuAberto}
              className={`${botao} hover:bg-[var(--hover-solid)]`}
              style={{ color: menuAberto ? "var(--accent)" : "var(--text-3)" }}
            >
              <Sparkles className="w-[18px] h-[18px]" />
            </button>
            <button
              type="button"
              onClick={() => arquivoInput.current?.click()}
              disabled={anexos.length >= MAX_ANEXOS}
              aria-label="Anexar arquivo"
              className={`${botao} hover:bg-[var(--hover-solid)] disabled:opacity-40`}
              style={{ color: "var(--text-3)" }}
            >
              <Paperclip className="w-[18px] h-[18px]" />
            </button>
            <input
              ref={arquivoInput}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,application/pdf,.txt,.csv,.md,text/plain,text/csv"
              className="hidden"
              onChange={(e) => { adicionar(Array.from(e.target.files || [])); e.target.value = ""; }}
            />
          </div>

          <div className="flex items-center gap-1.5">
            {vozSuportada && (
              <button
                type="button"
                onClick={alternarVoz}
                aria-label={ouvindo ? "Parar de ditar" : "Ditar por voz"}
                aria-pressed={ouvindo}
                className={`${botao} ${ouvindo ? "assist-ring" : "hover:bg-[var(--hover-solid)]"}`}
                style={ouvindo ? { background: "color-mix(in srgb, var(--danger) 18%, transparent)", color: "var(--danger)" } : { color: "var(--text-3)" }}
              >
                <Mic className="w-[18px] h-[18px]" />
              </button>
            )}
            {digitando ? (
              <button type="button" onClick={onParar} aria-label="Parar resposta" className={botao} style={{ background: "var(--chip)", color: "var(--chip-text)" }}>
                <Square className="w-3.5 h-3.5" fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => pode && onEnviar()}
                disabled={!pode}
                aria-label={ocupado ? "Aguardando resposta" : "Enviar"}
                className={`${botao} disabled:cursor-not-allowed`}
                style={pode || ocupado ? { background: "var(--chip)", color: "var(--chip-text)" } : { background: "var(--card-2)", color: "var(--text-4)" }}
              >
                {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-[18px] h-[18px]" />}
              </button>
            )}
          </div>
        </div>

        {arrastando && (
          <div className="assist-fade absolute inset-0 rounded-3xl flex items-center justify-center text-sm font-medium pointer-events-none" style={{ background: "color-mix(in srgb, var(--accent) 12%, var(--card))", color: "var(--accent-text)" }}>
            Solte para anexar
          </div>
        )}
      </div>

      {/* brilho sob a caixa */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-px flex justify-center">
        <div className="h-px w-3/5 assist-glow" style={{ background: "linear-gradient(90deg, transparent, var(--accent), transparent)" }} />
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-12 -bottom-4 h-8 rounded-full blur-2xl opacity-30" style={{ background: "var(--accent)" }} />

      {aviso && (
        <p role="status" className="assist-fade mt-3 px-2 text-xs" style={{ color: "var(--warn)" }}>{aviso}</p>
      )}

      {menuVisivel && (
        <div
          id={idMenu}
          role="listbox"
          aria-label="O que o Acessor faz"
          className={`assist-pop absolute inset-x-0 z-30 max-h-[22rem] overflow-y-auto rounded-2xl p-2 shadow-2xl ${menuAcima ? "bottom-full mb-3" : "top-full mt-3"}`}
          style={{ background: "var(--card)", border: "1px solid var(--line-2)" }}
        >
          {itens.length === 0 && <p className="px-3 py-4 text-sm" style={{ color: "var(--text-3)" }}>Nenhuma habilidade com esse nome.</p>}
          {itens.map((h, i) => {
            const novoGrupo = i === 0 || itens[i - 1].grupo !== h.grupo;
            const Icone = h.icone;
            const marcado = ativo?.id === h.id;
            return (
              <React.Fragment key={h.id}>
                {novoGrupo && (
                  <p className="px-3 pt-3 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-4)" }}>{h.grupo}</p>
                )}
                <button
                  id={`${idMenu}-op-${h.id}`}
                  type="button"
                  role="option"
                  aria-selected={marcado}
                  aria-disabled={h.emBreve}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => escolher(h)}
                  onMouseEnter={() => { const n = navegaveis.findIndex((x) => x.id === h.id); if (n >= 0) setIndice(n); }}
                  className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${h.emBreve ? "opacity-50 cursor-not-allowed" : ""}`}
                  style={{ background: marcado ? "var(--hover-solid)" : "transparent" }}
                >
                  <Icone className="w-[18px] h-[18px] mt-0.5 shrink-0" style={{ color: "var(--text-3)" }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--text)" }}>
                      {h.titulo}
                      {h.selo && (
                        <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide" style={h.emBreve ? { background: "var(--card-2)", color: "var(--text-4)" } : { background: "var(--accent-soft)", color: "var(--accent-text)" }}>
                          {h.selo}
                        </span>
                      )}
                    </span>
                    <span className="block text-xs mt-0.5" style={{ color: "var(--text-4)" }}>{h.descricao}</span>
                  </span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default Compositor;
