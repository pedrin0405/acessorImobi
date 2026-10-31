"use client";

import React from "react";
import { CalendarCheck, FileText, Handshake, Home, Sparkles } from "lucide-react";
import { AtendimentoImoview, brl, ImovelImoview } from "@/lib/crm";
import { Selo } from "@/components/configuracoes/ui";
import CartaoImovel from "@/components/crm/imoveis/CartaoImovel";
import { dia, diaHora, Painel, Vazio } from "./util";

export interface ImovelMatch { codigo: number; tipo: string | null; bairro: string | null; quartos: number | null; valor: number | null; foto_url: string | null; link_anuncio: string | null }

function Cartao({ im, legenda, selo }: { im: ImovelImoview | null; legenda?: React.ReactNode; selo?: string }) {
  if (!im) return null;
  return (
    <div className="min-w-0 flex flex-col gap-1.5">
      {legenda && <div className="text-xs flex flex-wrap items-center gap-1.5" style={{ color: "var(--text-2)" }}>{legenda}</div>}
      <CartaoImovel
        foto={im.foto} titulo={im.titulo || [im.tipo, im.bairro].filter(Boolean).join(" · ") || `Imóvel ${im.codigo}`}
        subtitulo={[im.bairro, im.cidade].filter(Boolean).join(" · ")} preco={im.valor || undefined} codigo={im.codigo} selo={selo}
        quartos={im.quartos} vagas={im.vagas} area={im.area}
      />
    </div>
  );
}

const Grade = ({ children }: { children: React.ReactNode }) => <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">{children}</div>;

/** Tudo o que o cliente já viu, visitou, propôs ou fechou, mais o que combina com o perfil. */
export default function ImoveisLead({
  atendimentos, match, imovelDoNegocio,
}: { atendimentos: AtendimentoImoview[]; match?: ImovelMatch[] | null; imovelDoNegocio?: number | null }) {
  const carrinho: { im: ImovelImoview; a: number }[] = [];
  const vistos = new Set<number>();
  for (const a of atendimentos) for (const im of a.carrinho ?? []) if (!vistos.has(im.codigo)) { vistos.add(im.codigo); carrinho.push({ im, a: a.codigo }); }
  const visitas = atendimentos.flatMap((a) => (a.visitas ?? []).map((v) => ({ ...v, a: a.codigo })));
  const propostas = atendimentos.flatMap((a) => (a.propostas ?? []).map((v) => ({ ...v, a: a.codigo })));
  const negocios = atendimentos.flatMap((a) => (a.negocios ?? []).map((v) => ({ ...v, a: a.codigo })));
  const nada = !carrinho.length && !visitas.length && !propostas.length && !negocios.length;

  return (
    <div className="space-y-4">
      {imovelDoNegocio ? <p className="text-xs" style={{ color: "var(--text-3)" }}>Imóvel ligado ao negócio: código {imovelDoNegocio}.</p> : null}
      {nada && <Painel><Vazio icone={Home} texto="O Imoview ainda não registrou imóveis de interesse, visitas, propostas ou negócios para este cliente." /></Painel>}

      {carrinho.length > 0 && (
        <Painel titulo={`Imóveis de interesse (${carrinho.length})`}>
          <Grade>{carrinho.map(({ im }) => <Cartao key={im.codigo} im={im} />)}</Grade>
        </Painel>
      )}

      {visitas.length > 0 && (
        <Painel titulo={`Visitas (${visitas.length})`}>
          <Grade>
            {visitas.map((v) => (
              <Cartao key={v.codigo} im={v.imovel} selo={v.situacao || undefined} legenda={<>
                <CalendarCheck className="w-3.5 h-3.5" aria-hidden /><span>{diaHora(v.em)}{v.tipo ? ` · ${v.tipo}` : ""}</span>
                {v.parecer && <Selo tom={v.parecer === "Gostou" ? "ok" : "aviso"}>{v.parecer}</Selo>}
                {(v.motivo || v.complemento) && <span className="basis-full" style={{ color: "var(--text-3)" }}>{[v.motivo, v.complemento].filter(Boolean).join(" — ")}</span>}
              </>} />
            ))}
          </Grade>
        </Painel>
      )}

      {propostas.length > 0 && (
        <Painel titulo={`Propostas (${propostas.length})`}>
          <Grade>
            {propostas.map((p) => (
              <Cartao key={p.codigo} im={p.imovel} legenda={<><FileText className="w-3.5 h-3.5" aria-hidden /><strong>{p.valor ? brl(p.valor) : "Sem valor"}</strong>{p.situacao && <Selo tom={/cancel|recus/i.test(p.situacao) ? "perigo" : "info"}>{p.situacao}</Selo>}<span style={{ color: "var(--text-3)" }}>{dia(p.em)}</span></>} />
            ))}
          </Grade>
        </Painel>
      )}

      {negocios.length > 0 && (
        <Painel titulo={`Negócios fechados (${negocios.length})`}>
          <Grade>
            {negocios.map((n) => (
              <Cartao key={n.codigo} im={n.imovel} legenda={<><Handshake className="w-3.5 h-3.5" aria-hidden /><strong>{n.valor ? brl(n.valor) : "Sem valor"}</strong>{n.situacao && <Selo tom="ok">{n.situacao}</Selo>}{n.comissao ? <span style={{ color: "var(--text-3)" }}>comissão {brl(n.comissao)}</span> : null}<span style={{ color: "var(--text-3)" }}>{dia(n.em)}</span></>} />
            ))}
          </Grade>
        </Painel>
      )}

      {match !== undefined && (
        <Painel titulo="Combina com o perfil" acao={<Sparkles className="w-4 h-4" style={{ color: "var(--text-4)" }} aria-hidden />}>
          {match === null ? <p className="text-sm" style={{ color: "var(--text-3)" }}>Cruzando com a carteira…</p>
            : match.length === 0 ? <p className="text-sm" style={{ color: "var(--text-3)" }}>Nada na carteira atende ao perfil deste cliente hoje.</p>
            : (
              <Grade>
                {match.map((m) => (
                  <CartaoImovel key={m.codigo} foto={m.foto_url} titulo={[m.tipo, m.bairro].filter(Boolean).join(" · ") || `Imóvel ${m.codigo}`} subtitulo={`Cód. ${m.codigo}`}
                    preco={Number(m.valor) > 0 ? brl(Number(m.valor)) : undefined} quartos={m.quartos} codigo={m.codigo}
                    onAbrir={m.link_anuncio ? () => window.open(m.link_anuncio!, "_blank", "noopener,noreferrer") : undefined} ariaLabel={`Abrir anúncio do imóvel ${m.codigo}`} />
                ))}
              </Grade>
            )}
        </Painel>
      )}
    </div>
  );
}
