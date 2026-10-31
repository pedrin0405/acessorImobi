import React from "react";
import { Check, FileText } from "lucide-react";
import FotoImovel from "./FotoImovel";

/* Pequenas demonstrações em CSS das telas do produto. Os dados são de exemplo, sempre rotulados como tal. */

const painel = { background: "var(--card)", border: "1px solid var(--line)", boxShadow: "var(--sombra-funda)" } as const;

export function Ilustrativo() {
  return <p className="mt-3 text-center text-[12px]" style={{ color: "var(--text-4)" }}>Exemplo ilustrativo</p>;
}

/** Cartão de imóvel e as duas páginas de um book. */
export function DemoBook() {
  return (
    <div className="relative mx-auto w-full max-w-[520px]" aria-label="Exemplo ilustrativo: cartão de imóvel e páginas de um book em PDF">
      <div className="grid sm:grid-cols-[1fr_1.05fr] gap-5 items-start">
        <div className="rounded-3xl overflow-hidden" style={painel}>
          <FotoImovel tom={0} className="h-44 w-full" />
          <div className="p-5 space-y-1.5">
            <p className="text-[15px] font-semibold" style={{ color: "var(--text)" }}>Apartamento · Orla 14</p>
            <p className="text-[13px]" style={{ color: "var(--text-3)" }}>2 quartos · 1 vaga · 55 m²</p>
            <p className="text-[19px] font-bold pt-1" style={{ color: "var(--accent-text)" }}>R$ 480.000</p>
            <p className="text-[12.5px] font-semibold underline underline-offset-2 pt-1" style={{ color: "var(--accent-text)" }}>Ver anúncio no site</p>
          </div>
        </div>

        <div className="relative h-[360px] sm:mt-2" aria-hidden>
          <div className="absolute right-0 top-0 w-[66%] h-[84%] rounded-2xl overflow-hidden rotate-[4deg]" style={{ background: "#f4efe6", boxShadow: "0 20px 40px -18px rgb(17 26 31 / .35)", border: "1px solid rgb(17 26 31 / .08)" }}>
            <FotoImovel tom={1} className="h-[46%] w-full" />
            <div className="p-4 space-y-2">
              <p className="text-[17px] font-bold leading-tight" style={{ color: "#17140f" }}>Seleção de imóveis</p>
              <span className="block h-[3px] w-9" style={{ background: "#2f8460" }} />
              <span className="block h-1.5 w-4/5 rounded-full" style={{ background: "rgb(23 20 15 / .14)" }} />
              <span className="block h-1.5 w-3/5 rounded-full" style={{ background: "rgb(23 20 15 / .14)" }} />
            </div>
          </div>
          <div className="absolute left-0 bottom-0 w-[66%] h-[84%] rounded-2xl overflow-hidden -rotate-[3deg]" style={{ background: "#fcfaf6", boxShadow: "0 24px 44px -18px rgb(17 26 31 / .4)", border: "1px solid rgb(17 26 31 / .08)" }}>
            <FotoImovel tom={0} className="h-[42%] w-full" />
            <div className="p-4 space-y-2.5">
              <p className="text-[15px] font-bold leading-tight" style={{ color: "#17140f" }}>Apartamento · Orla 14</p>
              <p className="text-[19px] font-bold" style={{ color: "#2f7a58" }}>R$ 480.000</p>
              {[["Quartos", "2"], ["Vagas", "1"], ["Área", "55 m²"]].map(([r, v]) => (
                <div key={r} className="flex justify-between text-[11.5px] pb-1" style={{ borderBottom: "1px solid rgb(23 20 15 / .12)", color: "#4a4540" }}>
                  <span>{r}</span><span className="font-semibold" style={{ color: "#17140f" }}>{v}</span>
                </div>
              ))}
              <p className="flex items-center gap-1.5 text-[11px] font-semibold pt-1" style={{ color: "#2f7a58" }}><FileText className="w-3.5 h-3.5" /> book.pdf</p>
            </div>
          </div>
        </div>
      </div>
      <Ilustrativo />
    </div>
  );
}

const COLUNAS = [
  { nome: "Lead", total: "R$ 0", cards: [{ n: "Marina Alves", v: "Sem valor", o: "" }, { n: "Rafael Souza", v: "Sem valor", o: "" }] },
  { nome: "Qualificado", total: "R$ 1,2 mi", cards: [{ n: "Paula Nogueira", v: "R$ 750.000", o: "Imóvel de interesse" }, { n: "Diego Martins", v: "R$ 450.000", o: "Orçamento" }] },
  { nome: "Visita realizada", total: "R$ 980 mil", cards: [{ n: "Helena Prado", v: "R$ 980.000", o: "Imóvel de interesse" }] },
  { nome: "Proposta", total: "R$ 420 mil", cards: [{ n: "Bruno Teixeira", v: "R$ 420.000", o: "Proposta" }] },
];

/** Kanban do Fluxo com valores que vêm do CRM. */
export function DemoFluxo() {
  return (
    <div className="w-full" aria-label="Exemplo ilustrativo: funil Kanban do Fluxo">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {COLUNAS.map((c) => (
          <div key={c.nome} className="rounded-2xl p-3 space-y-2.5" style={{ background: "var(--card-2)" }}>
            <div className="px-1">
              <p className="text-[12.5px] font-semibold" style={{ color: "var(--text)" }}>{c.nome}</p>
              <p className="text-[11.5px]" style={{ color: "var(--text-3)" }}>{c.total}</p>
            </div>
            {c.cards.map((k) => (
              <div key={k.n} className="rounded-xl p-2.5" style={{ background: "var(--card)", border: "1px solid var(--line)", boxShadow: "var(--sombra)" }}>
                <p className="text-[12.5px] font-semibold truncate" style={{ color: "var(--text)" }}>{k.n}</p>
                <p className="text-[12.5px] font-bold" style={{ color: k.o ? "var(--text)" : "var(--text-4)" }}>{k.v}</p>
                {k.o && <p className="text-[10.5px]" style={{ color: "var(--text-3)" }}>{k.o}</p>}
              </div>
            ))}
          </div>
        ))}
      </div>
      <Ilustrativo />
    </div>
  );
}

