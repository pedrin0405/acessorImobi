"use client";

import React, { useEffect, useRef, useState } from "react";
import { BellRing, Pencil, Plus, Trash2 } from "lucide-react";
import ImoviewCard from "../integracoes/ImoviewCard";
import { Aviso, Botao, Bloco, Cartao, Carregando, Entrada, Interruptor, Selo, Seletor, Titulo, Vazio, Area, useApi } from "../ui";
import { ICONES_ATIVIDADE } from "./Personalizacao";

interface Regra { id: string; ligada: boolean; nome: string; tipo: string; antecedencia_min: number; mensagem: string; janela_inicio: string; janela_fim: string }
interface Tipo { chave: string; nome: string; cor: string; icone: string }

const VARIAVEIS = ["corretor.primeiro_nome", "cliente", "titulo", "tipo", "tipo_minusculo", "data", "hora", "local"];
const AMOSTRA: Record<string, string> = { "corretor.primeiro_nome": "Pedro", cliente: "Ana", titulo: "Visita com Ana", tipo: "Visita", tipo_minusculo: "visita", data: "31/10", hora: "10:00", local: "Orla 14", local_frase: ", em Orla 14" };

export const rotuloAntecedencia = (min: number) => {
  if (min % 1440 === 0) { const d = min / 1440; return d === 1 ? "1 dia antes" : `${d} dias antes`; }
  if (min % 60 === 0) { const h = min / 60; return h === 1 ? "1 hora antes" : `${h} horas antes`; }
  return `${min} minutos antes`;
};

const previa = (m: string) => m.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, v: string) => AMOSTRA[v.trim()] ?? "").replace(/\s+([,.!?])/g, "$1");

