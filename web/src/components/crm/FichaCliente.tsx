"use client";

import AvatarDoCorretor from "@/components/corretor/AvatarDoCorretor";
import { useEhCorretor } from "@/components/portal/papel";
import React, { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, CalendarDays, Globe, Home, Mail, MapPin, Phone, X } from "lucide-react";
import { AtendimentoImoview, brl, Perfil } from "@/lib/crm";
import AtendimentosImoview from "@/components/crm/AtendimentosImoview";
import { rotuloValor } from "@/components/crm/FluxoBits";
import { Aviso, Botao, Area, Selo, Seletor, useApi } from "@/components/configuracoes/ui";

interface Endereco { tipo?: string; endereco?: string; bairro?: string; cidade?: string; estado?: string; cep?: string }
export interface DadosImoview {
  tipo_pessoa?: string; sexo?: string; estado_civil?: string; data_nascimento?: string; naturalidade?: string; nacionalidade?: string;
  profissao?: string; cargo?: string; local_trabalho?: string; conjuge?: string; numero_filhos?: string; fantasia?: string; data_fundacao?: string;
  renda_mensal?: number; renda_familiar?: number; valor_entrada?: number; fgts?: number;
  redes?: Record<string, string>;
  telefones?: { tipo?: string; numero?: string }[];
  emails?: { tipo?: string; email?: string }[];
  enderecos?: Endereco[];
  relacionamentos?: Record<string, number>;
}
export interface NegocioLead {
  id: string; etapa_nome: string; status: string; valor: number; corretor_nome: string | null; dias_na_etapa: number; automatico?: boolean; created_at: string;
  etapa_cor?: string; probabilidade?: number; esperado?: number; valor_manual?: boolean; fechamento_previsto?: string | null; motivo_perda?: string | null;
  im_valor_tipo?: "negocio" | "proposta" | "imovel" | "orcamento" | null; im_comissao?: number | null; corretor_id?: string | null; imovel_codigo?: number | null;
  im_previsao_fechamento?: string | null; im_termometro?: string | null; im_midia?: string | null;
}
export interface AtividadeLead { id: string; tipo: string; titulo: string; inicio: string | null; status: string; atrasada: boolean; corretor_nome: string | null }
export interface EventoLead { tipo: string; de: string | null; para: string | null; autor: string; created_at: string }
export interface Ficha {
  id: string; nome: string; telefone: string | null; email: string | null; origem: string; temperatura: "quente" | "morno" | "frio";
  status: string; perfil: Perfil; observacoes: string | null; corretor_id: string | null; corretor_nome: string | null;
  codigo_imoview: number | null; dados_imoview: DadosImoview; ultimo_contato: string | null; created_at: string; updated_at: string;
  importado_em: string | null; imoview_incluido_em: string | null; imoview_alterado_em: string | null;
  negocios: NegocioLead[]; atendimentos?: AtendimentoImoview[]; atividades: AtividadeLead[]; historico: EventoLead[];
}
interface ImovelMatch { codigo: number; tipo: string | null; bairro: string | null; quartos: number | null; valor: number | null; foto_url: string | null; link_anuncio: string | null }

const ORIGENS: Record<string, string> = { whatsapp: "WhatsApp", imoview: "Imoview", manual: "Manual", portal: "Portal", whatsapp_pessoal: "WhatsApp pessoal" };
const PAPEIS: Record<string, string> = { lead: "Lead", comprador: "Comprador", locador: "Locador", locatario: "Locatário", proprietario: "Proprietário", fiador: "Fiador", sindico: "Síndico", parceiro: "Parceiro" };
const TIPO_ATIV: Record<string, string> = { visita: "Visita", reuniao: "Reunião", ligacao: "Ligação", follow_up: "Follow-up", whatsapp: "WhatsApp", tarefa: "Tarefa", email: "E-mail", documento: "Documento" };
const SITUACAO: Record<string, string> = { lead: "Lead", cliente: "Cliente", arquivado: "Arquivado" };
const EVENTO: Record<string, string> = { criado: "Entrou no funil", etapa: "Mudou de etapa", ganho: "Negócio ganho", perdido: "Negócio perdido", reaberto: "Negócio reaberto" };
const PRAZO: Record<string, string> = { imediato: "Imediato", "3_meses": "Até 3 meses", "6_meses": "Até 6 meses", sem_pressa: "Sem pressa" };
const VERBO: Record<string, string> = { comprar: "Comprar", alugar: "Alugar", vender: "Vender" };
const COR_TEMP: Record<string, string> = { quente: "var(--danger)", morno: "var(--warn)", frio: "var(--info)" };

