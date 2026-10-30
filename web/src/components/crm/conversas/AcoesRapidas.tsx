"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Building2, Loader2, Search, Send, UserRound, X } from "lucide-react";
import { fetchApi } from "@/lib/api";
import type { MensagemChat } from "../ChatMensagens";
import CartaoImovel from "../imoveis/CartaoImovel";
import { ImovelResumo, ListaImoveis, precoDoImovel, rotuloFinalidade } from "../imoveis/tipos";

export type TipoAcao = "imoveis" | "lead";
const MAX_IMOVEIS = 6;

interface ClienteLista {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  origem: string;
  corretor_nome: string | null;
}

interface PartePrevia {
  tipo: string;
  texto: string;
  foto_url: string | null;
}

class ErroApi extends Error {}
const detalhe = (d: { detail?: unknown }, padrao: string) => (typeof d?.detail === "string" ? d.detail : padrao);

function useDebounce<T>(valor: T, ms = 300) {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

/** *negrito* do WhatsApp na prévia. */
function Zap({ texto }: { texto: string }) {
  return (
    <>
      {texto.split(/(\*[^*\n]+\*)/g).map((p, i) => (p.length > 2 && p.startsWith("*") && p.endsWith("*") ? <strong key={i}>{p.slice(1, -1)}</strong> : <React.Fragment key={i}>{p}</React.Fragment>))}
    </>
  );
}

export default function AcoesRapidas({
  corretorId,
  corretorNome,
  tipoInicial,
  onFechar,
  onEnviado,
  onAuthError,
}: {
  corretorId: string;
  corretorNome: string;
  tipoInicial: TipoAcao;
  onFechar: () => void;
  onEnviado: (mensagens: MensagemChat[], falhas: number) => void;
  onAuthError: (e: unknown) => boolean;
}) {
  const [tipo, setTipo] = useState<TipoAcao>(tipoInicial);
  const [busca, setBusca] = useState("");
  const termo = useDebounce(busca.trim());
  const [finalidade, setFinalidade] = useState("");
  const [pagina, setPagina] = useState(1);

  const [imoveis, setImoveis] = useState<ListaImoveis | null>(null);
  const [clientes, setClientes] = useState<{ itens: ClienteLista[]; paginas: number } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [codigos, setCodigos] = useState<number[]>([]);
  const [cliente, setCliente] = useState<ClienteLista | null>(null);
  const [mensagem, setMensagem] = useState("");
  const [previa, setPrevia] = useState<PartePrevia[] | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);
  const caixa = useRef<HTMLDivElement | null>(null);
  const requisicao = useRef(0);

  useEffect(() => setPagina(1), [termo, finalidade, tipo]);

  useEffect(() => {
    const minha = ++requisicao.current;
    setCarregando(true);
    (async () => {
      try {
        const q = new URLSearchParams({ pagina: String(pagina) });
        if (tipo === "imoveis") {
          q.set("por_pagina", "12"); q.set("facetas", "false");
          if (termo) q.set("busca", termo);
          if (finalidade) q.set("finalidade", finalidade);
          const res = await fetchApi(`/admin/imoveis?${q}`);
          const d = await res.json().catch(() => ({}));
          if (!res.ok) throw new ErroApi(detalhe(d, "Não consegui carregar os imóveis."));
          if (minha === requisicao.current) { setImoveis(d); setErro(null); }
        } else {
          q.set("por_pagina", "10");
          if (termo) q.set("termo", termo);
          const res = await fetchApi(`/admin/crm/clientes?${q}`);
          const d = await res.json().catch(() => ({}));
          if (!res.ok) throw new ErroApi(detalhe(d, "Não consegui carregar os clientes."));
          if (minha === requisicao.current) { setClientes(d); setErro(null); }
        }
      } catch (e) {
        if (!onAuthError(e) && minha === requisicao.current) setErro(e instanceof ErroApi ? e.message : "Falha de conexão.");
      } finally {
        if (minha === requisicao.current) setCarregando(false);
      }
    })();
  }, [tipo, termo, finalidade, pagina, onAuthError]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", esc);
    caixa.current?.focus();
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);

  const corpo = useCallback(() => ({
    tipo, codigos: tipo === "imoveis" ? codigos : [], lead_id: tipo === "lead" ? cliente?.id : null, mensagem: mensagem.trim(),
  }), [tipo, codigos, cliente, mensagem]);

  const escolhido = tipo === "imoveis" ? codigos.length > 0 : !!cliente;

  const chamar = async (caminho: string) => {
    setTrabalhando(true); setErro(null);
    try {
      const res = await fetchApi(`/admin/conversas/${corretorId}/acoes-rapidas/${caminho}`, { method: "POST", body: JSON.stringify(corpo()) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new ErroApi(detalhe(d, "Não foi possível concluir agora."));
      return d;
    } catch (e) {
      if (!onAuthError(e)) setErro(e instanceof ErroApi ? e.message : "Falha de conexão. Tente de novo.");
      return null;
    } finally {
      setTrabalhando(false);
    }
  };

  const verPrevia = async () => { const d = await chamar("previa"); if (d) setPrevia(d.mensagens); };
  const enviar = async () => {
    const d = await chamar("enviar");
    if (!d) return;
    onEnviado(d.mensagens, d.falhas || 0);
    onFechar();
  };

  const alternarImovel = (c: number) => setCodigos((l) => (l.includes(c) ? l.filter((x) => x !== c) : l.length >= MAX_IMOVEIS ? l : [...l, c]));
  const aba = (t: TipoAcao, rotulo: string, Icone: typeof Building2) => (
    <button type="button" role="tab" aria-selected={tipo === t} onClick={() => { setTipo(t); setPrevia(null); setBusca(""); }} className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors" style={{ background: tipo === t ? "var(--hover-solid)" : "transparent", color: tipo === t ? "var(--text)" : "var(--text-3)" }}>
      <Icone className="w-4 h-4" aria-hidden />{rotulo}
    </button>
  );
  const paginas = tipo === "imoveis" ? imoveis?.paginas || 1 : clientes?.paginas || 1;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div ref={caixa} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Ação rápida" className="assist-pop w-full sm:max-w-3xl max-h-[100dvh] sm:max-h-[88vh] flex flex-col rounded-t-3xl sm:rounded-3xl outline-none overflow-hidden" style={{ background: "var(--bg)", border: "1px solid var(--line-2)" }}>
        <header className="flex items-center gap-3 px-5 pt-4 pb-3" style={{ borderBottom: "1px solid var(--line)" }}>
          {previa && <button type="button" onClick={() => setPrevia(null)} aria-label="Voltar" className="p-1.5 -ml-1.5 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}><ArrowLeft className="w-5 h-5" /></button>}
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold truncate" style={{ color: "var(--text)" }}>{previa ? `Prévia para ${corretorNome}` : `Enviar a ${corretorNome}`}</h2>
            {!previa && <div role="tablist" aria-label="O que enviar" className="inline-flex mt-2 p-0.5 rounded-full" style={{ background: "var(--card-2)", border: "1px solid var(--line)" }}>{aba("imoveis", "Imóveis", Building2)}{aba("lead", "Cliente", UserRound)}</div>}
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="p-1.5 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}><X className="w-5 h-5" /></button>
        </header>

        {previa ? (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            <p className="text-xs" style={{ color: "var(--text-3)" }}>É assim que chega no WhatsApp do corretor, pelo número do agente.</p>
            {previa.map((p, i) => (
              <div key={i} className="max-w-[24rem] rounded-2xl overflow-hidden border border-[var(--line-2)]" style={{ background: "color-mix(in srgb, var(--info) 11%, var(--card))" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.foto_url && <img src={p.foto_url} alt="" referrerPolicy="no-referrer" className="w-full max-h-56 object-cover" />}
                <p className="px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words" style={{ color: "var(--text)" }}><Zap texto={p.texto} /></p>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="px-5 pt-3 flex flex-wrap items-center gap-2">
              <label className="relative flex-1 min-w-[12rem]">
                <span className="sr-only">Buscar</span>
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-4)" }} aria-hidden />
                <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={tipo === "imoveis" ? "Código, bairro, tipo…" : "Nome, telefone ou e-mail"} className="w-full h-10 rounded-full pl-10 pr-4 text-sm outline-none focus:border-[var(--accent)]" style={{ background: "var(--card)", border: "1px solid var(--line-2)", color: "var(--text)" }} />
              </label>
              {tipo === "imoveis" && (
                <div role="radiogroup" aria-label="Finalidade" className="inline-flex p-0.5 rounded-full" style={{ background: "var(--card-2)", border: "1px solid var(--line)" }}>
                  {[["", "Todos"], ["venda", "Venda"], ["aluguel", "Aluguel"]].map(([v, r]) => (
                    <button key={v} type="button" role="radio" aria-checked={finalidade === v} onClick={() => setFinalidade(v)} className="px-3 py-1 rounded-full text-[13px] font-medium" style={{ background: finalidade === v ? "var(--hover-solid)" : "transparent", color: finalidade === v ? "var(--text)" : "var(--text-3)" }}>{r}</button>
                  ))}
                </div>
              )}
            </div>
            {tipo === "imoveis" && <p className="px-5 pt-2 text-xs" style={{ color: "var(--text-3)" }}>{codigos.length === 0 ? `Toque nos imóveis para escolher (até ${MAX_IMOVEIS}).` : `${codigos.length} de ${MAX_IMOVEIS} escolhidos.`}</p>}

            <div className="flex-1 overflow-y-auto px-5 py-3" aria-busy={carregando} style={{ opacity: carregando ? 0.6 : 1, transition: "opacity .15s" }}>
              {erro && <p role="alert" className="text-sm mb-3" style={{ color: "var(--danger)" }}>{erro}</p>}
              {tipo === "imoveis" ? (
                !imoveis ? <p className="text-sm py-8 text-center" style={{ color: "var(--text-3)" }}>Carregando a carteira…</p>
                : imoveis.itens.length === 0 ? <p className="text-sm py-8 text-center" style={{ color: "var(--text-3)" }}>Nenhum imóvel encontrado.</p>
                : (
                  <ul className="grid gap-3 grid-cols-2 sm:grid-cols-3">
                    {imoveis.itens.map((i: ImovelResumo) => {
                      const sel = codigos.includes(i.codigo);
                      return (
                        <li key={i.codigo}>
                          <CartaoImovel foto={i.foto_url} titulo={`${i.tipo || "Imóvel"} · ${i.bairro || "—"}`} preco={precoDoImovel(i)} selo={rotuloFinalidade(i.finalidade)} codigo={i.codigo} quartos={i.quartos} vagas={i.vagas} area={i.area_m2 ? Math.round(i.area_m2) : null} selecionado={sel} onAbrir={() => alternarImovel(i.codigo)} ariaLabel={`${sel ? "Remover" : "Escolher"} ${i.tipo || "imóvel"} ${i.bairro || ""}, código ${i.codigo}`} />
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : !clientes ? <p className="text-sm py-8 text-center" style={{ color: "var(--text-3)" }}>Carregando clientes…</p>
              : clientes.itens.length === 0 ? <p className="text-sm py-8 text-center" style={{ color: "var(--text-3)" }}>Nenhum cliente encontrado.</p>
              : (
                <ul role="radiogroup" aria-label="Cliente" className="space-y-1.5">
                  {clientes.itens.map((c) => (
                    <li key={c.id}>
                      <button type="button" role="radio" aria-checked={cliente?.id === c.id} onClick={() => setCliente(c)} className="w-full text-left px-3.5 py-2.5 rounded-xl flex items-center gap-3 transition-colors hover:bg-[var(--hover-solid)]" style={{ border: `1px solid ${cliente?.id === c.id ? "var(--accent)" : "var(--line)"}`, background: cliente?.id === c.id ? "var(--accent-soft)" : "var(--card)" }}>
                        <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-semibold" style={{ background: "var(--card-2)", color: "var(--text-2)" }}>{c.nome.charAt(0).toUpperCase()}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium truncate" style={{ color: "var(--text)" }}>{c.nome}</span>
                          <span className="block text-xs truncate" style={{ color: "var(--text-3)" }}>{[c.telefone, c.email].filter(Boolean).join(" · ") || "Sem contato"} · {c.corretor_nome || "sem responsável"}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {paginas > 1 && (
                <div className="flex items-center justify-center gap-3 pt-4 text-[13px]" style={{ color: "var(--text-3)" }}>
                  <button type="button" onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={pagina <= 1} className="px-3 py-1 rounded-lg hover:bg-[var(--hover-solid)] disabled:opacity-30">Anterior</button>
                  <span className="tabular-nums">{pagina} de {paginas}</span>
                  <button type="button" onClick={() => setPagina((p) => Math.min(paginas, p + 1))} disabled={pagina >= paginas} className="px-3 py-1 rounded-lg hover:bg-[var(--hover-solid)] disabled:opacity-30">Próxima</button>
                </div>
              )}
            </div>

            <div className="px-5 pt-2">
              <label className="block">
                <span className="sr-only">Mensagem junto (opcional)</span>
                <input value={mensagem} onChange={(e) => setMensagem(e.target.value)} maxLength={1000} placeholder="Mensagem junto, se quiser (opcional)" className="w-full h-10 rounded-full px-4 text-sm outline-none focus:border-[var(--accent)]" style={{ background: "var(--card)", border: "1px solid var(--line-2)", color: "var(--text)" }} />
              </label>
            </div>
          </>
        )}

        <footer className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderTop: "1px solid var(--line)" }}>
          {erro && previa ? <p role="alert" className="text-xs flex-1" style={{ color: "var(--danger)" }}>{erro}</p> : <span className="text-xs" style={{ color: "var(--text-3)" }}>{previa ? `${previa.length} ${previa.length === 1 ? "mensagem" : "mensagens"}` : tipo === "lead" ? "A ficha não leva CPF nem CNPJ." : ""}</span>}
          {previa ? (
            <button type="button" onClick={enviar} disabled={trabalhando} className="inline-flex items-center gap-2 px-5 h-10 rounded-full text-sm font-medium disabled:opacity-50" style={{ background: "var(--chip)", color: "var(--chip-text)" }}>
              {trabalhando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" aria-hidden />} Enviar ao corretor
            </button>
          ) : (
            <button type="button" onClick={verPrevia} disabled={!escolhido || trabalhando} className="inline-flex items-center gap-2 px-5 h-10 rounded-full text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: "var(--chip)", color: "var(--chip-text)" }}>
              {trabalhando && <Loader2 className="w-4 h-4 animate-spin" />} Ver prévia
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
