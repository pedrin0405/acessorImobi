"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { BedDouble, Bath, Car, Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Home, ImageOff, MapPin, Ruler, X } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { ImovelDetalhe, ImovelResumo, numero, precoDoImovel, reais, relativo, rotuloFinalidade } from "./tipos";

function Ficha({ icone: Icone, valor, rotulo }: { icone: React.ComponentType<{ className?: string }>; valor: React.ReactNode; rotulo: string }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Icone className="w-[18px] h-[18px] shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-[15px] font-semibold leading-tight tabular-nums" style={{ color: "var(--text)" }}>{valor}</p>
        <p className="text-[11px]" style={{ color: "var(--text-3)" }}>{rotulo}</p>
      </div>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-[13px]" style={{ borderTop: "1px solid var(--line)" }}>
      <dt style={{ color: "var(--text-3)" }}>{rotulo}</dt>
      <dd className="text-right" style={{ color: "var(--text)" }}>{valor}</dd>
    </div>
  );
}

export default function DetalheImovel({ resumo, onFechar, onAuthError }: { resumo: ImovelResumo; onFechar: () => void; onAuthError: (e: unknown) => boolean }) {
  const [dados, setDados] = useState<ImovelDetalhe | null>(null);
  const [erro, setErro] = useState(false);
  const [foto, setFoto] = useState(0);
  const [quebradas, setQuebradas] = useState<Set<string>>(new Set());
  const [copiado, setCopiado] = useState(false);
  const [leiaMais, setLeiaMais] = useState(false);
  const fechar = useRef<HTMLButtonElement | null>(null);
  const voltarPara = useRef<HTMLElement | null>(null);

  useEffect(() => {
    voltarPara.current = document.activeElement as HTMLElement | null;
    fechar.current?.focus();
    return () => voltarPara.current?.focus?.();
  }, []);

  useEffect(() => {
    let vivo = true;
    setDados(null);
    setErro(false);
    setFoto(0);
    (async () => {
      try {
        const res = await fetchApi(`/admin/imoveis/${resumo.codigo}`);
        if (!res.ok) throw new Error("falha");
        const d: ImovelDetalhe = await res.json();
        if (vivo) setDados(d);
      } catch (e) {
        if (vivo && !onAuthError(e)) setErro(true);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [resumo.codigo, onAuthError]);

  const fotos = (dados?.fotos?.length ? dados.fotos : resumo.foto_url ? [{ url: resumo.foto_url, descricao: "" }] : []).filter((f) => !quebradas.has(f.url));
  const atual = fotos[Math.min(foto, Math.max(fotos.length - 1, 0))];

  const mover = useCallback((passo: number) => setFoto((i) => (fotos.length ? (i + passo + fotos.length) % fotos.length : 0)), [fotos.length]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
      else if (e.key === "ArrowRight") mover(1);
      else if (e.key === "ArrowLeft") mover(-1);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onFechar, mover]);

  const copiar = async () => {
    if (!dados) return;
    try {
      await navigator.clipboard.writeText(dados.texto_compartilhar);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* sem permissão de área de transferência: nada a fazer */
    }
  };

  const d = dados;
  const endereco = d?.endereco || {};
  const logradouro = [endereco.logradouro, endereco.numero].filter(Boolean).join(", ");
  const caracteristicas = Array.from(new Set([...(d?.caracteristicas || []), ...(d?.extras || [])]));
  const mapa = d?.latitude && d?.longitude ? `https://www.google.com/maps?q=${d.latitude},${d.longitude}` : null;
  // Os títulos do Imoview vêm em CAIXA ALTA; aqui viram "Apartamento | 3 Suítes | Lazer Completo".
  const titulo = (d?.titulo || resumo.titulo || `${resumo.tipo || "Imóvel"} em ${resumo.bairro || ""}`)
    .trim().toLowerCase().replace(/(^|[\s|/-]+)([a-zà-ÿ])/g, (_, sep: string, l: string) => sep + l.toUpperCase());

  return (
    <div className="fixed inset-0 z-50 !m-0">
      <div className="assist-fade absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onFechar} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-label={`Imóvel ${resumo.codigo}`} className="assist-slide-left absolute right-0 top-0 h-full w-full max-w-xl flex flex-col shadow-2xl" style={{ background: "var(--sidebar)", borderLeft: "1px solid var(--line-2)" }}>
        <header className="shrink-0 flex items-center justify-between gap-3 px-5 h-14" style={{ borderBottom: "1px solid var(--line)" }}>
          <p className="text-sm" style={{ color: "var(--text-3)" }}>
            <span className="font-medium" style={{ color: "var(--text-2)" }}>{rotuloFinalidade(resumo.finalidade)}</span> · Código <span className="tabular-nums">{resumo.codigo}</span>
          </p>
          <button ref={fechar} type="button" onClick={onFechar} aria-label="Fechar detalhes do imóvel" className="p-2 -mr-2 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}>
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Galeria */}
          <div className="relative aspect-[16/10] w-full" style={{ background: "var(--card-2)" }}>
            {atual ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={atual.url} src={atual.url} alt={atual.descricao || `Foto ${foto + 1} do imóvel ${resumo.codigo}`} referrerPolicy="no-referrer" onError={() => setQuebradas((q) => new Set(q).add(atual.url))} className="assist-fade absolute inset-0 w-full h-full object-cover" />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ color: "var(--text-4)" }}>
                <ImageOff className="w-8 h-8" aria-hidden />
                <span className="text-xs">Sem fotos</span>
              </div>
            )}
            {fotos.length > 1 && (
              <>
                <button type="button" onClick={() => mover(-1)} aria-label="Foto anterior" className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center bg-black/60 text-white hover:bg-black/80 backdrop-blur-sm"><ChevronLeft className="w-5 h-5" /></button>
                <button type="button" onClick={() => mover(1)} aria-label="Próxima foto" className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center bg-black/60 text-white hover:bg-black/80 backdrop-blur-sm"><ChevronRight className="w-5 h-5" /></button>
                <span className="absolute right-3 bottom-3 px-2 py-0.5 rounded-md text-xs tabular-nums bg-black/65 text-white" aria-live="polite">{Math.min(foto, fotos.length - 1) + 1} / {fotos.length}</span>
              </>
            )}
          </div>
          {fotos.length > 1 && (
            <ul className="flex gap-1.5 overflow-x-auto px-5 py-3" aria-label="Fotos do imóvel">
              {fotos.map((f, i) => (
                <li key={f.url} className="shrink-0">
                  <button type="button" onClick={() => setFoto(i)} aria-label={`Ver foto ${i + 1}`} aria-current={i === foto} className="block w-16 h-12 rounded-md overflow-hidden transition-opacity" style={{ outline: i === foto ? "2px solid var(--accent)" : "none", outlineOffset: 1, opacity: i === foto ? 1 : 0.65 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.url} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="px-5 pb-8 pt-2 space-y-6">
            <section>
              <h2 className="text-lg font-semibold leading-snug" style={{ color: "var(--text)" }}>{titulo}</h2>
              <p className="mt-1 flex items-center gap-1.5 text-sm" style={{ color: "var(--text-3)" }}>
                <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden />
                {[resumo.bairro, resumo.cidade && `${resumo.cidade}${resumo.estado ? `/${resumo.estado}` : ""}`].filter(Boolean).join(" · ") || "Local não informado"}
              </p>
              <p className="mt-4 text-2xl font-semibold tabular-nums" style={{ color: "var(--text)" }}>{precoDoImovel(resumo)}</p>
              <p className="mt-1 text-xs tabular-nums" style={{ color: "var(--text-3)" }}>
                {[resumo.valor_condominio ? `Condomínio ${reais(resumo.valor_condominio)}` : "", d?.valor_iptu ? `IPTU ${reais(d.valor_iptu)}` : "", d?.valor_m2 && resumo.finalidade === "venda" ? `${reais(d.valor_m2)}/m²` : ""].filter(Boolean).join(" · ")}
              </p>
              {!resumo.ativo && <p className="mt-3 text-xs px-3 py-2 rounded-lg" style={{ background: "color-mix(in srgb, var(--warn) 12%, transparent)", color: "var(--warn)" }}>Este imóvel não aparece mais no Imoview (saiu da lista de disponíveis).</p>}
            </section>

            <section className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4 py-4" style={{ borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", color: "var(--text-3)" }} aria-label="Características principais">
              <Ficha icone={BedDouble} valor={numero(resumo.quartos)} rotulo={resumo.suites ? `quartos (${resumo.suites} suíte${resumo.suites > 1 ? "s" : ""})` : "quartos"} />
              <Ficha icone={Bath} valor={numero(resumo.banheiros)} rotulo="banheiros" />
              <Ficha icone={Car} valor={numero(resumo.vagas)} rotulo="vagas" />
              <Ficha icone={Ruler} valor={resumo.area_m2 ? `${numero(resumo.area_m2)} m²` : "—"} rotulo="área" />
              {d?.andar ? <Ficha icone={Home} valor={`${d.andar}º`} rotulo="andar" /> : null}
              {d?.ano_construcao ? <Ficha icone={Home} valor={d.ano_construcao} rotulo="construção" /> : null}
            </section>

            {erro && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>Não foi possível carregar todos os detalhes agora. Mostrando o que já está no cache.</p>}
            {!d && !erro && (
              <div className="space-y-2" aria-hidden>
                {[0, 1, 2].map((i) => <div key={i} className="h-4 rounded animate-pulse" style={{ background: "var(--card-2)", width: `${90 - i * 18}%` }} />)}
              </div>
            )}

            {d?.descricao && (
              <section aria-label="Descrição">
                <h3 className="text-sm font-semibold mb-2" style={{ color: "var(--text)" }}>Descrição</h3>
                <p className={`text-[14px] leading-relaxed whitespace-pre-line ${leiaMais ? "" : "line-clamp-6"}`} style={{ color: "var(--text-2)" }}>{d.descricao}</p>
                {d.descricao.length > 320 && (
                  <button type="button" onClick={() => setLeiaMais((v) => !v)} className="mt-1.5 text-xs hover:underline" style={{ color: "var(--accent-text)" }}>{leiaMais ? "Mostrar menos" : "Ler mais"}</button>
                )}
              </section>
            )}

            {caracteristicas.length > 0 && (
              <section aria-label="Diferenciais">
                <h3 className="text-sm font-semibold mb-2" style={{ color: "var(--text)" }}>Diferenciais</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {caracteristicas.map((c) => (
                    <li key={c} className="px-2.5 py-1 rounded-full text-xs" style={{ background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--text-2)" }}>{c}</li>
                  ))}
                </ul>
              </section>
            )}

            {d && (
              <section aria-label="Condições e endereço">
                <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--text)" }}>Condições e endereço</h3>
                <dl>
                  <Linha rotulo="Financiamento" valor={d.aceita_financiamento ? "Aceita" : "Não informado"} />
                  <Linha rotulo="Permuta" valor={d.aceita_permuta ? "Aceita" : "Não informado"} />
                  {d.exclusivo && <Linha rotulo="Exclusividade" valor="Imóvel exclusivo" />}
                  {d.tipo_vagas && <Linha rotulo="Vagas" valor={d.tipo_vagas} />}
                  {d.destinacao && <Linha rotulo="Destinação" valor={d.destinacao} />}
                  {d.area_lote ? <Linha rotulo="Área do lote" valor={`${numero(d.area_lote)} m²`} /> : null}
                  {logradouro && <Linha rotulo="Endereço" valor={[logradouro, endereco.complemento].filter(Boolean).join(" · ")} />}
                  {(endereco.edificio || endereco.condominio) && <Linha rotulo="Edifício" valor={endereco.edificio || endereco.condominio} />}
                  {endereco.cep && <Linha rotulo="CEP" valor={endereco.cep} />}
                </dl>
                <p className="mt-3 text-[11px]" style={{ color: "var(--text-4)" }}>
                  Dados do Imoview, lidos {relativo(d.sincronizado_em)}{d.alterado_em ? ` · alterado no Imoview em ${new Date(d.alterado_em).toLocaleDateString("pt-BR")}` : ""}.
                </p>
              </section>
            )}
          </div>
        </div>

        <footer className="shrink-0 flex flex-wrap items-center gap-2 px-5 py-3" style={{ borderTop: "1px solid var(--line)", background: "var(--sidebar)" }}>
          <button type="button" onClick={copiar} disabled={!d} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium disabled:opacity-50 hover:brightness-110" style={{ background: "var(--chip)", color: "var(--chip-text)" }}>
            {copiado ? <Check className="w-4 h-4" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />}
            {copiado ? "Texto copiado" : "Copiar texto para enviar"}
          </button>
          {resumo.link && (
            <a href={resumo.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm hover:bg-[var(--hover-solid)]" style={{ border: "1px solid var(--line-2)", color: "var(--text-2)" }}>
              <ExternalLink className="w-4 h-4" aria-hidden /> Abrir anúncio
            </a>
          )}
          {mapa && (
            <a href={mapa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm hover:bg-[var(--hover-solid)]" style={{ border: "1px solid var(--line-2)", color: "var(--text-2)" }}>
              <MapPin className="w-4 h-4" aria-hidden /> Ver no mapa
            </a>
          )}
        </footer>
      </aside>
    </div>
  );
}
