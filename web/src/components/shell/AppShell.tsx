"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { LogOut, Menu, Moon, PanelLeft, Search, Sun } from "lucide-react";
import LogoAcessor from "@/components/shell/LogoAcessor";
import LogoAcessorHorizontal from "@/components/shell/LogoAcessorHorizontal";

export interface NavItem {
  id: string;
  rotulo: string;
  icone: React.ComponentType<{ className?: string }>;
  contador?: number;
}

export interface NavGrupo {
  titulo?: string;
  itens: NavItem[];
}

interface Props {
  marca: string;
  subtitulo: string;
  grupos: NavGrupo[];
  rodape?: NavItem[];
  ativo: string;
  onSelecionar: (id: string) => void;
  usuario: { nome: string; papel: string };
  onSair: () => void;
  /** Telas de trabalho (ex.: Conversas) usam toda a área, sem a moldura de leitura. */
  larguraTotal?: boolean;
  children: React.ReactNode;
}

const lerPreferencia = (chave: string, padrao: string) => {
  try {
    return localStorage.getItem(chave) ?? padrao;
  } catch {
    return padrao;
  }
};

const gravarPreferencia = (chave: string, valor: string) => {
  try {
    localStorage.setItem(chave, valor);
  } catch {
    /* armazenamento indisponível: preferência só vale nesta visita */
  }
};