const dia = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "");
const diaHora = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const fone = (t?: string | null) => {
  const d = (t || "").replace(/\D/g, "");
  const l = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (l.length === 11) return `(${l.slice(0, 2)}) ${l.slice(2, 7)}-${l.slice(7)}`;
  if (l.length === 10) return `(${l.slice(0, 2)}) ${l.slice(2, 6)}-${l.slice(6)}`;
  return t || "";
};
const idade = (nasc?: string) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(nasc || "");
  if (!m) return null;
  const hoje = new Date(), d = new Date(+m[3], +m[2] - 1, +m[1]);
  let a = hoje.getFullYear() - d.getFullYear();
  if (hoje < new Date(hoje.getFullYear(), d.getMonth(), d.getDate())) a--;
  return a >= 0 && a < 120 ? a : null;
};
const ordinalSemPrefixo = (v: string) => v.replace(/^\s*https?:\/\/(www\.)?/, "");

function Secao({ titulo, children, vazio }: { titulo: string; children?: React.ReactNode; vazio?: string }) {
  return (
    <section className="pt-4 mt-4" style={{ borderTop: "1px solid var(--line)" }}>
      <h4 className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-4)" }}>{titulo}</h4>
      {children ?? <p className="text-sm" style={{ color: "var(--text-3)" }}>{vazio}</p>}
    </section>
  );
}

function Campos({ itens }: { itens: [string, React.ReactNode][] }) {
  const lista = itens.filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== false);
  if (!lista.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
      {lista.map(([r, v]) => (
        <div key={r} className="min-w-0"><dt className="text-xs" style={{ color: "var(--text-3)" }}>{r}</dt><dd className="break-words" style={{ color: "var(--text)" }}>{v}</dd></div>
      ))}
    </dl>
  );
}

