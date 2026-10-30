"use client";

import React, { useEffect, useRef, useState } from "react";
import { Pause, Play, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { fetchApi } from "@/lib/api";

interface Tom {
  id: string;
  rotulo: string;
  exemplo: string;
}

interface Voz {
  id: string;
  rotulo: string;
  descricao: string;
}

interface Config {
  persona: string;
  vocabulario_bairros: string[];
  vocabulario_tipos: string[];
  tom: string | null;
  especialidades: string[];
  publico_alvo: string;
  palavras_proibidas: string[];
  nota_marca: string;
  memorias: string[];
  confirmar_acoes: boolean;
  voz: string;
}

const MAX_NOTA = 1000;
const MAX_MEMORIA = 800;

function Etiquetas({
  rotulo,
  ajuda,
  valores,
  onChange,
  placeholder,
}: {
  rotulo: string;
  ajuda: string;
  valores: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [novo, setNovo] = useState("");
  const adicionar = () => {
    const v = novo.trim();
    if (v && !valores.includes(v)) onChange([...valores, v]);
    setNovo("");
  };
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{rotulo}</label>
      <div className="flex flex-wrap gap-1.5 p-2 border border-slate-300 rounded-lg focus-within:border-slate-900">
        {valores.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-700 rounded-full pl-2.5 pr-1 py-0.5">
            {v}
            <button type="button" aria-label={`Remover ${v}`} onClick={() => onChange(valores.filter((x) => x !== v))} className="p-0.5 hover:text-rose-600">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              adicionar();
            }
          }}
          onBlur={adicionar}
          placeholder={valores.length ? "" : placeholder}
          aria-label={rotulo}
          className="flex-1 min-w-[140px] text-sm outline-none px-1"
        />
      </div>
      <p className="text-[11px] text-slate-400 mt-1">{ajuda}</p>
    </div>
  );
}