export function LembretesSecao({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const api = useApi(onAuthError);
  const [regras, setRegras] = useState<Regra[] | null>(null);
  const [tipos, setTipos] = useState<Tipo[]>([]);
  const [edit, setEdit] = useState<Regra | null>(null);
  const [unidade, setUnidade] = useState<1 | 60 | 1440>(60);
  const [qtd, setQtd] = useState(1);
  const [erro, setErro] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    (async () => {
      const [r, t] = await Promise.all([api<Regra[]>("/admin/configuracoes/lembretes"), api<Tipo[]>("/admin/configuracoes/tipos-atividade")]);
      if (r.ok && r.dados) setRegras(r.dados); else setErro(r.erro);
      if (t.dados) setTipos(t.dados);
    })();
  }, [api]);

  const gravar = async (proximas: Regra[]): Promise<boolean> => {
    const r = await api<Regra[]>("/admin/configuracoes/lembretes", { method: "PUT", corpo: { itens: proximas } });
    if (!r.ok || !r.dados) { setErro(r.erro); return false; }
    setErro(null); setRegras(r.dados);
    return true;
  };

  const abrir = (r: Regra | null) => {
    const base = r || { id: "", ligada: true, nome: "", tipo: "visita", antecedencia_min: 1440, mensagem: "Oi, {{corretor.primeiro_nome}}! Lembrete: {{tipo_minusculo}} \"{{titulo}}\" em {{data}} às {{hora}}{{local_frase}}.", janela_inicio: "08:00", janela_fim: "20:00" };
    const m = base.antecedencia_min;
    const u = m % 1440 === 0 ? 1440 : m % 60 === 0 ? 60 : 1;
    setUnidade(u); setQtd(m / u); setEdit(base);
  };

  const inserir = (v: string) => {
    if (!edit) return;
    const el = area.current;
    const ini = el?.selectionStart ?? edit.mensagem.length, fim = el?.selectionEnd ?? edit.mensagem.length;
    const ins = v === "local" ? "{{local_frase}}" : `{{${v}}}`;
    setEdit({ ...edit, mensagem: edit.mensagem.slice(0, ini) + ins + edit.mensagem.slice(fim) });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(ini + ins.length, ini + ins.length); });
  };

  if (!regras) return <><Titulo titulo="Lembretes da agenda" />{erro ? <Aviso tom="erro">{erro}</Aviso> : <Carregando />}</>;
  const ligadas = regras.filter((r) => r.ligada).length;
  const tipoDe = (c: string) => tipos.find((t) => t.chave === c);

  const salvarRegra = async () => {
    if (!edit) return;
    const pronta = { ...edit, antecedencia_min: Math.round(qtd * unidade) };
    const existe = regras.some((r) => r.id === pronta.id && pronta.id);
    if (await gravar(existe ? regras.map((r) => (r.id === pronta.id ? pronta : r)) : [...regras, pronta])) setEdit(null);
  };

  return (
    <>
      <Titulo titulo="Lembretes da agenda" descricao="Avisos que o Acessor manda ao corretor, pelo WhatsApp, antes de cada compromisso. Cada regra escolhe o tipo, a antecedência, o texto e o horário de envio."
        acao={<Botao variante="primario" onClick={() => abrir(null)}><Plus className="w-4 h-4" aria-hidden /> Nova regra</Botao>} />
      {erro && <div className="mb-4"><Aviso tom="erro">{erro}</Aviso></div>}

      {edit && (
        <div className="assist-fade mb-5 rounded-2xl p-5 space-y-4" style={{ background: "var(--card)", border: "1px solid var(--accent)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{edit.id ? "Editar regra" : "Nova regra"}</p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div><label htmlFor="r-nome" className="text-xs" style={{ color: "var(--text-3)" }}>Nome</label><Entrada id="r-nome" value={edit.nome} maxLength={80} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} placeholder="Ex.: Visita — 1 dia antes" /></div>
            <div><label htmlFor="r-tipo" className="text-xs" style={{ color: "var(--text-3)" }}>Vale para</label><Seletor id="r-tipo" value={edit.tipo} onChange={(e) => setEdit({ ...edit, tipo: e.target.value })}><option value="todos">Qualquer atividade</option>{tipos.map((t) => <option key={t.chave} value={t.chave}>{t.nome}</option>)}</Seletor></div>
            <div><span className="text-xs" style={{ color: "var(--text-3)" }}>Antecedência</span><div className="flex gap-2 mt-0.5"><Entrada type="number" min={1} max={999} aria-label="Quantidade" value={qtd} onChange={(e) => setQtd(Math.max(1, Number(e.target.value) || 1))} className="!w-24" /><Seletor aria-label="Unidade" value={unidade} onChange={(e) => setUnidade(Number(e.target.value) as 1 | 60 | 1440)}><option value={1}>minutos antes</option><option value={60}>horas antes</option><option value={1440}>dias antes</option></Seletor></div></div>
            <div><span className="text-xs" style={{ color: "var(--text-3)" }}>Janela de envio</span><div className="flex items-center gap-2 mt-0.5"><Entrada type="time" aria-label="Início da janela" value={edit.janela_inicio} onChange={(e) => setEdit({ ...edit, janela_inicio: e.target.value })} /><span className="text-sm" style={{ color: "var(--text-3)" }}>até</span><Entrada type="time" aria-label="Fim da janela" value={edit.janela_fim} onChange={(e) => setEdit({ ...edit, janela_fim: e.target.value })} /></div></div>
          </div>
          <div>
            <label htmlFor="r-msg" className="text-xs" style={{ color: "var(--text-3)" }}>Mensagem</label>
            <Area id="r-msg" ref={area} rows={3} value={edit.mensagem} maxLength={600} onChange={(e) => setEdit({ ...edit, mensagem: e.target.value })} />
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Variáveis">
              {VARIAVEIS.map((v) => <button key={v} type="button" onClick={() => inserir(v)} className="px-2 py-1 rounded-md text-[11px] font-mono hover:bg-[var(--hover-solid)]" style={{ background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--text-2)" }}>{`{{${v}}}`}</button>)}
            </div>
            <div className="mt-3 rounded-xl px-4 py-3" style={{ background: "var(--card-2)", border: "1px solid var(--line)" }}><p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-4)" }}>Como o corretor recebe</p><p className="mt-1 text-sm whitespace-pre-wrap" style={{ color: "var(--text-2)" }}>{previa(edit.mensagem) || "—"}</p></div>
          </div>
          <div className="flex justify-end gap-2"><Botao variante="fantasma" onClick={() => setEdit(null)}>Cancelar</Botao><Botao variante="primario" onClick={salvarRegra} disabled={!edit.nome.trim() || !edit.mensagem.trim()}>Salvar regra</Botao></div>
        </div>
      )}

      {regras.length === 0 ? (
        <div className="rounded-2xl" style={{ border: "1px dashed var(--line-2)" }}><Vazio icone={<BellRing className="w-6 h-6" aria-hidden />} titulo="Nenhuma regra" texto="Crie uma regra para o Acessor avisar o corretor antes dos compromissos."><Botao variante="primario" onClick={() => abrir(null)}>Criar a primeira regra</Botao></Vazio></div>
      ) : (
        <ul className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
          {regras.map((r, i) => {
            const t = tipoDe(r.tipo);
            const Icone = t ? ICONES_ATIVIDADE[t.icone] : null;
            return (
              <li key={r.id} className="flex flex-wrap items-start gap-4 px-5 py-4" style={{ borderTop: i ? "1px solid var(--line)" : undefined, opacity: r.ligada ? 1 : 0.7 }}>
                <Interruptor ligado={r.ligada} onChange={(v) => gravar(regras.map((x) => (x.id === r.id ? { ...x, ligada: v } : x)))} rotulo={`Regra ${r.nome}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium" style={{ color: "var(--text)" }}>{r.nome}</p>
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium" style={{ background: t ? `color-mix(in srgb, ${t.cor} 16%, transparent)` : "var(--card-2)", color: t ? t.cor : "var(--text-3)" }}>{Icone && <Icone className="w-3 h-3" />}{r.tipo === "todos" ? "Qualquer atividade" : t?.nome || r.tipo}</span>
                    <Selo>{rotuloAntecedencia(r.antecedencia_min)}</Selo></div>
                  <p className="mt-1 text-[13px] line-clamp-2" style={{ color: "var(--text-3)" }}>{previa(r.mensagem)}</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-4)" }}>Envia entre {r.janela_inicio} e {r.janela_fim}</p>
                </div>
                <div className="flex items-center gap-1"><Botao variante="fantasma" onClick={() => abrir(r)}><Pencil className="w-4 h-4" aria-hidden /> Editar</Botao><button type="button" aria-label={`Excluir ${r.nome}`} onClick={() => { if (confirm(`Excluir a regra "${r.nome}"?`)) gravar(regras.filter((x) => x.id !== r.id)); }} className="p-2 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--danger)" }}><Trash2 className="w-4 h-4" /></button></div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[13px]" style={{ color: "var(--text-3)" }}>{ligadas === 0 ? "Nenhuma regra ligada — nada é enviado automaticamente." : `${ligadas} ${ligadas === 1 ? "regra ligada" : "regras ligadas"}. Cada atividade recebe um lembrete: o da maior antecedência que ainda cabe antes do compromisso.`}</p>
    </>
  );
}

/* ---------- Integrações ---------- */

function ItemIntegracao({ nome, descricao, rotulo }: { nome: string; descricao: string; rotulo?: string }) {
  return (
    <div className="flex items-center gap-4 px-5 py-4" style={{ opacity: 0.7 }}>
      <div className="min-w-0 flex-1"><p className="text-sm font-medium" style={{ color: "var(--text)" }}>{nome}</p><p className="text-[13px]" style={{ color: "var(--text-3)" }}>{descricao}</p></div>
      <Selo>{rotulo || "EM BREVE"}</Selo>
    </div>
  );
}

export function IntegracoesSecao({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  return (
    <>
      <Titulo titulo="Integrações" descricao="Conecte o Acessor às ferramentas que a imobiliária já usa." />
      <Bloco titulo="Imóveis"><ImoviewCard onAuthError={onAuthError} /></Bloco>
      <Bloco titulo="Agenda"><Cartao><ItemIntegracao nome="Google Calendar" descricao="Sincronize as visitas e reuniões do Acessor com a agenda do Google." rotulo="Não conectado · EM BREVE" /></Cartao></Bloco>
      <Bloco titulo="Anúncios"><Cartao><ItemIntegracao nome="Meta Ads" descricao="Traga os leads dos anúncios do Facebook e do Instagram." /></Cartao></Bloco>
      <Bloco titulo="Publicação e documentos"><Cartao><ItemIntegracao nome="Portais imobiliários" descricao="Publique e atualize anúncios nos portais a partir do Acessor." /><ItemIntegracao nome="Assinatura eletrônica" descricao="Envie contratos para assinatura sem sair do negócio." /></Cartao></Bloco>
      <Bloco titulo="Outras ferramentas"><Cartao><ItemIntegracao nome="Asaas (cobranças)" descricao="Gere cobranças e acompanhe pagamentos dos negócios." /></Cartao></Bloco>
    </>
  );
}
