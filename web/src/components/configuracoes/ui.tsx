"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Check, Info, Loader2 } from "lucide-react";
import { fetchApi } from "@/lib/api";

/* ---------- chamadas à API com mensagens de erro legíveis ---------- */

export interface Resposta<T = unknown> {
  ok: boolean;
  dados: T | null;
  erro: string | null;
  status: number;
}

function mensagemDoErro(dados: { detail?: unknown } | null, padrao: string): string {
  const d = dados?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d[0]?.msg) return String(d[0].msg).replace(/^Value error, /, "");
  return padrao;
}

export function useApi(onAuthError: (e: unknown) => boolean) {
  // A função vem da página e pode mudar a cada render; guardada numa ref, o `api` fica estável e as
  // seções não recarregam (nem apagam o que a pessoa digitou) quando a página atualiza.
  const aoErroDeAuth = useRef(onAuthError);
  aoErroDeAuth.current = onAuthError;
  return useCallback(
    async <T,>(caminho: string, init: { method?: string; corpo?: unknown } = {}): Promise<Resposta<T>> => {
      try {
        const res = await fetchApi(caminho, {
          method: init.method || "GET",
          body: init.corpo !== undefined ? JSON.stringify(init.corpo) : undefined,
        });
        const dados = res.status === 204 ? null : await res.json().catch(() => null);
        if (!res.ok) return { ok: false, dados: null, erro: mensagemDoErro(dados, "Não foi possível concluir agora."), status: res.status };
        return { ok: true, dados: dados as T, erro: null, status: res.status };
      } catch (e) {
        if (aoErroDeAuth.current(e)) return { ok: false, dados: null, erro: null, status: 401 };
        return { ok: false, dados: null, erro: "Falha de conexão. Verifique a internet e tente de novo.", status: 0 };
      }
    },
    []
  );
}

/** Mensagem de confirmação que some sozinha ("Salvo"). */
export function useRecado(ms = 2600): [string | null, (texto: string) => void] {
  const [texto, setTexto] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const mostrar = useCallback((t: string) => {
    setTexto(t);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTexto(null), ms);
  }, [ms]);
  return [texto, mostrar];
}

/* ---------- estrutura ---------- */

export function Titulo({ titulo, descricao, acao }: { titulo: string; descricao?: string; acao?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div className="min-w-0 flex-1 basis-[20rem]">
        <h2 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--text)" }}>{titulo}</h2>
        {descricao && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed" style={{ color: "var(--text-3)" }}>{descricao}</p>}
      </div>
      {acao}
    </header>
  );
}

export function Bloco({ titulo, descricao, children }: { titulo?: string; descricao?: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      {titulo && <h3 className="text-[15px] font-semibold" style={{ color: "var(--text)" }}>{titulo}</h3>}
      {descricao && <p className="mt-1 mb-3 text-[13px]" style={{ color: "var(--text-3)" }}>{descricao}</p>}
      {!descricao && titulo && <div className="h-3" />}
      {children}
    </section>
  );
}

