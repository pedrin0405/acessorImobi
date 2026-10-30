"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, BedDouble, Bath, Building2, Car, ChevronLeft, ChevronRight, Home, Loader2, RefreshCw, Ruler, Star } from "lucide-react";
import { fetchApi } from "@/lib/api";
import BarraFiltros, { ChipsAtivos } from "./Filtros";
import DetalheImovel from "./Detalhe";
import { useSincronizacao } from "./useSincronizacao";
import {
  FILTROS_VAZIOS, Filtros, ImovelResumo, ListaImoveis, Facetas, StatusSync, numero, paraParametros, precoDoImovel, relativo, rotuloFinalidade,
} from "./tipos";

const POR_PAGINA = 24;
const CHAVE_PREFERENCIAS = "acessor_imoveis_prefs";

function lerPreferencias(): { visao: "cards" | "tabela"; ordem: string } {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE_PREFERENCIAS) || "{}");
    return { visao: bruto.visao === "tabela" ? "tabela" : "cards", ordem: typeof bruto.ordem === "string" ? bruto.ordem : "recentes" };
  } catch {
    return { visao: "cards", ordem: "recentes" };
  }
}

function Foto({ url, alt, className = "" }: { url: string | null; alt: string; className?: string }) {
  const [falhou, setFalhou] = useState(false);
  if (!url || falhou) {
    return (
      <div className={`flex items-center justify-center ${className}`} style={{ background: "var(--card-2)", color: "var(--text-4)" }} aria-hidden>
        <Home className="w-7 h-7" />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFalhou(true)} className={`object-cover ${className}`} />;
}

function Indicadores({ i }: { i: ImovelResumo }) {
  const itens = [
    { icone: BedDouble, valor: i.quartos, rotulo: "quartos" },
    { icone: Bath, valor: i.banheiros, rotulo: "banheiros" },
    { icone: Car, valor: i.vagas, rotulo: "vagas" },
    { icone: Ruler, valor: i.area_m2 ? Math.round(i.area_m2) : null, rotulo: "m²", sufixo: " m²" },
  ].filter((x) => x.valor);
  return (
    <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px]" style={{ color: "var(--text-3)" }} aria-label="Características">
      {itens.map(({ icone: Icone, valor, rotulo, sufixo }) => (
        <li key={rotulo} className="inline-flex items-center gap-1.5 tabular-nums" title={`${valor} ${rotulo}`}>
          <Icone className="w-3.5 h-3.5" aria-hidden />
          <span><span className="sr-only">{rotulo}: </span>{valor}{sufixo || ""}</span>
        </li>
      ))}
    </ul>
  );
}

function CardImovel({ i, onAbrir }: { i: ImovelResumo; onAbrir: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onAbrir}
        className="group w-full h-full flex flex-col text-left rounded-2xl overflow-hidden transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-[var(--line-2)]"
        style={{ background: "var(--card)", border: "1px solid var(--line)", opacity: i.ativo ? 1 : 0.6 }}
        aria-label={`${i.tipo || "Imóvel"} em ${i.bairro || "local não informado"}, ${rotuloFinalidade(i.finalidade)}, ${precoDoImovel(i)}, código ${i.codigo}`}
      >
        <div className="relative aspect-[4/3] w-full overflow-hidden" style={{ background: "var(--card-2)" }}>
          <Foto url={i.foto_url} alt="" className="absolute inset-0 w-full h-full transition-transform duration-300 group-hover:scale-[1.03]" />
          <span className="absolute left-2.5 top-2.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-black/65 text-white backdrop-blur-sm">{rotuloFinalidade(i.finalidade)}</span>
          {i.destaque && (
            <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-black/65 text-white backdrop-blur-sm">
              <Star className="w-3 h-3" fill="currentColor" aria-hidden /> Destaque
            </span>
          )}
          {!i.ativo && <span className="absolute left-2.5 bottom-2.5 px-2 py-0.5 rounded-md text-[11px] font-semibold" style={{ background: "var(--warn)", color: "var(--bg)" }}>Fora do Imoview</span>}
        </div>
        <div className="flex flex-col gap-2 p-3.5 flex-1">
          <p className="text-lg font-semibold leading-tight tabular-nums" style={{ color: "var(--text)" }}>{precoDoImovel(i)}</p>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>{i.tipo || "Imóvel"} · {i.bairro || "Local não informado"}</p>
            <p className="truncate text-xs" style={{ color: "var(--text-3)" }}>{[i.cidade, i.estado].filter(Boolean).join("/")} · Cód. <span className="tabular-nums">{i.codigo}</span></p>
          </div>
          <Indicadores i={i} />
        </div>
      </button>
    </li>
  );
}

