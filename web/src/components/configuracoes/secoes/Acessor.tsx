"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brain, Check, Pause, Play, Plus, Trash2, X } from "lucide-react";
import { Area, Aviso, Botao, Bloco, Cartao, Carregando, Entrada, Interruptor, Linha, Salvar, Vazio, Titulo, useApi, useRecado } from "../ui";

interface Tom { id: string; rotulo: string; exemplo: string }
interface Voz { id: string; rotulo: string; descricao: string }

export interface ConfigAgente {
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
  audio_frequencia: "nunca" | "aleatorio" | "a_cada" | "sempre";
  audio_chance: number;
  audio_a_cada: number;
  audio_responder_audio: boolean;
}

const MAX_NOTA = 1000;
const MAX_MEMORIA = 800;
const MAX_MEMORIAS = 50;

/** Carrega a configuração do agente e salva o objeto inteiro (a API exige a persona). */
function useConfigAgente(onAuthError: (e: unknown) => boolean) {
  const api = useApi(onAuthError);
  const [config, setConfig] = useState<ConfigAgente | null>(null);
  const [original, setOriginal] = useState<string>("");
  const [tons, setTons] = useState<Tom[]>([]);
  const [vozes, setVozes] = useState<Voz[]>([]);
  const [erroCarga, setErroCarga] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [c, t, v] = await Promise.all([
        api<ConfigAgente>("/admin/agente/configuracao"),
        api<Tom[]>("/admin/agente/tons"),
        api<Voz[]>("/admin/agente/vozes"),
      ]);
      if (c.ok && c.dados) { setConfig(c.dados); setOriginal(JSON.stringify(c.dados)); }
      else setErroCarga(c.erro || "Não foi possível carregar a configuração do agente.");
      if (t.dados) setTons(t.dados);
      if (v.dados) setVozes(v.dados);
    })();
  }, [api]);

  const salvar = useCallback(async (proxima: ConfigAgente): Promise<string | null> => {
    const r = await api("/admin/agente/configuracao", { method: "PUT", corpo: proxima });
    if (!r.ok) return r.erro;
    setConfig(proxima); setOriginal(JSON.stringify(proxima));
    return null;
  }, [api]);

  return { config, setConfig, sujo: !!config && JSON.stringify(config) !== original, tons, vozes, erroCarga, salvar };
}

/* ---------- etiquetas (especialidades, palavras proibidas) ---------- */

