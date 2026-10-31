"use client";

import React from "react";
import { Globe, Mail, MapPin, Phone } from "lucide-react";
import { brl, resumoPerfil } from "@/lib/crm";
import { Area, Botao, Selo } from "@/components/configuracoes/ui";
import type { Ficha } from "@/components/crm/FichaCliente";
import { Campos, dia, diaHora, fone, idade, ORIGENS, Painel } from "./util";

const PAPEIS: Record<string, string> = { lead: "Lead", comprador: "Comprador", locador: "Locador", locatario: "Locatário", proprietario: "Proprietário", fiador: "Fiador", sindico: "Síndico", parceiro: "Parceiro" };
const SITUACAO: Record<string, string> = { lead: "Lead", cliente: "Cliente", arquivado: "Arquivado" };
const PRAZO: Record<string, string> = { imediato: "Imediato", "3_meses": "Até 3 meses", "6_meses": "Até 6 meses", sem_pressa: "Sem pressa" };
const VERBO: Record<string, string> = { comprar: "Comprar", alugar: "Alugar", vender: "Vender" };
const CONHECIDOS = new Set(["tipo_pessoa", "sexo", "estado_civil", "data_nascimento", "naturalidade", "nacionalidade", "profissao", "cargo", "local_trabalho", "conjuge", "numero_filhos", "fantasia", "data_fundacao", "renda_mensal", "renda_familiar", "valor_entrada", "fgts", "redes", "telefones", "emails", "enderecos", "relacionamentos"]);

const rotulo = (k: string) => { const t = k.replace(/_/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
const texto = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "object") return Array.isArray(v) ? v.map(texto).filter(Boolean).join(", ") : Object.entries(v as Record<string, unknown>).map(([k, x]) => `${rotulo(k)}: ${texto(x)}`).join(" · ");
  return String(v);
};