function Tabela({ itens, onAbrir }: { itens: ImovelResumo[]; onAbrir: (i: ImovelResumo) => void }) {
  const cab = "px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.1em]";
  return (
    <div className="overflow-x-auto rounded-2xl" style={{ border: "1px solid var(--line)", background: "var(--card)" }}>
      <table className="w-full min-w-[46rem] text-sm">
        <thead style={{ color: "var(--text-4)", borderBottom: "1px solid var(--line)" }}>
          <tr>
            <th className={cab} scope="col"><span className="sr-only">Foto</span></th>
            <th className={cab} scope="col">Imóvel</th>
            <th className={cab} scope="col">Operação</th>
            <th className={`${cab} text-right`} scope="col">Quartos</th>
            <th className={`${cab} text-right`} scope="col">Vagas</th>
            <th className={`${cab} text-right`} scope="col">Área</th>
            <th className={`${cab} text-right`} scope="col">Valor</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => (
            <tr key={i.codigo} onClick={() => onAbrir(i)} className="cursor-pointer hover:bg-[var(--hover-solid)] transition-colors" style={{ borderTop: "1px solid var(--line)", opacity: i.ativo ? 1 : 0.6 }}>
              <td className="pl-3 py-2 w-16"><Foto url={i.foto_url} alt="" className="w-14 h-10 rounded-md" /></td>
              <td className="px-3 py-2 min-w-0">
                <button type="button" onClick={(e) => { e.stopPropagation(); onAbrir(i); }} className="text-left">
                  <span className="block font-medium" style={{ color: "var(--text)" }}>{i.tipo || "Imóvel"} · {i.bairro || "—"}</span>
                  <span className="block text-xs" style={{ color: "var(--text-3)" }}>{[i.cidade, i.estado].filter(Boolean).join("/")} · Cód. <span className="tabular-nums">{i.codigo}</span></span>
                </button>
              </td>
              <td className="px-3 py-2" style={{ color: "var(--text-2)" }}>{rotuloFinalidade(i.finalidade)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--text-2)" }}>{numero(i.quartos || null)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--text-2)" }}>{numero(i.vagas || null)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--text-2)" }}>{i.area_m2 ? `${numero(Math.round(i.area_m2))} m²` : "—"}</td>
              <td className="px-3 py-2 text-right font-medium tabular-nums" style={{ color: "var(--text)" }}>{precoDoImovel(i)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Paginacao({ pagina, paginas, onPagina }: { pagina: number; paginas: number; onPagina: (p: number) => void }) {
  if (paginas <= 1) return null;
  const alvo = new Set([1, paginas, pagina - 1, pagina, pagina + 1]);
  const numeros = Array.from(alvo).filter((n) => n >= 1 && n <= paginas).sort((a, b) => a - b);
  const botao = "min-w-9 h-9 px-2 rounded-lg text-sm tabular-nums transition-colors";
  return (
    <nav className="flex items-center justify-center gap-1 pt-2" aria-label="Paginação">
      <button type="button" onClick={() => onPagina(pagina - 1)} disabled={pagina <= 1} aria-label="Página anterior" className={`${botao} inline-flex items-center justify-center disabled:opacity-40 hover:bg-[var(--hover-solid)]`} style={{ color: "var(--text-2)" }}>
        <ChevronLeft className="w-4 h-4" />
      </button>
      {numeros.map((n, idx) => (
        <React.Fragment key={n}>
          {idx > 0 && n - numeros[idx - 1] > 1 && <span aria-hidden style={{ color: "var(--text-4)" }}>…</span>}
          <button type="button" onClick={() => onPagina(n)} aria-current={n === pagina ? "page" : undefined} aria-label={`Página ${n}`} className={`${botao} ${n === pagina ? "" : "hover:bg-[var(--hover-solid)]"}`} style={n === pagina ? { background: "var(--chip)", color: "var(--chip-text)", fontWeight: 600 } : { color: "var(--text-2)" }}>
            {n}
          </button>
        </React.Fragment>
      ))}
      <button type="button" onClick={() => onPagina(pagina + 1)} disabled={pagina >= paginas} aria-label="Próxima página" className={`${botao} inline-flex items-center justify-center disabled:opacity-40 hover:bg-[var(--hover-solid)]`} style={{ color: "var(--text-2)" }}>
        <ChevronRight className="w-4 h-4" />
      </button>
    </nav>
  );
}

function Andamento({ s }: { s: StatusSync }) {
  const pct = s.total_remoto > 0 ? Math.min(100, Math.round((s.processados / s.total_remoto) * 100)) : 0;
  return (
    <div role="status" aria-live="polite" className="min-w-[12rem]">
      <p className="text-xs tabular-nums" style={{ color: "var(--text-2)" }}>
        {s.estado === "na_fila" ? "Na fila…" : `${s.etapa ? s.etapa.charAt(0).toUpperCase() + s.etapa.slice(1) : "Sincronizando"} · ${s.processados} de ${s.total_remoto || "…"}`}
      </p>
      <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: "var(--card-2)" }} aria-hidden>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${s.estado === "na_fila" ? 4 : Math.max(pct, 4)}%`, background: "var(--accent)" }} />
      </div>
    </div>
  );
}

export default function Imoveis({ onAuthError, onIr }: { onAuthError: (e: unknown) => boolean; onIr: (tab: string) => void }) {
  const [filtros, setFiltros] = useState<Filtros>({ ...FILTROS_VAZIOS });
  const [ordem, setOrdem] = useState("recentes");
  const [visao, setVisao] = useState<"cards" | "tabela">("cards");
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<ListaImoveis | null>(null);
  const [facetas, setFacetas] = useState<Facetas | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<ImovelResumo | null>(null);
  const [erroSync, setErroSync] = useState<string | null>(null);
  const [largo, setLargo] = useState(true);
  const topo = useRef<HTMLDivElement | null>(null);
  const requisicao = useRef<AbortController | null>(null);
  const primeira = useRef(true);

  // Abaixo de 640 px a tabela não cabe: a tela mostra só cards.
  useEffect(() => {
    const consulta = window.matchMedia("(min-width: 640px)");
    const atualizar = () => setLargo(consulta.matches);
    atualizar();
    consulta.addEventListener("change", atualizar);
    return () => consulta.removeEventListener("change", atualizar);
  }, []);

  useEffect(() => {
    const p = lerPreferencias();
    setVisao(p.visao);
    setOrdem(p.ordem);
  }, []);

  const guardar = (visaoNova: "cards" | "tabela", ordemNova: string) => {
    try {
      localStorage.setItem(CHAVE_PREFERENCIAS, JSON.stringify({ visao: visaoNova, ordem: ordemNova }));
    } catch {
      /* armazenamento indisponível: a preferência vale só nesta visita */
    }
  };

  const buscar = useCallback(async () => {
    requisicao.current?.abort();
    const controle = new AbortController();
    requisicao.current = controle;
    setCarregando(true);
    try {
      const res = await fetchApi(`/admin/imoveis?${paraParametros(filtros, ordem, pagina, POR_PAGINA, true)}`, { signal: controle.signal });
      if (!res.ok) throw new Error("falha");
      const lista: ListaImoveis = await res.json();
      setDados(lista);
      if (lista.facetas) setFacetas(lista.facetas);
      setErro(null);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      if (!onAuthError(e)) setErro("Não foi possível carregar os imóveis. Tente de novo em instantes.");
    } finally {
      if (requisicao.current === controle) setCarregando(false);
    }
  }, [filtros, ordem, pagina, onAuthError]);

  // Filtros e ordem esperam um instante (digitação); a paginação busca na hora.
  useEffect(() => {
    const espera = primeira.current ? 0 : 280;
    primeira.current = false;
    const id = setTimeout(buscar, espera);
    return () => clearTimeout(id);
  }, [buscar]);

  const { status, sincronizar, sincronizando } = useSincronizacao(onAuthError, buscar);

  const mudarFiltros = (f: Filtros) => {
    setFiltros(f);
    setPagina(1);
  };

  const irParaPagina = (p: number) => {
    setPagina(p);
    topo.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const pedirSync = async () => {
    setErroSync(null);
    setErroSync(await sincronizar());
  };

  const sync = status?.sincronizacao || dados?.integracao.sincronizacao || null;
  const configurada = status?.configurado ?? dados?.integracao.configurada ?? null;
  const semFiltros = JSON.stringify(filtros) === JSON.stringify(FILTROS_VAZIOS);
  const total = dados?.total ?? 0;
  const inicio = dados ? (dados.pagina - 1) * dados.por_pagina + 1 : 0;

  const botaoSync = (
    <button type="button" onClick={pedirSync} disabled={sincronizando || !configurada} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium disabled:opacity-60 hover:bg-[var(--hover-solid)]" style={{ border: "1px solid var(--line-2)", color: "var(--text)" }}>
      <RefreshCw className={`w-4 h-4 ${sincronizando ? "animate-spin" : ""}`} aria-hidden />
      {sincronizando ? "Sincronizando" : "Sincronizar agora"}
    </button>
  );

  return (
    <div className="space-y-5" ref={topo}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--text)" }}>Imóveis</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-3)" }}>
            {sync && configurada ? (
              <>
                <span className="tabular-nums">{new Intl.NumberFormat("pt-BR").format(sync.imoveis_ativos)}</span> imóveis disponíveis · atualizado {relativo(sync.ultimo_sucesso_em)}
              </>
            ) : configurada === false ? "Conecte o Imoview para trazer sua carteira." : "Carregando…"}
          </p>
        </div>
        {configurada && <div className="flex items-center gap-4">{sincronizando && sync ? <Andamento s={sync} /> : null}{botaoSync}</div>}
      </header>

      {erroSync && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{erroSync}</p>}
      {sync?.estado === "erro" && sync.erro && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl text-sm" style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)", color: "var(--text-2)" }}>
          <span className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--danger)" }} aria-hidden />A última sincronização falhou: {sync.erro} Os imóveis abaixo são da última leitura bem-sucedida.</span>
          <button type="button" onClick={() => onIr("configuracoes")} className="font-medium hover:underline" style={{ color: "var(--text)" }}>Revisar integração</button>
        </div>
      )}
      {sync?.estado === "ok" && sync.aviso && (
        <p role="status" className="px-4 py-3 rounded-xl text-sm" style={{ background: "color-mix(in srgb, var(--warn) 10%, transparent)", color: "var(--text-2)" }}>{sync.aviso}</p>
      )}

      {configurada === false ? (
        <section className="rounded-2xl px-6 py-16 text-center" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
          <span className="mx-auto w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "var(--card-2)", color: "var(--text-3)" }}><Building2 className="w-6 h-6" aria-hidden /></span>
          <h2 className="mt-4 text-base font-semibold" style={{ color: "var(--text)" }}>Conecte o Imoview para ver seus imóveis</h2>
          <p className="mt-1 mx-auto max-w-sm text-sm" style={{ color: "var(--text-3)" }}>Informe o endereço e a chave da API do Imoview. Os imóveis ficam guardados aqui e a consulta é instantânea.</p>
          <button type="button" onClick={() => onIr("configuracoes")} className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium hover:brightness-110" style={{ background: "var(--chip)", color: "var(--chip-text)" }}>Configurar integração</button>
        </section>
      ) : (
        <>
          <BarraFiltros filtros={filtros} onFiltros={mudarFiltros} facetas={facetas} ordem={ordem} onOrdem={(o) => { setOrdem(o); setPagina(1); guardar(visao, o); }} visao={visao} onVisao={(v) => { setVisao(v); guardar(v, ordem); }} semVisao={!largo} />
          <ChipsAtivos filtros={filtros} onFiltros={mudarFiltros} />

          {erro && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{erro}</p>}

          {dados && total > 0 && (
            <p className="text-xs tabular-nums" style={{ color: "var(--text-3)" }} aria-live="polite">
              {inicio}–{Math.min(inicio + dados.itens.length - 1, total)} de {new Intl.NumberFormat("pt-BR").format(total)} {total === 1 ? "imóvel" : "imóveis"}
            </p>
          )}

          <div aria-busy={carregando} className="transition-opacity duration-200" style={{ opacity: carregando && dados ? 0.55 : 1 }}>
            {!dados ? (
              <ul className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-hidden>
                {Array.from({ length: 8 }).map((_, n) => (
                  <li key={n} className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--line)", background: "var(--card)" }}>
                    <div className="aspect-[4/3] animate-pulse" style={{ background: "var(--card-2)" }} />
                    <div className="p-3.5 space-y-2">
                      <div className="h-5 w-2/5 rounded animate-pulse" style={{ background: "var(--card-2)" }} />
                      <div className="h-3 w-4/5 rounded animate-pulse" style={{ background: "var(--card-2)" }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : total === 0 ? (
              <section className="rounded-2xl px-6 py-16 text-center" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
                <span className="mx-auto w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "var(--card-2)", color: "var(--text-3)" }}>
                  {sincronizando ? <Loader2 className="w-6 h-6 animate-spin" aria-hidden /> : <Building2 className="w-6 h-6" aria-hidden />}
                </span>
                <h2 className="mt-4 text-base font-semibold" style={{ color: "var(--text)" }}>
                  {semFiltros ? (sincronizando ? "Buscando seus imóveis no Imoview…" : "Nenhum imóvel no cache ainda") : "Nenhum imóvel com esses filtros"}
                </h2>
                <p className="mt-1 mx-auto max-w-sm text-sm" style={{ color: "var(--text-3)" }}>
                  {semFiltros ? (sincronizando ? "A primeira leitura leva cerca de um minuto. Esta tela atualiza sozinha." : "Clique em Sincronizar agora para trazer a carteira do Imoview.") : "Tente remover algum filtro ou buscar por outro termo."}
                </p>
                {!semFiltros && <button type="button" onClick={() => mudarFiltros({ ...FILTROS_VAZIOS })} className="mt-5 px-5 py-2.5 rounded-full text-sm font-medium hover:brightness-110" style={{ background: "var(--chip)", color: "var(--chip-text)" }}>Limpar filtros</button>}
              </section>
            ) : visao === "cards" || !largo ? (
              <ul className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {dados.itens.map((i) => <CardImovel key={i.codigo} i={i} onAbrir={() => setAberto(i)} />)}
              </ul>
            ) : (
              <Tabela itens={dados.itens} onAbrir={setAberto} />
            )}
          </div>

          {dados && <Paginacao pagina={dados.pagina} paginas={dados.paginas} onPagina={irParaPagina} />}
        </>
      )}

      {aberto && <DetalheImovel resumo={aberto} onFechar={() => setAberto(null)} onAuthError={onAuthError} />}
    </div>
  );
}