/** Conversa do corretor com um cliente, a análise e a resposta sugerida. */
export function DemoAnalise() {
  return (
    <div className="mx-auto w-full max-w-[560px] grid sm:grid-cols-[1fr_1.1fr] gap-4 items-start" aria-label="Exemplo ilustrativo: conversa com um cliente, análise e resposta sugerida">
      <div className="rounded-3xl p-4 space-y-2 text-[13px]" style={painel}>
        <p className="max-w-[88%] rounded-2xl rounded-bl-md px-3 py-2" style={{ background: "var(--card-2)", color: "var(--text-2)" }}>Boa tarde! Ainda tem aquele de 2 quartos na Orla?</p>
        <p className="max-w-[88%] ml-auto rounded-2xl rounded-br-md px-3 py-2" style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}>Tenho sim. Te mando as fotos.</p>
        <p className="max-w-[88%] rounded-2xl rounded-bl-md px-3 py-2" style={{ background: "var(--card-2)", color: "var(--text-2)" }}>Perfeito. Dá para visitar sábado? E aceita FGTS?</p>
      </div>
      <div className="rounded-3xl p-5 space-y-3.5" style={painel}>
        <div className="flex items-center justify-between">
          <p className="text-[14px] font-semibold" style={{ color: "var(--text)" }}>Análise</p>
          <span className="px-2.5 h-6 inline-flex items-center rounded-full text-[11.5px] font-semibold" style={{ background: "color-mix(in srgb, var(--danger) 12%, transparent)", color: "var(--danger)" }}>Quente</span>
        </div>
        <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-2)" }}>Cliente quer 2 quartos na Orla e pediu visita no sábado. Perguntou sobre FGTS.</p>
        <div>
          <p className="text-[12px] font-semibold mb-1" style={{ color: "var(--text-3)" }}>Próximo passo</p>
          <p className="text-[13px]" style={{ color: "var(--text-2)" }}>Confirmar horário da visita e a condição de FGTS.</p>
        </div>
        <div className="rounded-2xl p-3" style={{ background: "var(--card-2)", border: "1px solid var(--line)" }}>
          <p className="text-[12px] font-semibold mb-1" style={{ color: "var(--text-3)" }}>Sugestão de resposta</p>
          <p className="text-[13px] leading-relaxed" style={{ color: "var(--text)" }}>
            Sábado está ótimo! Fica bom às <mark className="rounded px-1" style={{ background: "color-mix(in srgb, var(--warn) 22%, transparent)", color: "var(--text)" }}>[confirmar horário]</mark>? Sobre o FGTS, <mark className="rounded px-1" style={{ background: "color-mix(in srgb, var(--warn) 22%, transparent)", color: "var(--text)" }}>[confirmar se aceita]</mark>.
          </p>
        </div>
      </div>
      <div className="sm:col-span-2"><Ilustrativo /></div>
    </div>
  );
}

const EQUIPE = [
  { n: "Elenice A.", a: "visita realizada, 2 interações", c: "#2f8460" },
  { n: "Yuri M.", a: "proposta enviada", c: "#35617a" },
  { n: "Taiane C.", a: "respondeu em 4 min", c: "#667a3d" },
];
const LINHA = ["Cliente entrou na carteira", "Primeira resposta ao cliente", "Visita agendada para sábado", "Moveu para Visita realizada"];

/** Visão da gestão: equipe, funil e linha do tempo de um cliente. */
export function DemoGestao() {
  return (
    <div className="mx-auto w-full max-w-[560px] grid sm:grid-cols-2 gap-4 items-start" aria-label="Exemplo ilustrativo: painel de gestão com equipe e linha do tempo de um cliente">
      <div className="rounded-3xl p-5 space-y-4" style={painel}>
        <p className="text-[14px] font-semibold" style={{ color: "var(--text)" }}>Equipe hoje</p>
        {EQUIPE.map((e) => (
          <div key={e.n} className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold text-white shrink-0" style={{ background: e.c }}>{e.n.slice(0, 1)}</span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold truncate" style={{ color: "var(--text)" }}>{e.n}</p>
              <p className="text-[12px] truncate" style={{ color: "var(--text-3)" }}>{e.a}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-3xl p-5" style={painel}>
        <p className="text-[14px] font-semibold mb-3" style={{ color: "var(--text)" }}>Linha do tempo do cliente</p>
        <ol className="space-y-3">
          {LINHA.map((l, i) => (
            <li key={l} className="flex items-start gap-2.5 text-[12.5px]" style={{ color: "var(--text-2)" }}>
              <span className="mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0" style={{ background: i === 0 ? "var(--accent)" : "var(--accent-soft)", color: i === 0 ? "#fff" : "var(--accent-text)" }}>
                <Check className="w-2.5 h-2.5" strokeWidth={3} aria-hidden />
              </span>
              {l}
            </li>
          ))}
        </ol>
      </div>
      <div className="sm:col-span-2"><Ilustrativo /></div>
    </div>
  );
}