/** Todos os campos do cliente: contato, origem, dados pessoais e financeiros, perfil, datas e observações. */
export default function CadastroLead({
  ficha, obs, onObs, onSalvarObs, salvando, compacto,
}: { ficha: Ficha; obs: string; onObs: (v: string) => void; onSalvarObs: () => void; salvando: boolean; compacto?: boolean }) {
  const d = ficha.dados_imoview || {};
  const principal = (ficha.telefone || "").replace(/\D/g, "").slice(-8);
  const telefones = [...(ficha.telefone ? [{ tipo: "Principal", numero: ficha.telefone }] : []), ...(d.telefones || []).filter((t) => (t.numero || "").replace(/\D/g, "").slice(-8) !== principal)];
  const emails = [...(ficha.email ? [{ tipo: "Principal", email: ficha.email }] : []), ...(d.emails || []).filter((e) => e.email && e.email !== ficha.email)];
  const anos = idade(d.data_nascimento);
  const p = ficha.perfil || {};
  const papeis = Object.entries(d.relacionamentos || {});
  const extras = Object.entries(d as Record<string, unknown>).filter(([k, v]) => !CONHECIDOS.has(k) && texto(v)).map(([k, v]) => [rotulo(k), texto(v)] as [string, React.ReactNode]);

  return (
    <div className={compacto ? "space-y-3" : "grid lg:grid-cols-2 gap-4 items-start"}>
      <div className="space-y-4 min-w-0">
        <Painel titulo="Contato">
          <ul className="space-y-2.5 text-sm">
            {telefones.map((t, i) => <li key={`t${i}`} className="flex items-center gap-2"><Phone className="w-4 h-4 shrink-0" style={{ color: "var(--text-3)" }} aria-hidden /><a href={`tel:${t.numero}`} style={{ color: "var(--text)" }}>{fone(t.numero)}</a>{t.tipo && <span className="text-xs" style={{ color: "var(--text-4)" }}>{t.tipo}</span>}</li>)}
            {emails.map((e, i) => <li key={`e${i}`} className="flex items-center gap-2 min-w-0"><Mail className="w-4 h-4 shrink-0" style={{ color: "var(--text-3)" }} aria-hidden /><a href={`mailto:${e.email}`} className="truncate" style={{ color: "var(--text)" }}>{e.email}</a>{e.tipo && <span className="text-xs shrink-0" style={{ color: "var(--text-4)" }}>{e.tipo}</span>}</li>)}
            {(d.enderecos || []).map((e, i) => <li key={`a${i}`} className="flex items-start gap-2"><MapPin className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--text-3)" }} aria-hidden /><span style={{ color: "var(--text)" }}>{[e.endereco, e.bairro, [e.cidade, e.estado].filter(Boolean).join("/"), e.cep].filter(Boolean).join(" · ")}{e.tipo && <span className="text-xs ml-2" style={{ color: "var(--text-4)" }}>{e.tipo}</span>}</span></li>)}
            {Object.entries(d.redes || {}).map(([rede, url]) => <li key={rede} className="flex items-center gap-2 min-w-0"><Globe className="w-4 h-4 shrink-0" style={{ color: "var(--text-3)" }} aria-hidden /><span className="text-xs capitalize shrink-0" style={{ color: "var(--text-4)" }}>{rede}</span><span className="truncate" style={{ color: "var(--text)" }}>{String(url).replace(/^\s*https?:\/\/(www\.)?/, "")}</span></li>)}
            {!telefones.length && !emails.length && !(d.enderecos || []).length && <li style={{ color: "var(--text-3)" }}>Sem contato cadastrado.</li>}
          </ul>
        </Painel>

        <Painel titulo="Origem e vínculos">
          <Campos itens={[
            ["Origem", ORIGENS[ficha.origem] ?? ficha.origem], ["Situação", SITUACAO[ficha.status] ?? ficha.status], ["Temperatura", ficha.temperatura],
            ["Código no Imoview", ficha.codigo_imoview ? `#${ficha.codigo_imoview}` : null], ["Responsável", ficha.corretor_nome],
          ]} />
          {papeis.length > 0 && <div className="flex flex-wrap gap-1.5 mt-3">{papeis.map(([k, q]) => <Selo key={k} tom={k === "lead" ? "info" : "ok"}>{PAPEIS[k] ?? k}{q > 1 ? ` · ${q}` : ""}</Selo>)}</div>}
        </Painel>

        <Painel titulo="Dados pessoais">
          <Campos itens={[
            ["Tipo de pessoa", d.tipo_pessoa], ["Sexo", d.sexo], ["Estado civil", d.estado_civil],
            ["Nascimento", d.data_nascimento ? `${d.data_nascimento}${anos !== null ? ` · ${anos} anos` : ""}` : null],
            ["Fantasia", d.fantasia], ["Fundação", d.data_fundacao], ["Profissão", d.profissao], ["Cargo", d.cargo], ["Local de trabalho", d.local_trabalho],
            ["Cônjuge", d.conjuge], ["Filhos", d.numero_filhos], ["Naturalidade", d.naturalidade], ["Nacionalidade", d.nacionalidade],
          ]} />
          {!d.tipo_pessoa && !d.sexo && !d.profissao && !d.data_nascimento && <p className="text-sm" style={{ color: "var(--text-3)" }}>O Imoview não trouxe dados pessoais.</p>}
        </Painel>

        <Painel titulo="Financeiro">
          <Campos itens={[["Renda mensal", d.renda_mensal ? brl(d.renda_mensal) : null], ["Renda familiar", d.renda_familiar ? brl(d.renda_familiar) : null], ["Valor de entrada", d.valor_entrada ? brl(d.valor_entrada) : null], ["FGTS", d.fgts ? brl(d.fgts) : null]]} />
          {!d.renda_mensal && !d.renda_familiar && !d.valor_entrada && !d.fgts && <p className="text-sm" style={{ color: "var(--text-3)" }}>Sem dados financeiros informados.</p>}
        </Painel>
      </div>

      <div className="space-y-4 min-w-0">
        <Painel titulo="Perfil de busca">
          <p className="text-sm mb-3" style={{ color: "var(--text-2)" }}>{resumoPerfil(p)}</p>
          <Campos itens={[
            ["Interesse", p.interesse?.map((i) => VERBO[i] ?? i).join(", ")], ["Tipos de imóvel", p.tipos?.join(", ")], ["Bairros", p.bairros?.join(", ")],
            ["Quartos", p.quartos_min ? `${p.quartos_min} ou mais` : null], ["Vagas", p.vagas_min ? `${p.vagas_min} ou mais` : null],
            ["Valor máximo", p.valor_max ? brl(p.valor_max) : null], ["Área mínima", p.area_min ? `${p.area_min} m²` : null], ["Prazo", p.prazo ? PRAZO[p.prazo] ?? p.prazo : null],
          ]} />
        </Painel>

        <Painel titulo="Datas">
          <Campos itens={[
            ["Entrou no portal", diaHora(ficha.created_at)], ["Cadastrado no Imoview", diaHora(ficha.imoview_incluido_em)], ["Alterado no Imoview", diaHora(ficha.imoview_alterado_em)],
            ["Importado em", diaHora(ficha.importado_em)], ["Último contato", dia(ficha.ultimo_contato)], ["Atualizado em", diaHora(ficha.updated_at)],
          ]} />
        </Painel>

        {extras.length > 0 && <Painel titulo="Outros campos do Imoview"><Campos itens={extras} /></Painel>}

        <Painel titulo="Observações">
          <Area value={obs} onChange={(e) => onObs(e.target.value)} rows={compacto ? 3 : 5} maxLength={2000} placeholder="Anotações sobre o cliente" aria-label="Observações" />
          <div className="flex justify-end mt-2"><Botao onClick={onSalvarObs} disabled={obs === (ficha.observacoes || "")} carregando={salvando}>Salvar observações</Botao></div>
        </Painel>
      </div>
    </div>
  );
}