export default function AgenteConfig({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [tons, setTons] = useState<Tom[]>([]);
  const [vozes, setVozes] = useState<Voz[]>([]);
  const [tocando, setTocando] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const [novaMemoria, setNovaMemoria] = useState("");
  const [avancado, setAvancado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [salvoEm, setSalvoEm] = useState<Date | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = async () => {
    setErro(null);
    try {
      const [rC, rT, rV] = await Promise.all([
        fetchApi("/admin/agente/configuracao"),
        fetchApi("/admin/agente/tons"),
        fetchApi("/admin/agente/vozes"),
      ]);
      if (!rC.ok || !rT.ok || !rV.ok) throw new Error("falha");
      setConfig(await rC.json());
      setTons(await rT.json());
      setVozes(await rV.json());
    } catch (e) {
      if (!onAuthError(e)) setErro("Não foi possível carregar a configuração atual do agente.");
    }
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ouvir = (id: string) => {
    player.current?.pause();
    if (tocando === id) {
      setTocando(null);
      return;
    }
    const audio = new Audio(`/vozes/${id}.wav`);
    audio.onended = () => setTocando(null);
    audio.onerror = () => setTocando(null);
    player.current = audio;
    setTocando(id);
    audio.play().catch(() => setTocando(null));
  };

  useEffect(() => () => player.current?.pause(), []);

  const set = <K extends keyof Config>(campo: K, valor: Config[K]) =>
    setConfig((c) => (c ? { ...c, [campo]: valor } : c));

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetchApi("/admin/agente/configuracao", { method: "PUT", body: JSON.stringify(config) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const detalhe = Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail;
        setErro(detalhe || "Não foi possível salvar a configuração.");
        return;
      }
      await carregar();
      setSalvoEm(new Date());
    } catch (e) {
      if (!onAuthError(e)) setErro("Falha ao salvar. Verifique a conexão e tente novamente.");
    } finally {
      setSalvando(false);
    }
  };

  if (!config) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        {erro ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <span>{erro}</span>
            <button type="button" onClick={carregar} className="font-medium underline">
              Tentar novamente
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Carregando configuração atual...</p>
        )}
      </div>
    );
  }

  const tomAtual = tons.find((t) => t.id === config.tom);

  return (
    <form onSubmit={salvar} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-8">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Configuração do Agente</h2>
        <p className="text-sm text-slate-500 mt-1">Como o agente fala, o que ele sabe da imobiliária e o que pode fazer sozinho.</p>
      </div>

      {erro && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</div>}

      {/* Tom */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Tom de voz</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2" role="radiogroup" aria-label="Tom de voz">
          {tons.map((t) => (
            <button
              type="button"
              key={t.id}
              role="radio"
              aria-checked={config.tom === t.id}
              onClick={() => set("tom", config.tom === t.id ? null : t.id)}
              className={`text-left text-sm px-3 py-2.5 rounded-xl border transition-colors ${
                config.tom === t.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 hover:border-slate-400 text-slate-700"
              }`}
            >
              {t.rotulo}
            </button>
          ))}
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
          <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Como o agente soaria</p>
          <p className="text-sm text-slate-700">
            {tomAtual ? `“${tomAtual.exemplo}”` : "Escolha um tom para ver um exemplo. Sem tom, vale só a persona."}
          </p>
        </div>
      </section>

      {/* Voz do áudio */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Voz das respostas em áudio</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2" role="radiogroup" aria-label="Voz das respostas em áudio">
          {vozes.map((v) => {
            const ativa = config.voz === v.id;
            return (
              <div
                key={v.id}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                  ativa ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-700"
                }`}
              >
                <button
                  type="button"
                  aria-label={tocando === v.id ? `Pausar amostra de ${v.rotulo}` : `Ouvir amostra de ${v.rotulo}`}
                  onClick={() => ouvir(v.id)}
                  className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    ativa ? "bg-white/15 hover:bg-white/25" : "bg-slate-100 hover:bg-slate-200"
                  }`}
                >
                  {tocando === v.id ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={ativa}
                  onClick={() => set("voz", v.id)}
                  className="flex-1 text-left"
                >
                  <span className="block text-sm font-medium">{v.rotulo}</span>
                  <span className={`block text-xs ${ativa ? "text-slate-300" : "text-slate-500"}`}>{v.descricao}</span>
                </button>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-slate-500">
          Vale para as respostas em áudio do agente. Ouça a amostra e clique no nome para escolher; salve ao final.
        </p>
      </section>

      {/* Marca */}
      <section className="grid lg:grid-cols-2 gap-6">
        <Etiquetas
          rotulo="Especialidades"
          ajuda="Ex.: alto padrão, lançamentos, terrenos, locação comercial."
          valores={config.especialidades}
          onChange={(v) => set("especialidades", v)}
          placeholder="Digite e tecle Enter"
        />
        <Etiquetas
          rotulo="Palavras proibidas"
          ajuda="O agente nunca usa essas palavras; se escaparem, são removidas da resposta."
          valores={config.palavras_proibidas}
          onChange={(v) => set("palavras_proibidas", v)}
          placeholder="Ex.: barato, imperdível"
        />
        <div>
          <label htmlFor="publico" className="block text-xs font-medium text-slate-600 mb-1">Público-alvo</label>
          <textarea
            id="publico"
            rows={3}
            value={config.publico_alvo}
            onChange={(e) => set("publico_alvo", e.target.value)}
            placeholder="Ex.: famílias de classe média alta buscando o segundo imóvel"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900"
          />
        </div>
        <div>
          <div className="flex justify-between">
            <label htmlFor="nota" className="block text-xs font-medium text-slate-600 mb-1">Nota de marca</label>
            <span className={`text-[11px] ${config.nota_marca.length > MAX_NOTA ? "text-rose-600" : "text-slate-400"}`}>
              {config.nota_marca.length}/{MAX_NOTA}
            </span>
          </div>
          <textarea
            id="nota"
            rows={3}
            value={config.nota_marca}
            onChange={(e) => set("nota_marca", e.target.value)}
            placeholder="Missão, valores e diferenciais. Quanto mais concreto, melhor o agente segue."
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900"
          />
        </div>
      </section>

      {/* Memória */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Memória</h3>
          <p className="text-xs text-slate-500">Fatos que o agente considera em toda conversa. Um por item.</p>
        </div>
        <div className="flex gap-2">
          <input
            value={novaMemoria}
            maxLength={MAX_MEMORIA}
            onChange={(e) => setNovaMemoria(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (novaMemoria.trim()) {
                  set("memorias", [...config.memorias, novaMemoria.trim()]);
                  setNovaMemoria("");
                }
              }
            }}
            placeholder="Ex.: trabalhamos com permuta em imóveis acima de 1 milhão"
            aria-label="Nova memória"
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900"
          />
          <button
            type="button"
            disabled={!novaMemoria.trim()}
            onClick={() => {
              set("memorias", [...config.memorias, novaMemoria.trim()]);
              setNovaMemoria("");
            }}
            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <Plus className="w-4 h-4" /> Adicionar
          </button>
        </div>
        {config.memorias.length > 0 && (
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
            {config.memorias.map((m, i) => (
              <li key={i} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm text-slate-700">
                <span>{m}</span>
                <button
                  type="button"
                  aria-label="Remover memória"
                  onClick={() => set("memorias", config.memorias.filter((_, j) => j !== i))}
                  className="p-1 text-slate-400 hover:text-rose-600"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Aprovação */}
      <section>
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 cursor-pointer">
          <input
            type="checkbox"
            checked={config.confirmar_acoes}
            onChange={(e) => set("confirmar_acoes", e.target.checked)}
            className="mt-1 h-4 w-4 accent-slate-900"
          />
          <span>
            <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <ShieldCheck className="w-4 h-4" /> Confirmar antes de gravar
            </span>
            <span className="block text-xs text-slate-500 mt-1">
              Ligado: o agente mostra o que vai anotar (cliente, negócio, visita) e só grava depois do &ldquo;sim&rdquo; do
              corretor. Desligado: grava na hora e avisa o que fez.
            </span>
          </span>
        </label>
      </section>

      {/* Avançado */}
      <section className="space-y-4">
        <button type="button" onClick={() => setAvancado(!avancado)} className="text-sm font-medium text-slate-700 underline" aria-expanded={avancado}>
          {avancado ? "Ocultar" : "Mostrar"} persona e vocabulário (avançado)
        </button>
        {avancado && (
          <div className="space-y-4">
            <div>
              <label htmlFor="persona" className="block text-xs font-medium text-slate-600 mb-1">Persona (instruções livres)</label>
              <textarea
                id="persona"
                rows={6}
                value={config.persona}
                onChange={(e) => set("persona", e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900"
              />
            </div>
            <Etiquetas
              rotulo="Vocabulário de bairros"
              ajuda="Ajuda o agente a reconhecer bairros e regiões citados pelos corretores."
              valores={config.vocabulario_bairros}
              onChange={(v) => set("vocabulario_bairros", v)}
              placeholder="Ex.: Plano Diretor Sul"
            />
            <Etiquetas
              rotulo="Vocabulário de tipos de imóvel"
              ajuda="Tipos usados pela imobiliária."
              valores={config.vocabulario_tipos}
              onChange={(v) => set("vocabulario_tipos", v)}
              placeholder="Ex.: Cobertura"
            />
          </div>
        )}
      </section>

      <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
        <button
          type="submit"
          disabled={salvando || !config.persona.trim() || config.nota_marca.length > MAX_NOTA}
          className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl text-sm shadow-sm"
        >
          {salvando ? "Salvando..." : "Salvar configuração"}
        </button>
        {salvoEm && !erro && (
          <span className="text-xs text-emerald-600">
            Salvo às {salvoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
    </form>
  );
}
