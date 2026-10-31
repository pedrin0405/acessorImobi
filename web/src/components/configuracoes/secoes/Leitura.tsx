"use client";

import React, { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { mascaraTelefone } from "../constantes";
import { Aviso, Bloco, Cartao, Carregando, Linha, Selo, Titulo, useApi } from "../ui";

/** Seções da imobiliária que o corretor só consulta: quem muda é a gestão. */
function Aviso_gestao() {
  return (
    <p className="mb-5 inline-flex items-center gap-2 text-xs rounded-full px-3 py-1.5" style={{ background: "var(--card-2)", color: "var(--text-3)", border: "1px solid var(--line)" }}>
      <Lock className="w-3.5 h-3.5" aria-hidden /> Definido pela gestão da imobiliária; fale com ela para alterar.
    </p>
  );
}

const valor = (v: React.ReactNode) => <span className="text-sm" style={{ color: "var(--text-2)" }}>{v || "—"}</span>;

interface Dados {
  nome: string; documento: string; creci_uf: string; creci_numero: string; pais: string; telefone: string; email_contato: string;
  site: string; cidade: string; uf: string; fuso: string; horario_inicio: string; horario_fim: string; logo: string | null;
}

export function DadosLeitura({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const api = useApi(onAuthError);
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { (async () => { const r = await api<Dados>("/admin/configuracoes/imobiliaria"); if (r.ok && r.dados) setD(r.dados); else setErro(r.erro || "Não foi possível carregar."); })(); }, [api]);
  return (
    <>
      <Titulo titulo="Dados da imobiliária" descricao="Contato, endereço e horário de atendimento." />
      <Aviso_gestao />
      {!d ? (erro ? <Aviso tom="erro">{erro}</Aviso> : <Carregando />) : (
        <Cartao>
          {d.logo && <Linha rotulo="Logo"><img src={d.logo} alt="Logo da imobiliária" className="h-12 w-auto rounded" /></Linha>}
          <Linha rotulo="Nome">{valor(d.nome)}</Linha>
          <Linha rotulo="CRECI">{valor([d.creci_numero, d.creci_uf].filter(Boolean).join(" / "))}</Linha>
          <Linha rotulo="Telefone">{valor(d.telefone ? `${d.pais} ${mascaraTelefone(d.telefone)}` : "")}</Linha>
          <Linha rotulo="E-mail">{valor(d.email_contato)}</Linha>
          <Linha rotulo="Site">{valor(d.site)}</Linha>
          <Linha rotulo="Cidade">{valor([d.cidade, d.uf].filter(Boolean).join(" / "))}</Linha>
          <Linha rotulo="Atendimento">{valor(d.horario_inicio && d.horario_fim ? `${d.horario_inicio} às ${d.horario_fim}` : "")}</Linha>
        </Cartao>
      )}
    </>
  );
}

interface Tipo { chave: string; nome: string; cor: string; icone: string; visivel: boolean }

export function TiposLeitura({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const api = useApi(onAuthError);
  const [t, setT] = useState<Tipo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { (async () => { const r = await api<Tipo[]>("/admin/configuracoes/tipos-atividade"); if (r.ok && r.dados) setT(r.dados); else setErro(r.erro || "Não foi possível carregar."); })(); }, [api]);
  return (
    <>
      <Titulo titulo="Tipos de atividade" descricao="Os tipos de compromisso que você pode marcar na agenda." />
      <Aviso_gestao />
      {!t ? (erro ? <Aviso tom="erro">{erro}</Aviso> : <Carregando />) : (
        <Cartao>
          {t.filter((x) => x.visivel).map((x) => (
            <Linha key={x.chave} rotulo={x.nome}><span className="inline-flex items-center gap-2 text-sm" style={{ color: "var(--text-3)" }}><i className="w-3 h-3 rounded-full" style={{ background: x.cor }} aria-hidden />{x.cor}</span></Linha>
          ))}
        </Cartao>
      )}
    </>
  );
}

interface Cidade { id: string; nome: string; uf: string | null; arquivada: boolean; bairros: number }
interface Bairro { id: string; nome: string; arquivado: boolean }

export function LocalidadesLeitura({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const api = useApi(onAuthError);
  const [cidades, setCidades] = useState<Cidade[] | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [bairros, setBairros] = useState<Bairro[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { (async () => { const r = await api<Cidade[]>("/admin/configuracoes/localidades/cidades"); if (r.ok && r.dados) setCidades(r.dados); else setErro(r.erro || "Não foi possível carregar."); })(); }, [api]);
  const abrir = async (id: string) => {
    if (aberta === id) return setAberta(null);
    setAberta(id); setBairros(null);
    const r = await api<Bairro[]>(`/admin/configuracoes/localidades/cidades/${id}/bairros`);
    if (r.ok && r.dados) setBairros(r.dados);
  };
  return (
    <>
      <Titulo titulo="Localidades" descricao="Cidades e bairros em que a imobiliária atua." />
      <Aviso_gestao />
      {!cidades ? (erro ? <Aviso tom="erro">{erro}</Aviso> : <Carregando />) : cidades.length === 0 ? <Aviso tom="info">Nenhuma cidade cadastrada ainda.</Aviso> : (
        <Cartao>
          {cidades.map((c) => (
            <div key={c.id}>
              <button type="button" onClick={() => abrir(c.id)} aria-expanded={aberta === c.id} className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-[var(--hover-solid)]">
                <span className="text-sm" style={{ color: "var(--text)" }}>{c.nome}{c.uf ? ` / ${c.uf}` : ""}</span>
                <span className="text-xs" style={{ color: "var(--text-3)" }}>{c.bairros} {c.bairros === 1 ? "bairro" : "bairros"}</span>
              </button>
              {aberta === c.id && (
                <div className="px-5 pb-4 flex flex-wrap gap-1.5">
                  {!bairros ? <span className="text-xs" style={{ color: "var(--text-3)" }}>Carregando…</span> : bairros.filter((b) => !b.arquivado).map((b) => <Selo key={b.id}>{b.nome}</Selo>)}
                </div>
              )}
            </div>
          ))}
        </Cartao>
      )}
    </>
  );
}

interface Regra { id: string; ligada: boolean; nome: string; antecedencia_min: number; janela_inicio: string; janela_fim: string }

export function LembretesLeitura({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const api = useApi(onAuthError);
  const [r, setR] = useState<Regra[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { (async () => { const x = await api<Regra[]>("/admin/configuracoes/lembretes"); if (x.ok && x.dados) setR(x.dados); else setErro(x.erro || "Não foi possível carregar."); })(); }, [api]);
  return (
    <>
      <Titulo titulo="Lembretes da agenda" descricao="Quando o Acessor te avisa dos compromissos, pelo WhatsApp." />
      <Aviso_gestao />
      {!r ? (erro ? <Aviso tom="erro">{erro}</Aviso> : <Carregando />) : (
        <Cartao>
          {r.map((x) => (
            <Linha key={x.id} rotulo={x.nome} ajuda={`Entre ${x.janela_inicio} e ${x.janela_fim}`}><Selo tom={x.ligada ? "ok" : "neutro"}>{x.ligada ? "Ligada" : "Desligada"}</Selo></Linha>
          ))}
        </Cartao>
      )}
    </>
  );
}