/** Cartão de formulário: as linhas ficam separadas por um fio. */
export function Cartao({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl overflow-hidden ${className}`} style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
      {React.Children.toArray(children).map((filho, i) => (
        <div key={i} style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>{filho}</div>
      ))}
    </div>
  );
}

export function Linha({ rotulo, ajuda, children, alinharTopo = false, htmlFor }: { rotulo: string; ajuda?: string; children: React.ReactNode; alinharTopo?: boolean; htmlFor?: string }) {
  return (
    <div className={`flex flex-col sm:flex-row sm:justify-between gap-2 sm:gap-6 px-5 py-3.5 ${alinharTopo ? "sm:items-start" : "sm:items-center"}`}>
      <div className="sm:w-48 shrink-0">
        <label htmlFor={htmlFor} className="text-sm" style={{ color: "var(--text)" }}>{rotulo}</label>
        {ajuda && <p className="text-[11.5px] mt-0.5" style={{ color: "var(--text-4)" }}>{ajuda}</p>}
      </div>
      <div className="flex-1 min-w-0 sm:max-w-md sm:ml-auto">{children}</div>
    </div>
  );
}

/* ---------- campos ---------- */

const campo = "w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-60";
const estiloCampo: React.CSSProperties = { background: "var(--input)", borderColor: "var(--line-2)", color: "var(--text)" };

export const Entrada = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Entrada({ className = "", style, ...p }, ref) {
  return <input ref={ref} {...p} className={`${campo} ${className}`} style={{ ...estiloCampo, ...style }} />;
});

export const Area = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Area({ className = "", style, ...p }, ref) {
  return <textarea ref={ref} {...p} className={`${campo} resize-y leading-relaxed ${className}`} style={{ ...estiloCampo, ...style }} />;
});

export function Seletor({ className = "", style, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...p} className={`${campo} ${className}`} style={{ ...estiloCampo, ...style }}>
      {children}
    </select>
  );
}

export function Interruptor({ ligado, onChange, rotulo, disabled }: { ligado: boolean; onChange: (v: boolean) => void; rotulo: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      disabled={disabled}
      onClick={() => onChange(!ligado)}
      className="relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{ background: ligado ? "var(--accent-strong)" : "var(--line-2)", outlineColor: "var(--accent)" }}
    >
      <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform" style={{ transform: ligado ? "translateX(20px)" : "none" }} />
    </button>
  );
}

type Variante = "primario" | "secundario" | "perigo" | "fantasma";

export function Botao({ variante = "secundario", carregando, className = "", children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; carregando?: boolean }) {
  const estilos: Record<Variante, React.CSSProperties> = {
    primario: { background: "var(--chip)", color: "var(--chip-text)" },
    secundario: { background: "transparent", color: "var(--text)", border: "1px solid var(--line-2)" },
    perigo: { background: "color-mix(in srgb, var(--danger) 16%, transparent)", color: "var(--danger)", border: "1px solid color-mix(in srgb, var(--danger) 40%, transparent)" },
    fantasma: { background: "transparent", color: "var(--text-3)" },
  };
  return (
    <button
      type="button"
      {...p}
      disabled={p.disabled || carregando}
      className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-[filter,background-color] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${className}`}
      style={{ ...estilos[variante], outlineColor: "var(--accent)", ...p.style }}
    >
      {carregando && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Selo({ tom = "neutro", children }: { tom?: "neutro" | "ok" | "aviso" | "perigo" | "info"; children: React.ReactNode }) {
  const cores = {
    neutro: ["var(--card-2)", "var(--text-3)"],
    ok: ["var(--accent-soft)", "var(--accent-text)"],
    aviso: ["color-mix(in srgb, var(--warn) 14%, transparent)", "var(--warn)"],
    perigo: ["color-mix(in srgb, var(--danger) 14%, transparent)", "var(--danger)"],
    info: ["color-mix(in srgb, var(--info) 14%, transparent)", "var(--info)"],
  }[tom];
  return <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium" style={{ background: cores[0], color: cores[1] }}>{children}</span>;
}

export function Aviso({ tom = "info", children }: { tom?: "info" | "erro" | "ok" | "aviso"; children: React.ReactNode }) {
  const cor = { info: "var(--info)", erro: "var(--danger)", ok: "var(--accent)", aviso: "var(--warn)" }[tom];
  const Icone = tom === "ok" ? Check : tom === "info" ? Info : AlertTriangle;
  return (
    <div role={tom === "erro" ? "alert" : "status"} className="flex items-start gap-2.5 px-4 py-3 rounded-xl text-[13px] leading-relaxed" style={{ background: `color-mix(in srgb, ${cor} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${cor} 32%, transparent)`, color: "var(--text-2)" }}>
      <Icone className="w-4 h-4 mt-0.5 shrink-0" style={{ color: cor }} aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function Carregando({ linhas = 4 }: { linhas?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: linhas }).map((_, i) => <div key={i} className="h-12 rounded-xl animate-pulse" style={{ background: "var(--card-2)" }} />)}
    </div>
  );
}

export function Vazio({ icone, titulo, texto, children }: { icone: React.ReactNode; titulo: string; texto?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-12">
      <span className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "var(--card-2)", color: "var(--text-3)" }}>{icone}</span>
      <p className="mt-3 text-sm font-medium" style={{ color: "var(--text)" }}>{titulo}</p>
      {texto && <p className="mt-1 max-w-sm text-[13px]" style={{ color: "var(--text-3)" }}>{texto}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

/** Rodapé de formulário: botão salvar + resultado. */
export function Salvar({ onSalvar, salvando, sujo = true, recado, erro, rotulo = "Salvar" }: { onSalvar: () => void; salvando: boolean; sujo?: boolean; recado?: string | null; erro?: string | null; rotulo?: string }) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
      {erro && <p role="alert" className="mr-auto text-[13px]" style={{ color: "var(--danger)" }}>{erro}</p>}
      {recado && !erro && <p role="status" className="assist-fade mr-auto inline-flex items-center gap-1.5 text-[13px]" style={{ color: "var(--accent-text)" }}><Check className="w-4 h-4" aria-hidden />{recado}</p>}
      <Botao variante="primario" onClick={onSalvar} carregando={salvando} disabled={!sujo}>{rotulo}</Botao>
    </div>
  );
}

/** Campo de senha com botão de mostrar/ocultar. */
export function EntradaSenha(p: React.InputHTMLAttributes<HTMLInputElement> & { rotuloOlho?: string }) {
  const [ver, setVer] = useState(false);
  const id = useId();
  const { rotuloOlho, ...resto } = p;
  return (
    <div className="relative">
      <Entrada id={id} {...resto} type={ver ? "text" : "password"} className="pr-11" autoComplete={p.autoComplete || "off"} />
      <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? "Ocultar senha" : rotuloOlho || "Mostrar senha"} aria-pressed={ver} className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-1 rounded-md text-xs hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}>
        {ver ? "Ocultar" : "Mostrar"}
      </button>
    </div>
  );
}

/** Reduz a imagem escolhida no navegador (logo/foto) para um data URL pequeno. */
export function reduzirImagem(arquivo: File, lado = 256): Promise<string> {
  return new Promise((ok, falhou) => {
    if (!/^image\/(png|jpeg|webp)$/.test(arquivo.type)) return falhou(new Error("Use uma imagem PNG, JPG ou WebP."));
    const leitor = new FileReader();
    leitor.onerror = () => falhou(new Error("Não consegui ler a imagem."));
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => falhou(new Error("Imagem inválida."));
      img.onload = () => {
        const escala = Math.min(1, lado / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * escala));
        c.height = Math.max(1, Math.round(img.height * escala));
        c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
        ok(c.toDataURL(arquivo.type === "image/png" ? "image/png" : "image/webp", 0.85));
      };
      img.src = String(leitor.result);
    };
    leitor.readAsDataURL(arquivo);
  });
}

export function Iniciais({ nome, imagem, tamanho = 64 }: { nome: string; imagem?: string | null; tamanho?: number }) {
  const iniciais = (nome || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
  return imagem ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imagem} alt="" className="shrink-0 rounded-2xl object-cover" style={{ width: tamanho, height: tamanho }} />
  ) : (
    <span aria-hidden className="shrink-0 rounded-2xl flex items-center justify-center font-semibold" style={{ width: tamanho, height: tamanho, fontSize: tamanho * 0.36, background: "var(--accent-soft)", color: "var(--accent-text)" }}>{iniciais}</span>
  );
}
