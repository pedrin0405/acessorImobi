"use client";

import React, { useEffect, useState } from "react";
import { fetchApi } from "@/lib/api";
import { CorretorOpcao, corretoresAtivos } from "@/lib/crm";
import { Aviso, Botao, Entrada, Seletor, useApi } from "@/components/configuracoes/ui";
import Janela from "./Janela";
import { TipoAgenda } from "./util";

export interface Preenchimento { tipo?: string; data?: string; hora?: string }

export default function NovaAtividade({ inicial, tipos, onAuthError, onFechar, onCriada }: {
  inicial: Preenchimento; tipos: TipoAgenda[]; onAuthError: (e: unknown) => boolean; onFechar: () => void; onCriada: () => void;
}) {
  const api = useApi(onAuthError);
  const [corretores, setCorretores] = useState<CorretorOpcao[]>([]);
  const [f, setF] = useState({ corretor_id: "", tipo: inicial.tipo || "visita", titulo: "", data: inicial.data || "", hora: inicial.hora || "", cliente: "", local: "" });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const lista = await corretoresAtivos(fetchApi);
        setCorretores(lista);
        if (lista.length === 1) setF((x) => ({ ...x, corretor_id: lista[0].id }));
      } catch (e) { if (!onAuthError(e)) setErro("Não foi possível carregar os corretores."); }
    })();
  }, [onAuthError]);

  const enviar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setSalvando(true); setErro(null);
    const corpo = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()));
    const r = await api("/admin/crm/atividades", { method: "POST", corpo });
    setSalvando(false);
    if (!r.ok) return setErro(r.erro);
    onCriada();
  };

  return (
    <Janela titulo="Nova atividade" subtitulo="O corretor recebe lembrete no WhatsApp conforme as regras de Configurações." onFechar={onFechar}>
      <form onSubmit={enviar} className="space-y-3">
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 sm:col-span-1 text-xs space-y-1" style={{ color: "var(--text-3)" }}>Corretor *
            <Seletor required value={f.corretor_id} onChange={(e) => setF({ ...f, corretor_id: e.target.value })}><option value="">Selecione</option>{corretores.map((c) => <option key={c.id} value={c.id}>{c.nome || c.telefone_mascarado}</option>)}</Seletor></label>
          <label className="col-span-2 sm:col-span-1 text-xs space-y-1" style={{ color: "var(--text-3)" }}>Tipo
            <Seletor value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>{tipos.map((t) => <option key={t.chave} value={t.chave}>{t.nome}</option>)}</Seletor></label>
        </div>
        <label className="block text-xs space-y-1" style={{ color: "var(--text-3)" }}>Título<Entrada value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Ex.: Visita ao apê da Orla" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs space-y-1" style={{ color: "var(--text-3)" }}>Data<Entrada type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></label>
          <label className="text-xs space-y-1" style={{ color: "var(--text-3)" }}>Hora<Entrada type="time" value={f.hora} disabled={!f.data} onChange={(e) => setF({ ...f, hora: e.target.value })} /></label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs space-y-1" style={{ color: "var(--text-3)" }}>Cliente<Entrada value={f.cliente} onChange={(e) => setF({ ...f, cliente: e.target.value })} /></label>
          <label className="text-xs space-y-1" style={{ color: "var(--text-3)" }}>Local<Entrada value={f.local} onChange={(e) => setF({ ...f, local: e.target.value })} /></label>
        </div>
        <p className="text-[11px]" style={{ color: "var(--text-3)" }}>Sem data, a atividade fica em “Sem data” até ser agendada.</p>
        <div className="flex justify-end gap-2"><Botao type="button" variante="fantasma" onClick={onFechar}>Cancelar</Botao><Botao type="submit" variante="primario" disabled={!f.corretor_id} carregando={salvando}>Agendar</Botao></div>
      </form>
    </Janela>
  );
}