export default function AppShell({ marca, subtitulo, grupos, rodape = [], ativo, onSelecionar, usuario, onSair, larguraTotal = false, children }: Props) {
  const [tema, setTema] = useState<"escuro" | "claro">("escuro");
  const [recolhido, setRecolhido] = useState(false);
  const [gaveta, setGaveta] = useState(false);
  const [busca, setBusca] = useState("");
  const [buscaAberta, setBuscaAberta] = useState(false);
  const buscaRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTema(lerPreferencia("acessor_tema", "escuro") === "claro" ? "claro" : "escuro");
    setRecolhido(lerPreferencia("acessor_menu", "aberto") === "recolhido");
  }, []);

  // ⌘K / Ctrl+K abre a busca de páginas.
  useEffect(() => {
    const atalho = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        buscaRef.current?.focus();
        setBuscaAberta(true);
      }
      if (e.key === "Escape") setBuscaAberta(false);
    };
    window.addEventListener("keydown", atalho);
    return () => window.removeEventListener("keydown", atalho);
  }, []);

  const todos = useMemo(() => [...grupos.flatMap((g) => g.itens), ...rodape], [grupos, rodape]);
  const resultados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return termo ? todos.filter((i) => i.rotulo.toLowerCase().includes(termo)) : todos;
  }, [busca, todos]);

  const ir = (id: string) => {
    onSelecionar(id);
    setGaveta(false);
    setBuscaAberta(false);
    setBusca("");
  };

  const trocarTema = () => {
    const novo = tema === "escuro" ? "claro" : "escuro";
    setTema(novo);
    gravarPreferencia("acessor_tema", novo);
  };

  const alternarMenu = () => {
    const novo = !recolhido;
    setRecolhido(novo);
    gravarPreferencia("acessor_menu", novo ? "recolhido" : "aberto");
  };

  const Item = ({ item, compacto }: { item: NavItem; compacto: boolean }) => {
    const Icone = item.icone;
    const selecionado = item.id === ativo;
    return (
      <button
        onClick={() => ir(item.id)}
        title={compacto ? item.rotulo : undefined}
        aria-current={selecionado ? "page" : undefined}
        className={`relative w-full flex items-center gap-3 rounded-xl text-[13.5px] transition-colors ${
          compacto ? "justify-center h-10" : "px-3 h-10"
        } ${selecionado ? "font-medium" : ""}`}
        style={{
          background: selecionado ? "var(--card-2)" : undefined,
          color: selecionado ? "var(--text)" : "var(--text-3)",
        }}
        onMouseEnter={(e) => !selecionado && (e.currentTarget.style.color = "var(--text)")}
        onMouseLeave={(e) => !selecionado && (e.currentTarget.style.color = "var(--text-3)")}
      >
        {selecionado && <span className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-full" style={{ background: "var(--accent)" }} />}
        <Icone className="w-[18px] h-[18px] shrink-0" />
        {!compacto && <span className="flex-1 text-left truncate">{item.rotulo}</span>}
        {!!item.contador && (
          <span
            className={`text-[11px] font-semibold rounded-full ${compacto ? "absolute top-0.5 right-1.5 min-w-[16px] h-4 px-1" : "min-w-[20px] h-5 px-1.5"} flex items-center justify-center`}
            style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}
          >
            {item.contador}
          </span>
        )}
      </button>
    );
  };

  const Lateral = ({ compacto }: { compacto: boolean }) => (
    <div className="flex flex-col h-full">
      <div className={`flex flex-col justify-center ${compacto ? "items-center h-16" : "h-20 px-4"}`}>
        {compacto ? (
          <LogoAcessor className="w-9 h-9" alt={marca} />
        ) : (
          <>
            <LogoAcessorHorizontal tema={tema} alt={`${marca} Imobi`} className="w-36 h-auto" />
            <p className="mt-0.5 text-[11px] truncate" style={{ color: "var(--text-4)" }}>{subtitulo}</p>
          </>
        )}
      </div>
      <nav className={`flex-1 overflow-y-auto py-2 space-y-5 ${compacto ? "px-2" : "px-3"}`} aria-label="Menu principal">
        {grupos.map((g, i) => (
          <div key={i} className="space-y-0.5">
            {g.titulo &&
              (compacto ? (
                <div className="mx-2 my-2 h-px" style={{ background: "var(--line)" }} />
              ) : (
                <p className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-4)" }}>
                  {g.titulo}
                </p>
              ))}
            {g.itens.map((it) => <Item key={it.id} item={it} compacto={compacto} />)}
          </div>
        ))}
      </nav>
      <div className={`py-3 space-y-1 ${compacto ? "px-2" : "px-3"}`} style={{ borderTop: "1px solid var(--line)" }}>
        {rodape.map((it) => <Item key={it.id} item={it} compacto={compacto} />)}
        <div className={`flex items-center gap-3 pt-2 ${compacto ? "justify-center" : "px-1"}`}>
          <span className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0" style={{ background: "var(--card-2)", color: "var(--text-2)" }}>
            {(usuario.nome.match(/[A-Za-zÀ-ÿ]+/g) ?? [usuario.papel]).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
          </span>
          {!compacto && (
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium truncate" style={{ color: "var(--text)" }}>{usuario.nome}</p>
              <p className="text-[11px] truncate" style={{ color: "var(--text-4)" }}>{usuario.papel}</p>
            </div>
          )}
          {!compacto && (
            <button onClick={onSair} title="Sair" aria-label="Sair" className="p-1.5 rounded-lg" style={{ color: "var(--text-4)" }}>
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className={`app-tema ${tema === "claro" ? "app-claro" : ""} min-h-screen flex`}>
      {/* Menu lateral (desktop) */}
      <aside
        className={`hidden lg:block sticky top-0 h-screen shrink-0 transition-[width] duration-200 ${recolhido ? "w-[68px]" : "w-[236px]"}`}
        style={{ background: "var(--sidebar)", borderRight: "1px solid var(--line)" }}
      >
        <Lateral compacto={recolhido} />
      </aside>

      {/* Gaveta (celular) */}
      {gaveta && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="w-[260px] h-full" style={{ background: "var(--sidebar)" }}>
            <Lateral compacto={false} />
          </div>
          <button className="flex-1 bg-black/60" aria-label="Fechar menu" onClick={() => setGaveta(false)} />
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Barra superior */}
        <header className="sticky top-0 z-30 h-16 flex items-center gap-3 px-4 lg:px-6" style={{ background: "var(--bg)", borderBottom: "1px solid var(--line)" }}>
          <button onClick={() => setGaveta(true)} className="lg:hidden p-2 rounded-xl" style={{ color: "var(--text-3)" }} aria-label="Abrir menu">
            <Menu className="w-5 h-5" />
          </button>
          <button onClick={alternarMenu} className="hidden lg:flex p-2 rounded-xl" style={{ color: "var(--text-3)", border: "1px solid var(--line)" }} aria-label="Recolher menu" title="Recolher menu">
            <PanelLeft className="w-4 h-4" />
          </button>

          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--accent)" }} />
            <input
              ref={buscaRef}
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setBuscaAberta(true);
              }}
              onFocus={() => setBuscaAberta(true)}
              onBlur={() => setTimeout(() => setBuscaAberta(false), 150)}
              onKeyDown={(e) => e.key === "Enter" && resultados[0] && ir(resultados[0].id)}
              placeholder="Ir para..."
              aria-label="Buscar página"
              className="w-full h-10 pl-9 pr-14 rounded-full text-sm"
              style={{ border: "1px solid var(--line)" }}
            />
            <kbd className="hidden sm:block absolute right-3 top-1/2 -translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: "var(--card-2)", color: "var(--text-4)" }}>
              ⌘K
            </kbd>
            {buscaAberta && resultados.length > 0 && (
              <ul className="absolute left-0 right-0 mt-2 p-1.5 rounded-2xl z-40" style={{ background: "var(--card)", border: "1px solid var(--line-2)" }}>
                {resultados.map((r) => {
                  const Icone = r.icone;
                  return (
                    <li key={r.id}>
                      <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => ir(r.id)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm hover:bg-slate-100"
                        style={{ color: "var(--text-2)" }}
                      >
                        <Icone className="w-4 h-4" /> {r.rotulo}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={trocarTema}
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ border: "1px solid var(--line)", color: "var(--text-3)" }}
              aria-label={tema === "escuro" ? "Usar tema claro" : "Usar tema escuro"}
              title={tema === "escuro" ? "Tema claro" : "Tema escuro"}
            >
              {tema === "escuro" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {larguraTotal ? (
          <main className="flex-1 min-h-0 flex flex-col">{children}</main>
        ) : (
          <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
            <div className="max-w-6xl mx-auto space-y-6">{children}</div>
          </main>
        )}
      </div>
    </div>
  );
}
