"use client";

import React from "react";
import { CalendarCheck, CircleDollarSign, Clock, FileText, Flame, Handshake, Home, MessageCircle, MessageSquare, Timer, UserCheck, Wallet } from "lucide-react";
import { brl, resumoPerfil } from "@/lib/crm";
import type { Ficha, NegocioLead } from "@/components/crm/FichaCliente";
import { rotuloValor, tempoAtras } from "@/components/crm/FluxoBits";
import LinhaDoTempo from "./LinhaDoTempo";
import { dataCurta, diasDesde, diaHora, duracao, LinhaDoTempoDados, Metrica, Painel, ROTULO_VALOR, TIPO_ATIV, Vazio } from "./util";

/** Negócio que vale para o cliente: o aberto mais recente ou, se não houver, o mais recente. */
export function negocioPrincipal(ficha: Ficha): NegocioLead | undefined {
  return ficha.negocios.find((n) => n.status === "aberto") ?? ficha.negocios[0];
}

export default function MetricasLead({ ficha, tempo, onAba }: { ficha: Ficha; tempo: LinhaDoTempoDados | null; onAba: (aba: string) => void }) {
  const r = tempo?.resumo;
  const neg = negocioPrincipal(ficha);
  const at = ficha.atendimentos?.[0];
  const valor = neg && neg.valor > 0 ? neg.valor : r?.valor_potencial ?? null;
  const origem = neg ? (rotuloValor(neg) ?? (neg.im_valor_tipo ? ROTULO_VALOR[neg.im_valor_tipo] : null)) : null;
  const comissao = neg?.im_comissao ?? r?.comissao ?? null;
  const previsao = neg?.fechamento_previsto || at?.previsao_fechamento_em;
  const ultima = at?.ultima_interacao_em || ficha.ultimo_contato;
  const carrinho = (ficha.atendimentos ?? []).flatMap((a) => a.carrinho ?? []).slice(0, 4);
  const abertas = ficha.atividades.filter((a) => a.status === "aberta").sort((a, b) => (a.inicio ?? "").localeCompare(b.inicio ?? "")).slice(0, 4);
  const diasFunil = diasDesde(neg?.created_at);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
        <Metrica Icone={CircleDollarSign} destaque rotulo="Valor potencial" valor={valor ? brl(valor) : "—"} sub={origem ? `Origem: ${origem}` : valor ? undefined : "O CRM ainda não informou valor"} />
        <Metrica Icone={Wallet} rotulo="Comissão prevista" valor={comissao ? brl(comissao) : "—"} sub={comissao ? "Informada pelo Imoview" : "Sem comissão informada"} />
        <Metrica Icone={Timer} rotulo="Primeira resposta" valor={duracao(r?.primeira_resposta_min)} sub="Entre a entrada do lead e a resposta" />
        <Metrica Icone={UserCheck} rotulo="Ações do corretor" valor={r?.acoes_do_corretor ?? "—"} sub={r?.primeiro_evento ? `Desde ${dataCurta(r.primeiro_evento)}` : undefined} />
        <Metrica Icone={MessageSquare} rotulo="Interações no CRM" valor={r?.interacoes ?? "—"} />
        <Metrica Icone={CalendarCheck} rotulo="Visitas" valor={r?.visitas ?? "—"} />
        <Metrica Icone={FileText} rotulo="Propostas" valor={r?.propostas ?? "—"} />
        <Metrica Icone={Handshake} rotulo="Negócios fechados" valor={r?.negocios ?? "—"} />
        <Metrica Icone={MessageCircle} rotulo="Mensagens" valor={r ? <span>{r.mensagens_corretor}<span className="text-xs font-normal" style={{ color: "var(--text-3)" }}> corretor · </span>{r.mensagens_cliente}<span className="text-xs font-normal" style={{ color: "var(--text-3)" }}> cliente</span></span> : "—"} sub="No WhatsApp pessoal" />
        <Metrica Icone={Clock} rotulo="Dias no Fluxo" valor={diasFunil ?? "—"} sub={neg ? `${neg.etapa_nome}${neg.status === "aberto" ? ` há ${neg.dias_na_etapa} d` : ""}` : "Sem negócio"} />
        <Metrica Icone={Flame} rotulo="Temperatura" valor={<span className="capitalize">{ficha.temperatura}</span>} sub={at?.termometro ? `No Imoview: ${at.termometro}` : undefined} />
        <Metrica Icone={Clock} rotulo="Previsão / última interação" valor={previsao ? dataCurta(previsao) : "—"} sub={ultima ? `Última interação ${tempoAtras(ultima)}` : "Sem interação registrada"} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Painel titulo="O que ele procura">
          <p className="text-sm" style={{ color: "var(--text-2)" }}>{resumoPerfil(ficha.perfil)}</p>
          {at?.perfil && (at.perfil.tipos?.length || at.perfil.bairros?.length || at.perfil.valor_ate) ? (
            <p className="text-xs mt-2" style={{ color: "var(--text-3)" }}>No Imoview: {[at.perfil.tipos?.join(", "), at.perfil.bairros?.join(", "), at.perfil.valor_ate ? `até ${brl(at.perfil.valor_ate)}` : ""].filter(Boolean).join(" · ")}</p>
          ) : null}
        </Painel>

        <Painel titulo="Próximos compromissos" acao={<button type="button" onClick={() => onAba("agenda")} className="text-xs underline" style={{ color: "var(--text-3)" }}>Ver agenda</button>}>
          {abertas.length === 0 ? <p className="text-sm" style={{ color: "var(--text-3)" }}>Nenhum compromisso em aberto.</p> : (
            <ul className="space-y-2 text-sm">
              {abertas.map((a) => <li key={a.id} className="flex justify-between gap-3"><span className="truncate" style={{ color: a.atrasada ? "var(--warn)" : "var(--text)" }}>{TIPO_ATIV[a.tipo] ?? a.tipo}: {a.titulo}</span><span className="text-xs shrink-0 tabular-nums" style={{ color: "var(--text-3)" }}>{a.inicio ? diaHora(a.inicio) : "sem data"}</span></li>)}
            </ul>
          )}
        </Painel>
      </div>

      <Painel titulo="Imóveis de interesse" acao={<button type="button" onClick={() => onAba("imoveis")} className="text-xs underline" style={{ color: "var(--text-3)" }}>Ver todos</button>}>
        {carrinho.length === 0 ? <Vazio icone={Home} texto="Nenhum imóvel no carrinho do Imoview." /> : (
          <ul className="grid sm:grid-cols-2 gap-3">
            {carrinho.map((im) => (
              <li key={im.codigo} className="flex gap-3 min-w-0">
                {im.foto ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={im.foto} alt="" loading="lazy" className="w-16 h-12 rounded-md object-cover shrink-0" style={{ background: "var(--card-2)" }} /> : <div className="w-16 h-12 rounded-md flex items-center justify-center shrink-0" style={{ background: "var(--card-2)" }}><Home className="w-4 h-4" style={{ color: "var(--text-4)" }} aria-hidden /></div>}
                <div className="min-w-0 text-xs"><p className="font-medium truncate" style={{ color: "var(--text)" }}>{im.titulo || [im.tipo, im.bairro].filter(Boolean).join(" · ")}</p><p style={{ color: "var(--text-3)" }}>Cód. {im.codigo}{im.valor ? ` · ${im.valor}` : ""}</p></div>
              </li>
            ))}
          </ul>
        )}
      </Painel>

      <Painel titulo="Últimos eventos" acao={<button type="button" onClick={() => onAba("tempo")} className="text-xs underline" style={{ color: "var(--text-3)" }}>Linha do tempo completa</button>}>
        {tempo ? <LinhaDoTempo eventos={tempo.eventos.slice(0, 6)} resumo={{ ...tempo.resumo, total: Math.min(6, tempo.resumo.total), por_categoria: {} }} compacto /> : <p className="text-sm" style={{ color: "var(--text-3)" }}>Carregando…</p>}
      </Painel>
    </div>
  );
}