function Etiquetas({ rotulo, ajuda, valores, onChange, placeholder }: { rotulo: string; ajuda: string; valores: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [novo, setNovo] = useState("");
  const adicionar = () => {
    const v = novo.trim();
    if (v && !valores.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...valores, v]);
    setNovo("");
  };
  return (
    <div>
      <div className="flex gap-2">
        <Entrada aria-label={rotulo} value={novo} onChange={(e) => setNovo(e.target.value)} placeholder={placeholder} maxLength={60}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionar(); } }} />
        <Botao onClick={adicionar} disabled={!novo.trim()}><Plus className="w-4 h-4" aria-hidden /> Adicionar</Botao>
      </div>
      <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--text-4)" }}>{ajuda}</p>
      {valores.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {valores.map((v) => (
            <li key={v} className="inline-flex items-center gap-1 pl-3 pr-1 py-1 rounded-full text-[13px]" style={{ background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--text-2)" }}>
              {v}
              <button type="button" aria-label={`Remover ${v}`} onClick={() => onChange(valores.filter((x) => x !== v))} className="p-1 rounded-full hover:bg-[var(--hover-solid)]"><X className="w-3 h-3" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- Voz e comportamento ---------- */

const FREQUENCIAS: { id: ConfigAgente["audio_frequencia"]; rotulo: string; texto: string }[] = [
  { id: "nunca", rotulo: "Nunca", texto: "Só texto, mesmo quando o corretor manda áudio." },
  { id: "aleatorio", rotulo: "De vez em quando", texto: "Alterna por sorteio, para soar natural." },
  { id: "a_cada", rotulo: "A cada N respostas", texto: "Uma resposta em áudio depois de N em texto." },
  { id: "sempre", rotulo: "Sempre", texto: "Toda resposta sai em áudio (listas de imóveis continuam por escrito)." },
];

export function VozSecao({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const { config, setConfig, sujo, tons, vozes, erroCarga, salvar } = useConfigAgente(onAuthError);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, mostrar] = useRecado();
  const [tocando, setTocando] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const [avancado, setAvancado] = useState(false);
  useEffect(() => () => player.current?.pause(), []);

  if (!config) return <><Titulo titulo="Voz e comportamento" descricao="Como o agente fala e se comporta nas conversas com os corretores." />{erroCarga ? <Aviso tom="erro">{erroCarga}</Aviso> : <Carregando />}</>;
  const set = <K extends keyof ConfigAgente>(k: K, v: ConfigAgente[K]) => setConfig((c) => (c ? { ...c, [k]: v } : c));
  const tom = tons.find((t) => t.id === config.tom);

  const ouvir = (id: string) => {
    player.current?.pause();
    if (tocando === id) return setTocando(null);
    const a = new Audio(`/vozes/${id}.wav`);
    a.onended = a.onerror = () => setTocando(null);
    player.current = a; setTocando(id);
    a.play().catch(() => setTocando(null));
  };

  const gravar = async () => {
    setSalvando(true); setErro(null);
    const e = await salvar(config);
    setSalvando(false);
    if (e) setErro(e); else mostrar("Configuração salva.");
  };

  return (
    <>
      <Titulo titulo="Voz e comportamento" descricao="Como o agente fala e se comporta nas conversas com os corretores. O que muda aqui vale para as próximas respostas." />

      <Bloco titulo="Tom de voz">
        <div role="radiogroup" aria-label="Tom de voz" className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {tons.map((t) => {
            const ativo = config.tom === t.id;
            return (
              <button key={t.id} type="button" role="radio" aria-checked={ativo} onClick={() => set("tom", ativo ? null : t.id)}
                className="flex items-center justify-between gap-2 text-left px-4 py-3 rounded-xl border transition-colors text-sm"
                style={{ background: ativo ? "var(--accent-soft)" : "var(--card)", borderColor: ativo ? "var(--accent)" : "var(--line)", color: "var(--text)" }}>
                {t.rotulo}
                {ativo && <Check className="w-4 h-4" style={{ color: "var(--accent)" }} aria-hidden />}
              </button>
            );
          })}
        </div>
        <div className="mt-3 rounded-xl px-4 py-3" style={{ background: "var(--card-2)", border: "1px solid var(--line)" }}>
          <p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-4)" }}>Como o Acessor soaria</p>
          <p className="mt-1 text-sm" style={{ color: "var(--text-2)" }}>{tom ? `“${tom.exemplo}”` : "Escolha um tom para ver um exemplo. Sem tom, vale só a persona."}</p>
        </div>
      </Bloco>

      <Bloco titulo="Voz das respostas em áudio" descricao="Ouça a amostra e escolha a voz que o agente usa quando responde em áudio.">
        <div role="radiogroup" aria-label="Voz" className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {vozes.map((v) => {
            const ativa = config.voz === v.id;
            return (
              <div key={v.id} className="flex items-center gap-3 rounded-xl border px-3 py-2.5" style={{ background: ativa ? "var(--accent-soft)" : "var(--card)", borderColor: ativa ? "var(--accent)" : "var(--line)" }}>
                <button type="button" onClick={() => ouvir(v.id)} aria-label={tocando === v.id ? `Pausar amostra de ${v.rotulo}` : `Ouvir amostra de ${v.rotulo}`} className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center hover:brightness-125" style={{ background: "var(--card-2)", color: "var(--text-2)" }}>
                  {tocando === v.id ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                </button>
                <button type="button" role="radio" aria-checked={ativa} onClick={() => set("voz", v.id)} className="flex-1 text-left min-w-0">
                  <span className="block text-sm font-medium" style={{ color: "var(--text)" }}>{v.rotulo}</span>
                  <span className="block text-xs truncate" style={{ color: "var(--text-3)" }}>{v.descricao}</span>
                </button>
              </div>
            );
          })}
        </div>
      </Bloco>

      <Bloco titulo="Com que frequência responder em áudio" descricao="Alternar texto e voz deixa a conversa mais natural. Propostas que pedem confirmação e listas de imóveis nunca vão só em áudio.">
        <div role="radiogroup" aria-label="Frequência do áudio" className="grid sm:grid-cols-2 gap-2">
          {FREQUENCIAS.map((f) => {
            const ativa = config.audio_frequencia === f.id;
            return (
              <button key={f.id} type="button" role="radio" aria-checked={ativa} onClick={() => set("audio_frequencia", f.id)} className="text-left rounded-xl border px-4 py-3 transition-colors" style={{ background: ativa ? "var(--accent-soft)" : "var(--card)", borderColor: ativa ? "var(--accent)" : "var(--line)" }}>
                <span className="flex items-center justify-between text-sm font-medium" style={{ color: "var(--text)" }}>{f.rotulo}{ativa && <Check className="w-4 h-4" style={{ color: "var(--accent)" }} aria-hidden />}</span>
                <span className="block mt-0.5 text-xs" style={{ color: "var(--text-3)" }}>{f.texto}</span>
              </button>
            );
          })}
        </div>
        <Cartao className="mt-3">
          {config.audio_frequencia === "aleatorio" && (
            <Linha rotulo="Chance por resposta" ajuda="Quanto maior, mais áudios.">
              <div className="flex items-center gap-3">
                <input type="range" min={0} max={100} step={5} value={config.audio_chance} onChange={(e) => set("audio_chance", Number(e.target.value))} aria-label="Chance de áudio" className="flex-1 accent-[var(--accent)]" />
                <span className="w-12 text-right text-sm tabular-nums" style={{ color: "var(--text)" }}>{config.audio_chance}%</span>
              </div>
            </Linha>
          )}
          {config.audio_frequencia === "a_cada" && (
            <Linha rotulo="Intervalo" ajuda="De 2 a 20 respostas.">
              <div className="flex items-center gap-3">
                <span className="text-sm" style={{ color: "var(--text-2)" }}>1 áudio a cada</span>
                <Entrada type="number" min={2} max={20} value={config.audio_a_cada} onChange={(e) => set("audio_a_cada", Math.max(2, Math.min(20, Number(e.target.value) || 2)))} className="!w-20" aria-label="Respostas de texto entre áudios" />
                <span className="text-sm" style={{ color: "var(--text-2)" }}>respostas</span>
              </div>
            </Linha>
          )}
          <Linha rotulo="Responder áudio com áudio" ajuda="Quando o corretor manda voz, o agente responde em voz.">
            <div className="flex justify-end"><Interruptor ligado={config.audio_responder_audio} onChange={(v) => set("audio_responder_audio", v)} rotulo="Responder áudio com áudio" disabled={config.audio_frequencia === "nunca"} /></div>
          </Linha>
        </Cartao>
      </Bloco>

      <Bloco titulo="Especialidades e público">
        <Cartao>
          <div className="px-5 py-4"><p className="text-sm mb-2" style={{ color: "var(--text)" }}>Especialidades</p><Etiquetas rotulo="Adicionar especialidade" ajuda="Ex.: alto padrão, comercial, lançamentos, terrenos." valores={config.especialidades} onChange={(v) => set("especialidades", v)} placeholder="Adicionar especialidade" /></div>
          <div className="px-5 py-4">
            <label htmlFor="publico" className="text-sm" style={{ color: "var(--text)" }}>Público-alvo</label>
            <Area id="publico" rows={3} className="mt-2" value={config.publico_alvo} onChange={(e) => set("publico_alvo", e.target.value)} placeholder="Ex.: famílias jovens de classe média/alta buscando o primeiro imóvel" maxLength={500} />
          </div>
          <div className="px-5 py-4"><p className="text-sm mb-2" style={{ color: "var(--text)" }}>Palavras proibidas</p><Etiquetas rotulo="Adicionar palavra proibida" ajuda="O agente nunca usa essas palavras; se escaparem, são removidas da resposta." valores={config.palavras_proibidas} onChange={(v) => set("palavras_proibidas", v)} placeholder="Ex.: barato, imperdível" /></div>
          <div className="px-5 py-4">
            <div className="flex items-center justify-between"><label htmlFor="nota" className="text-sm" style={{ color: "var(--text)" }}>Sobre a imobiliária</label><span className="text-[11px] tabular-nums" style={{ color: "var(--text-4)" }}>{config.nota_marca.length}/{MAX_NOTA}</span></div>
            <Area id="nota" rows={4} className="mt-2" value={config.nota_marca} onChange={(e) => set("nota_marca", e.target.value.slice(0, MAX_NOTA))} placeholder="Em poucas linhas: história, diferenciais, regiões, como vocês gostam de atender." />
          </div>
        </Cartao>
      </Bloco>

      <Bloco titulo="Aprovação">
        <Cartao>
          <Linha rotulo="Confirmar antes de gravar" ajuda="Ligado: o agente mostra o que vai anotar (cliente, negócio, visita) e só grava depois do “sim” do corretor. Desligado: grava na hora e avisa.">
            <div className="flex justify-end"><Interruptor ligado={config.confirmar_acoes} onChange={(v) => set("confirmar_acoes", v)} rotulo="Confirmar antes de gravar" /></div>
          </Linha>
        </Cartao>
      </Bloco>

      <div className="mt-8">
        <button type="button" onClick={() => setAvancado((v) => !v)} aria-expanded={avancado} className="text-sm underline underline-offset-2" style={{ color: "var(--text-2)" }}>{avancado ? "Ocultar" : "Mostrar"} persona e vocabulário (avançado)</button>
        {avancado && (
          <div className="assist-fade mt-4 space-y-4">
            <Aviso tom="aviso">A persona manda sobre todo o resto. Mexa só se souber o efeito: ela é o texto-base que o agente recebe em toda conversa.</Aviso>
            <Cartao>
              <div className="px-5 py-4"><label htmlFor="persona" className="text-sm" style={{ color: "var(--text)" }}>Persona</label><Area id="persona" rows={9} className="mt-2 font-mono text-[13px]" value={config.persona} onChange={(e) => set("persona", e.target.value)} maxLength={8000} /></div>
              <div className="px-5 py-4"><p className="text-sm mb-2" style={{ color: "var(--text)" }}>Bairros do vocabulário</p><Etiquetas rotulo="Adicionar bairro" ajuda="Ajuda o agente a entender nomes de bairros e condomínios." valores={config.vocabulario_bairros} onChange={(v) => set("vocabulario_bairros", v)} placeholder="Ex.: Plano Diretor Sul" /></div>
              <div className="px-5 py-4"><p className="text-sm mb-2" style={{ color: "var(--text)" }}>Tipos de imóvel do vocabulário</p><Etiquetas rotulo="Adicionar tipo" ajuda="Termos que o agente deve reconhecer como tipos de imóvel." valores={config.vocabulario_tipos} onChange={(v) => set("vocabulario_tipos", v)} placeholder="Ex.: kitnet" /></div>
            </Cartao>
          </div>
        )}
      </div>
      <Salvar onSalvar={gravar} salvando={salvando} sujo={sujo} recado={recado} erro={erro} />
    </>
  );
}

/* ---------- Memória ---------- */

const SUGESTOES = [
  "Nunca sugerir imóvel sem vaga coberta para clientes com filhos pequenos.",
  "Visitas de fim de semana só com confirmação na sexta até as 18h.",
  "Sempre mencionar a possibilidade de permuta em imóveis acima de R$ 3 milhões.",
];

export function MemoriaSecao({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const { config, erroCarga, salvar } = useConfigAgente(onAuthError);
  const [lista, setLista] = useState<string[] | null>(null);
  const [nova, setNova] = useState("");
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, mostrar] = useRecado();
  useEffect(() => { if (config && lista === null) setLista(config.memorias); }, [config, lista]);

  const gravar = useCallback(async (proxima: string[]): Promise<boolean> => {
    if (!config) return false;
    setRodando(true); setErro(null);
    const e = await salvar({ ...config, memorias: proxima });
    setRodando(false);
    if (e) { setErro(e); return false; }
    setLista(proxima); mostrar("Memória salva.");
    return true;
  }, [config, salvar, mostrar]);

  const adicionar = async () => {
    const t = nova.trim();
    if (!t || !lista) return;
    if (lista.length >= MAX_MEMORIAS) return setErro(`No máximo ${MAX_MEMORIAS} memórias.`);
    if (await gravar([...lista, t])) setNova("");
  };

  if (!lista) return <><Titulo titulo="Memória" descricao="Preferências e instruções que o Acessor considera em toda conversa." />{erroCarga ? <Aviso tom="erro">{erroCarga}</Aviso> : <Carregando linhas={2} />}</>;

  return (
    <>
      <Titulo titulo="Memória" descricao="Preferências e instruções que o Acessor considera em toda conversa. Você pode editar ou remover a qualquer momento." />
      <Bloco titulo="Nova memória" descricao="Uma regra por vez, escrita como você explicaria a um corretor novo.">
        <div className="rounded-2xl p-3" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
          <Area rows={3} aria-label="Nova memória" value={nova} onChange={(e) => setNova(e.target.value.slice(0, MAX_MEMORIA))} placeholder="Ex.: o cliente Paulo prefere contato só depois das 18h."
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); adicionar(); } }} />
          <div className="mt-2 flex items-center justify-between gap-3 px-1">
            <span className="text-xs tabular-nums" style={{ color: "var(--text-4)" }}>{nova.length}/{MAX_MEMORIA} · Ctrl/⌘ Enter salva</span>
            <Botao variante="primario" onClick={adicionar} disabled={!nova.trim()} carregando={rodando}>Salvar memória</Botao>
          </div>
        </div>
        {erro && <p role="alert" className="mt-2 text-[13px]" style={{ color: "var(--danger)" }}>{erro}</p>}
        {recado && !erro && <p role="status" className="assist-fade mt-2 text-[13px] inline-flex items-center gap-1.5" style={{ color: "var(--accent-text)" }}><Check className="w-4 h-4" aria-hidden />{recado}</p>}
      </Bloco>

      <Bloco titulo={lista.length ? `Suas memórias (${lista.length})` : undefined}>
        {lista.length === 0 ? (
          <div className="rounded-2xl" style={{ border: "1px dashed var(--line-2)" }}>
            <Vazio icone={<Brain className="w-6 h-6" aria-hidden />} titulo="Sem memórias ainda" texto="Adicione acima. Comece por um destes:">
              <ul className="space-y-2 max-w-lg">
                {SUGESTOES.map((s) => (
                  <li key={s}><button type="button" onClick={() => setNova(s)} className="w-full text-left px-4 py-2.5 rounded-xl text-[13px] hover:bg-[var(--hover-solid)]" style={{ background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--text-2)" }}>{s}</button></li>
                ))}
              </ul>
            </Vazio>
          </div>
        ) : (
          <Cartao>
            {lista.map((m, i) => (
              <div key={`${i}-${m.slice(0, 12)}`} className="flex items-start justify-between gap-4 px-5 py-3.5">
                <p className="text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>{m}</p>
                <button type="button" aria-label="Remover memória" onClick={() => gravar(lista.filter((_, j) => j !== i))} className="shrink-0 p-1.5 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </Cartao>
        )}
      </Bloco>
    </>
  );
}