export default function FichaCliente({
  clienteId, corretores, onFechar, onAtribuir, onMudou, onAuthError, atribuindo, onMaisDetalhes,
}: {
  clienteId: string;
  corretores: { id: string; nome: string }[];
  onFechar: () => void;
  onAtribuir: (id: string, corretorId: string) => void;
  onMudou: () => void;
  onAuthError: (e: unknown) => boolean;
  atribuindo: boolean;
  onMaisDetalhes?: (id: string) => void;
}) {
  const ehCorretor = useEhCorretor();  // atribuir cliente é da gestão
  const api = useApi(onAuthError);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [imoveis, setImoveis] = useState<ImovelMatch[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [destino, setDestino] = useState("");
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const r = await api<Ficha>(`/admin/crm/clientes/${clienteId}`);
    if (r.ok && r.dados) { setFicha(r.dados); setObs(r.dados.observacoes || ""); setErro(null); } else setErro(r.erro);
  }, [api, clienteId]);

  useEffect(() => {
    setFicha(null); setImoveis(null); setDestino("");
    carregar();
    (async () => {
      const r = await api<ImovelMatch[]>(`/admin/crm/leads/${clienteId}/match`);
      setImoveis(r.ok && r.dados ? r.dados : []);
    })();
  }, [clienteId, carregar, api]);

  // quando o pai atribui, recarrega a ficha
  useEffect(() => { if (!atribuindo) carregar(); }, [atribuindo, carregar]);

  const ajustar = async (corpo: Record<string, string>) => {
    setSalvando(true);
    const r = await api<Ficha>(`/admin/crm/clientes/${clienteId}`, { method: "PATCH", corpo });
    setSalvando(false);
    if (!r.ok || !r.dados) return setErro(r.erro);
    setFicha(r.dados); setObs(r.dados.observacoes || ""); setErro(null);
    onMudou();
  };

  if (!ficha) {
    return (
      <div className="space-y-3" aria-busy>
        {erro ? <Aviso tom="erro">{erro}</Aviso> : [0, 1, 2, 3].map((i) => <div key={i} className="h-10 rounded-xl animate-pulse" style={{ background: "var(--card-2)" }} />)}
      </div>
    );
  }

  const d = ficha.dados_imoview || {};
  const telefones = [...(ficha.telefone ? [{ tipo: "Principal", numero: ficha.telefone }] : []), ...(d.telefones || []).filter((t) => (t.numero || "").replace(/\D/g, "").slice(-8) !== (ficha.telefone || "").replace(/\D/g, "").slice(-8))];
  const emails = [...(ficha.email ? [{ tipo: "Principal", email: ficha.email }] : []), ...(d.emails || []).filter((e) => e.email && e.email !== ficha.email)];
  const anos = idade(d.data_nascimento);
  const p = ficha.perfil || {};
  const perfilLinhas: [string, React.ReactNode][] = [
    ["Interesse", p.interesse?.map((i) => VERBO[i] ?? i).join(", ")],
    ["Tipos de imóvel", p.tipos?.join(", ")],
    ["Bairros", p.bairros?.join(", ")],
    ["Quartos", p.quartos_min ? `${p.quartos_min} ou mais` : null],
    ["Vagas", p.vagas_min ? `${p.vagas_min} ou mais` : null],
    ["Valor máximo", p.valor_max ? brl(p.valor_max) : null],
    ["Área mínima", p.area_min ? `${p.area_min} m²` : null],
    ["Prazo", p.prazo ? PRAZO[p.prazo] ?? p.prazo : null],
  ];
  const temPerfil = perfilLinhas.some(([, v]) => v);
  const pessoal: [string, React.ReactNode][] = [
    ["Tipo de pessoa", d.tipo_pessoa], ["Sexo", d.sexo], ["Estado civil", d.estado_civil],
    ["Nascimento", d.data_nascimento ? `${d.data_nascimento}${anos !== null ? ` · ${anos} anos` : ""}` : null],
    ["Fantasia", d.fantasia], ["Fundação", d.data_fundacao],
    ["Profissão", d.profissao], ["Cargo", d.cargo], ["Local de trabalho", d.local_trabalho],
    ["Cônjuge", d.conjuge], ["Filhos", d.numero_filhos], ["Naturalidade", d.naturalidade], ["Nacionalidade", d.nacionalidade],
  ];
  const financeiro: [string, React.ReactNode][] = [
    ["Renda mensal", d.renda_mensal ? brl(d.renda_mensal) : null], ["Renda familiar", d.renda_familiar ? brl(d.renda_familiar) : null],
    ["Valor de entrada", d.valor_entrada ? brl(d.valor_entrada) : null], ["FGTS", d.fgts ? brl(d.fgts) : null],
  ];
  const papeis = Object.entries(d.relacionamentos || {});

  return (
    <div>
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold break-words" style={{ color: "var(--text)" }}>{ficha.nome}</h3>
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs" style={{ color: "var(--text-3)" }}>
            <Selo tom={ficha.origem === "imoview" ? "info" : "neutro"}>{ORIGENS[ficha.origem] ?? ficha.origem}</Selo>
            <Selo>{SITUACAO[ficha.status] ?? ficha.status}</Selo>
            {ficha.codigo_imoview && <span>Imoview #{ficha.codigo_imoview}</span>}
          </p>
        </div>
        <button type="button" onClick={onFechar} aria-label="Fechar" className="p-1 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}><X className="w-4 h-4" /></button>
      </div>
      {onMaisDetalhes && (
        <div className="mt-4"><Botao variante="primario" className="w-full" onClick={() => onMaisDetalhes(ficha.id)}><ArrowUpRight className="w-4 h-4" aria-hidden />Mais detalhes</Botao></div>
      )}
      {erro && <div className="mt-3"><Aviso tom="erro">{erro}</Aviso></div>}

      {!ehCorretor && (
      <Secao titulo="Responsável">
        <p className="text-sm mb-2" style={{ color: "var(--text-3)" }}>{ficha.corretor_nome ? <span className="inline-flex items-center gap-2"><AvatarDoCorretor id={ficha.corretor_id} nome={ficha.corretor_nome} tamanho={28} />Com <strong style={{ color: "var(--text)" }}>{ficha.corretor_nome}</strong></span> : "Ninguém ainda: o cliente está no funil, na etapa Lead, aguardando um corretor."}</p>
        <div className="flex gap-2">
          <Seletor aria-label="Atribuir este cliente a" value={destino} onChange={(e) => setDestino(e.target.value)}><option value="">{ficha.corretor_nome ? "Passar para…" : "Atribuir a…"}</option>{corretores.filter((c) => c.id !== ficha.corretor_id).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Seletor>
          <Botao variante="primario" onClick={() => { onAtribuir(ficha.id, destino); setDestino(""); }} disabled={!destino} carregando={atribuindo}>Atribuir</Botao>
        </div>
      </Secao>
      )}

      <Secao titulo="Contato">
        <ul className="space-y-2 text-sm">
          {telefones.map((t, i) => <li key={`t${i}`} className="flex items-center gap-2"><Phone className="w-4 h-4 shrink-0" style={{ color: "var(--text-3)" }} aria-hidden /><a href={`tel:${t.numero}`} style={{ color: "var(--text)" }}>{fone(t.numero)}</a>{t.tipo && <span className="text-xs" style={{ color: "var(--text-4)" }}>{t.tipo}</span>}</li>)}
          {emails.map((e, i) => <li key={`e${i}`} className="flex items-center gap-2 min-w-0"><Mail className="w-4 h-4 shrink-0" style={{ color: "var(--text-3)" }} aria-hidden /><a href={`mailto:${e.email}`} className="truncate" style={{ color: "var(--text)" }}>{e.email}</a>{e.tipo && <span className="text-xs shrink-0" style={{ color: "var(--text-4)" }}>{e.tipo}</span>}</li>)}
          {(d.enderecos || []).map((e, i) => (
            <li key={`a${i}`} className="flex items-start gap-2"><MapPin className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--text-3)" }} aria-hidden /><span style={{ color: "var(--text)" }}>{[e.endereco, e.bairro, [e.cidade, e.estado].filter(Boolean).join("/"), e.cep].filter(Boolean).join(" · ")}{e.tipo && <span className="text-xs ml-2" style={{ color: "var(--text-4)" }}>{e.tipo}</span>}</span></li>
          ))}
          {Object.entries(d.redes || {}).map(([rede, url]) => <li key={rede} className="flex items-center gap-2 min-w-0"><Globe className="w-4 h-4 shrink-0" style={{ color: "var(--text-3)" }} aria-hidden /><span className="text-xs capitalize shrink-0" style={{ color: "var(--text-4)" }}>{rede}</span><span className="truncate" style={{ color: "var(--text)" }}>{ordinalSemPrefixo(url)}</span></li>)}
          {!telefones.length && !emails.length && !(d.enderecos || []).length && <li style={{ color: "var(--text-3)" }}>Sem contato cadastrado.</li>}
        </ul>
      </Secao>

      <Secao titulo="Situação comercial">
        <div className="flex items-center gap-3 mb-3 text-sm">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COR_TEMP[ficha.temperatura] }} aria-hidden />
          <Seletor aria-label="Temperatura" value={ficha.temperatura} disabled={salvando} onChange={(e) => ajustar({ temperatura: e.target.value })} className="!w-auto"><option value="quente">Quente</option><option value="morno">Morno</option><option value="frio">Frio</option></Seletor>
          <Seletor aria-label="Situação" value={ficha.status} disabled={salvando} onChange={(e) => ajustar({ status: e.target.value })} className="!w-auto"><option value="lead">Lead</option><option value="cliente">Cliente</option><option value="arquivado">Arquivado</option></Seletor>
        </div>
        {papeis.length > 0 && <div className="flex flex-wrap gap-1.5">{papeis.map(([k, q]) => <Selo key={k} tom={k === "lead" ? "info" : "ok"}>{PAPEIS[k] ?? k}{q > 1 ? ` · ${q}` : ""}</Selo>)}</div>}
      </Secao>

      {(ficha.atendimentos?.length ?? 0) > 0 && (
        <Secao titulo={`Atendimento no Imoview (${ficha.atendimentos!.length})`}>
          <AtendimentosImoview atendimentos={ficha.atendimentos!} />
        </Secao>
      )}

      <Secao titulo="Perfil de busca" vazio="Ainda sem perfil de busca; o agente preenche conforme as conversas.">
        {temPerfil ? <Campos itens={perfilLinhas} /> : undefined}
      </Secao>

      {(pessoal.some(([, v]) => v) || financeiro.some(([, v]) => v)) && (
        <Secao titulo="Dados do cadastro (Imoview)">
          <div className="space-y-4"><Campos itens={pessoal} /><Campos itens={financeiro} /></div>
        </Secao>
      )}

      <Secao titulo={`Fluxo (${ficha.negocios.length})`} vazio="Nenhum atendimento no fluxo ainda.">
        {ficha.negocios.length > 0 ? (
          <ul className="space-y-2">
            {ficha.negocios.map((n) => (
              <li key={n.id} className="flex items-center justify-between gap-3 text-sm rounded-xl px-3 py-2" style={{ background: "var(--card-2)" }}>
                <span className="min-w-0"><span style={{ color: "var(--text)" }}>{n.etapa_nome}</span><span className="block text-xs" style={{ color: "var(--text-3)" }}>{n.status === "aberto" ? `${n.dias_na_etapa}d na etapa` : n.status === "ganho" ? "Ganho" : "Perdido"}{n.corretor_nome ? ` · ${n.corretor_nome}` : ""}</span></span>
                <span className="text-right shrink-0 leading-tight"><span className="block tabular-nums" style={{ color: "var(--text-2)" }}>{n.valor > 0 ? brl(n.valor) : "—"}</span>{n.valor > 0 && rotuloValor(n) && <span className="block text-[10px]" style={{ color: "var(--text-4)" }}>{rotuloValor(n)}</span>}{n.im_comissao ? <span className="block text-[10px] tabular-nums" style={{ color: "var(--accent-text)" }}>comissão {brl(n.im_comissao)}</span> : null}</span>
              </li>
            ))}
          </ul>
        ) : undefined}
      </Secao>

      <Secao titulo={`Atividades (${ficha.atividades.length})`} vazio="Nenhuma atividade agendada com este cliente.">
        {ficha.atividades.length > 0 ? (
          <ul className="space-y-2">
            {ficha.atividades.slice(0, 8).map((a) => (
              <li key={a.id} className="flex items-start gap-2 text-sm"><CalendarDays className="w-4 h-4 mt-0.5 shrink-0" style={{ color: a.atrasada ? "var(--warn)" : "var(--text-3)" }} aria-hidden /><span className="min-w-0"><span style={{ color: "var(--text)", textDecoration: a.status === "aberta" ? undefined : "line-through" }}>{a.titulo}</span><span className="block text-xs" style={{ color: "var(--text-3)" }}>{TIPO_ATIV[a.tipo] ?? a.tipo} · {a.inicio ? diaHora(a.inicio) : "sem data"}{a.atrasada ? " · atrasada" : ""}{a.corretor_nome ? ` · ${a.corretor_nome}` : ""}</span></span></li>
            ))}
          </ul>
        ) : undefined}
      </Secao>

      <Secao titulo="Observações">
        <Area value={obs} onChange={(e) => setObs(e.target.value)} rows={3} maxLength={2000} placeholder="Anotações sobre o cliente" aria-label="Observações" />
        <div className="flex justify-end mt-2"><Botao onClick={() => ajustar({ observacoes: obs })} disabled={obs === (ficha.observacoes || "")} carregando={salvando}>Salvar observações</Botao></div>
      </Secao>

      <Secao titulo="Combina com" vazio="">
        {imoveis === null ? <p className="text-sm" style={{ color: "var(--text-3)" }}>Cruzando com a carteira…</p>
          : imoveis.length === 0 ? <p className="text-sm" style={{ color: "var(--text-3)" }}>{temPerfil ? "Nada na carteira atende a esse perfil hoje." : "Sem perfil de busca para cruzar com a carteira."}</p>
          : (
            <ul className="space-y-3">
              {imoveis.map((im) => (
                <li key={im.codigo} className="flex gap-3">
                  {im.foto_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={im.foto_url} alt="" className="w-16 h-12 rounded-md object-cover" style={{ background: "var(--card-2)" }} />
                  ) : (<div className="w-16 h-12 rounded-md flex items-center justify-center" style={{ background: "var(--card-2)" }}><Home className="w-4 h-4" style={{ color: "var(--text-4)" }} aria-hidden /></div>)}
                  <div className="min-w-0 text-xs">
                    <p className="font-medium truncate" style={{ color: "var(--text)" }}>{im.tipo} · {im.bairro}</p>
                    <p style={{ color: "var(--text-3)" }}>{im.quartos ? `${im.quartos} quartos · ` : ""}{Number(im.valor) > 0 ? brl(Number(im.valor)) : "valor sob consulta"}</p>
                    {im.link_anuncio ? <a href={im.link_anuncio} target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--text-2)" }}>Código {im.codigo}</a> : <span style={{ color: "var(--text-3)" }}>Código {im.codigo}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </Secao>

      {ficha.historico.length > 0 && (
        <Secao titulo="Histórico no funil">
          <ol className="space-y-2 text-sm">
            {ficha.historico.slice(0, 10).map((e, i) => (
              <li key={i} className="flex justify-between gap-3"><span style={{ color: "var(--text-2)" }}>{EVENTO[e.tipo] ?? e.tipo}{e.para && e.tipo !== "perdido" ? ` · ${e.de ? `${e.de} → ` : ""}${e.para}` : ""}{e.tipo === "perdido" && e.para ? ` · ${e.para}` : ""}</span><span className="text-xs shrink-0" style={{ color: "var(--text-4)" }}>{dia(e.created_at)}</span></li>
            ))}
          </ol>
        </Secao>
      )}

      <Secao titulo="Datas">
        <Campos itens={[
          ["Entrou no portal", dia(ficha.created_at)],
          ["Cadastrado no Imoview", dia(ficha.imoview_incluido_em)],
          ["Alterado no Imoview", dia(ficha.imoview_alterado_em)],
          ["Importado em", dia(ficha.importado_em)],
          ["Último contato", dia(ficha.ultimo_contato)],
          ["Atualizado em", dia(ficha.updated_at)],
        ]} />
      </Secao>
    </div>
  );
}
