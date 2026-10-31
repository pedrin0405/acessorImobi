"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Copy, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Area, Aviso, Botao, Carregando, Entrada, Interruptor, Seletor, Selo, Titulo, Vazio, useApi, useRecado } from "../ui";
import PreviaPdf from "@/components/books/PreviaPdf";
import { ConfigBook, LayoutInfo, ModeloBook, ModelosBook, ROTULO_LAYOUT } from "@/lib/books";

const HEX = /^#[0-9a-fA-F]{6}$/;

function Swatch({ config }: { config: ConfigBook }) {
  return (
    <span className="inline-flex shrink-0 rounded-lg overflow-hidden" style={{ border: "1px solid var(--line-2)" }} aria-hidden>
      <span className="w-6 h-8" style={{ background: config.cor_primaria }} />
      <span className="w-6 h-8" style={{ background: config.cor_secundaria }} />
    </span>
  );
}

function Grupo({ titulo, descricao, children }: { titulo: string; descricao?: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-2xl px-5 py-4 min-w-0" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
      <legend className="px-1 text-[13px] font-semibold" style={{ color: "var(--text)" }}>{titulo}</legend>
      {descricao && <p className="-mt-0.5 mb-2 text-xs" style={{ color: "var(--text-3)" }}>{descricao}</p>}
      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}

function Campo({ rotulo, ajuda, children, id }: { rotulo: string; ajuda?: string; children: React.ReactNode; id?: string }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] mb-1" style={{ color: "var(--text-2)" }}>{rotulo}</label>
      {children}
      {ajuda && <p className="mt-1 text-[11.5px]" style={{ color: "var(--text-4)" }}>{ajuda}</p>}
    </div>
  );
}

function Interruptores({ itens, config, aoMudar }: { itens: [keyof ConfigBook, string][]; config: ConfigBook; aoMudar: (c: Partial<ConfigBook>) => void }) {
  return (
    <>
      {itens.map(([chave, rotulo]) => (
        <div key={chave} className="flex items-center justify-between gap-3">
          <span className="text-sm" style={{ color: "var(--text)" }}>{rotulo}</span>
          <Interruptor ligado={!!config[chave]} onChange={(v) => aoMudar({ [chave]: v } as Partial<ConfigBook>)} rotulo={rotulo} />
        </div>
      ))}
    </>
  );
}

function CampoCor({ id, rotulo, valor, onChange }: { id: string; rotulo: string; valor: string; onChange: (v: string) => void }) {
  const valido = HEX.test(valor);
  return (
    <Campo rotulo={rotulo} id={id}>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={`${rotulo} (seletor)`} value={valido ? valor : "#000000"} onChange={(e) => onChange(e.target.value)} className="w-10 h-9 shrink-0 rounded-lg cursor-pointer p-0.5" style={{ background: "var(--input)", border: "1px solid var(--line-2)" }} />
        <Entrada id={id} value={valor} maxLength={7} onChange={(e) => onChange(e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`)} aria-invalid={!valido} className="font-mono" />
      </div>
    </Campo>
  );
}

function Editor({
  modelo, layouts, onSalvo, onCancelar, onAuthError,
}: {
  modelo: ModeloBook; layouts: LayoutInfo[]; onSalvo: (m: ModeloBook) => void; onCancelar: () => void; onAuthError: (e: unknown) => boolean;
}) {
  const api = useApi(onAuthError);
  const [nome, setNome] = useState(modelo.nome);
  const [config, setConfig] = useState<ConfigBook>(modelo.config);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const muda = useCallback((c: Partial<ConfigBook>) => setConfig((a) => ({ ...a, ...c })), []);
  const coresOk = HEX.test(config.cor_primaria) && HEX.test(config.cor_secundaria);
  const layout = layouts.find((l) => l.id === config.layout);
  // Só o que vai no PDF entra na chave: o nome do modelo não refaz a prévia.
  const chave = useMemo(() => JSON.stringify(config), [config]);
  const sujo = nome !== modelo.nome || chave !== JSON.stringify(modelo.config);

  const salvar = async () => {
    if (!nome.trim()) return setErro("Dê um nome ao modelo.");
    if (!coresOk) return setErro("As cores precisam estar no formato #rrggbb.");
    setSalvando(true); setErro(null);
    const r = await api<ModeloBook>(`/admin/books/modelos/${modelo.id}`, { method: "PUT", corpo: { nome: nome.trim(), config } });
    setSalvando(false);
    if (!r.ok || !r.dados) return setErro(r.erro);
    onSalvo(r.dados);
  };

  return (
    <div>
      <Titulo titulo={`Editar “${modelo.nome}”`} descricao="Ajuste o visual e o conteúdo. A prévia ao lado usa imóveis reais da sua carteira." />
      <div className="grid xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] gap-6 items-start">
        <div className="space-y-4 min-w-0">
          <Grupo titulo="Identidade visual">
            <Campo rotulo="Nome do modelo" id="bk-nome"><Entrada id="bk-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} /></Campo>
            <Campo rotulo="Layout" id="bk-layout" ajuda={layout?.descricao}>
              <Seletor id="bk-layout" value={config.layout} onChange={(e) => muda({ layout: e.target.value as ConfigBook["layout"] })}>
                {layouts.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
              </Seletor>
            </Campo>
            <div className="grid sm:grid-cols-2 gap-3">
              <CampoCor id="bk-cor1" rotulo="Cor principal" valor={config.cor_primaria} onChange={(v) => muda({ cor_primaria: v })} />
              <CampoCor id="bk-cor2" rotulo="Cor de destaque" valor={config.cor_secundaria} onChange={(v) => muda({ cor_secundaria: v })} />
            </div>
            <Campo rotulo="Fonte" id="bk-fonte">
              <Seletor id="bk-fonte" value={config.fonte} onChange={(e) => muda({ fonte: e.target.value as ConfigBook["fonte"] })}>
                <option value="moderna">Moderna (sem serifa)</option>
                <option value="classica">Clássica (com serifa)</option>
              </Seletor>
            </Campo>
            <Interruptores config={config} aoMudar={muda} itens={[["mostrar_logo", "Mostrar a logo da imobiliária"]]} />
            <p className="text-[11.5px]" style={{ color: "var(--text-4)" }}>A logo vem de Dados da imobiliária.</p>
          </Grupo>

          <Grupo titulo="Capa">
            <Interruptores config={config} aoMudar={muda} itens={[["mostrar_capa", "Incluir página de capa"]]} />
            {config.mostrar_capa && (
              <>
                <Campo rotulo="Título da capa" id="bk-titulo"><Entrada id="bk-titulo" value={config.titulo_capa} maxLength={80} onChange={(e) => muda({ titulo_capa: e.target.value })} /></Campo>
                <Campo rotulo="Subtítulo" id="bk-sub"><Entrada id="bk-sub" value={config.subtitulo_capa} maxLength={120} onChange={(e) => muda({ subtitulo_capa: e.target.value })} /></Campo>
              </>
            )}
          </Grupo>

          <Grupo titulo="Conteúdo de cada imóvel">
            <Campo rotulo={`Fotos por imóvel: ${config.fotos_por_imovel}`} id="bk-fotos">
              <input id="bk-fotos" type="range" min={1} max={6} step={1} value={config.fotos_por_imovel} onChange={(e) => muda({ fotos_por_imovel: Number(e.target.value) })} className="w-full" style={{ accentColor: "var(--accent)" }} />
            </Campo>
            <Interruptores config={config} aoMudar={muda} itens={[
              ["mostrar_descricao", "Descrição do anúncio"], ["mostrar_caracteristicas", "Características e diferenciais"],
              ["mostrar_custos", "Condomínio e IPTU"], ["mostrar_endereco", "Endereço"], ["mostrar_link", "Link do anúncio no site"],
            ]} />
          </Grupo>

          <Grupo titulo="Rodapé e contato">
            <Interruptores config={config} aoMudar={muda} itens={[["mostrar_contato", "Contato da imobiliária"], ["mostrar_corretor", "Nome do corretor que enviou"]]} />
            <Campo rotulo="Rodapé de cada página" id="bk-rodape"><Entrada id="bk-rodape" value={config.rodape} maxLength={140} onChange={(e) => muda({ rodape: e.target.value })} /></Campo>
            <Campo rotulo="Mensagem final" id="bk-final" ajuda="Aparece na última página, depois dos imóveis."><Area id="bk-final" rows={3} value={config.mensagem_final} maxLength={400} onChange={(e) => muda({ mensagem_final: e.target.value })} /></Campo>
          </Grupo>

          {erro && <Aviso tom="erro">{erro}</Aviso>}
          <div className="flex items-center justify-end gap-3">
            <Botao variante="fantasma" onClick={onCancelar}>Cancelar</Botao>
            <Botao variante="primario" onClick={salvar} carregando={salvando} disabled={!sujo}>Salvar modelo</Botao>
          </div>
        </div>

        <div className="xl:sticky xl:top-24 min-w-0">
          <PreviaPdf caminho="/admin/books/previa" corpo={{ config }} chave={coresOk ? chave : "invalido"} automatica={coresOk} nomeArquivo={`previa-${modelo.nome}.pdf`} onAuthError={onAuthError} altura="78vh" />
        </div>
      </div>
    </div>
  );
}

function NovoModelo({ modelos, onCriar, onCancelar }: { modelos: ModeloBook[]; onCriar: (nome: string, copiarDe: string) => Promise<string | null>; onCancelar: () => void }) {
  const [nome, setNome] = useState("");
  const [base, setBase] = useState(modelos.find((m) => m.padrao)?.id || modelos[0]?.id || "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const criar = async () => {
    if (!nome.trim()) return setErro("Dê um nome ao modelo.");
    setSalvando(true); setErro(null);
    const e = await onCriar(nome.trim(), base);
    setSalvando(false);
    if (e) setErro(e);
  };
  return (
    <div className="rounded-2xl p-5 mb-5" style={{ background: "var(--card)", border: "1px solid var(--accent)" }} role="group" aria-label="Novo modelo de book">
      <h3 className="text-[15px] font-semibold" style={{ color: "var(--text)" }}>Novo modelo</h3>
      <div className="mt-3 grid sm:grid-cols-2 gap-3">
        <Campo rotulo="Nome" id="nm-nome"><Entrada id="nm-nome" autoFocus value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} placeholder="Ex.: Lançamentos da orla" onKeyDown={(e) => e.key === "Enter" && criar()} /></Campo>
        <Campo rotulo="Partir de" id="nm-base">
          <Seletor id="nm-base" value={base} onChange={(e) => setBase(e.target.value)}>
            {modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}{m.padrao ? " (padrão)" : ""}</option>)}
          </Seletor>
        </Campo>
      </div>
      {erro && <div className="mt-3"><Aviso tom="erro">{erro}</Aviso></div>}
      <div className="mt-4 flex justify-end gap-2">
        <Botao variante="fantasma" onClick={onCancelar}>Cancelar</Botao>
        <Botao variante="primario" onClick={criar} carregando={salvando}>Criar e editar</Botao>
      </div>
    </div>
  );
}

export function BooksSecao({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const api = useApi(onAuthError);
  const [dados, setDados] = useState<ModelosBook | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [recado, mostrar] = useRecado();

  const carregar = useCallback(async () => {
    const r = await api<ModelosBook>("/admin/books/modelos");
    if (r.ok && r.dados) { setDados(r.dados); setErro(null); } else if (r.erro) setErro(r.erro);
  }, [api]);
  useEffect(() => { carregar(); }, [carregar]);

  const acao = async (id: string, fn: () => Promise<string | null>, ok: string) => {
    setOcupado(id); setErro(null);
    const e = await fn();
    setOcupado(null);
    if (e) return setErro(e);
    mostrar(ok);
    await carregar();
  };

  const criar = async (nome: string, copiarDe: string): Promise<string | null> => {
    const r = await api<ModeloBook>("/admin/books/modelos", { method: "POST", corpo: { nome, config: dados?.modelos.find((m) => m.id === copiarDe)?.config ?? dados?.padrao_config, copiar_de: copiarDe || undefined } });
    if (!r.ok || !r.dados) return r.erro || "Não foi possível criar o modelo.";
    setNovo(false); await carregar(); setEditando(r.dados.id);
    return null;
  };

  const duplicar = (m: ModeloBook) => acao(m.id, async () => {
    const r = await api<ModeloBook>("/admin/books/modelos", { method: "POST", corpo: { nome: `${m.nome} (cópia)`.slice(0, 60), config: m.config, copiar_de: m.id } });
    return r.ok ? null : r.erro;
  }, "Modelo duplicado.");
  const padrao = (m: ModeloBook) => acao(m.id, async () => { const r = await api(`/admin/books/modelos/${m.id}/padrao`, { method: "POST" }); return r.ok ? null : r.erro; }, `“${m.nome}” é o modelo padrão.`);
  const excluir = (m: ModeloBook) => acao(m.id, async () => { setConfirmando(null); const r = await api(`/admin/books/modelos/${m.id}`, { method: "DELETE" }); return r.ok ? null : r.erro; }, "Modelo excluído.");

  const modelo = dados?.modelos.find((m) => m.id === editando);
  if (dados && modelo) {
    return <Editor key={modelo.id} modelo={modelo} layouts={dados.layouts} onAuthError={onAuthError} onCancelar={() => setEditando(null)} onSalvo={async () => { setEditando(null); mostrar("Modelo salvo."); await carregar(); }} />;
  }

  return (
    <div>
      <Titulo
        titulo="Books de imóveis"
        descricao="Modelos dos PDFs que o agente e a equipe enviam com a seleção de imóveis: capa, fotos, dados e contato. O modelo padrão é usado quando ninguém escolhe outro."
        acao={dados && <Botao variante="primario" onClick={() => setNovo(true)} disabled={novo}><Plus className="w-4 h-4" aria-hidden /> Novo modelo</Botao>}
      />
      {recado && <div className="mb-4"><Aviso tom="ok">{recado}</Aviso></div>}
      {erro && <div className="mb-4"><Aviso tom="erro">{erro}</Aviso></div>}
      {dados && novo && <NovoModelo modelos={dados.modelos} onCriar={criar} onCancelar={() => setNovo(false)} />}

      {!dados && !erro ? <Carregando linhas={3} /> : dados && dados.modelos.length === 0 ? (
        <div className="rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
          <Vazio icone={<BookOpen className="w-5 h-5" />} titulo="Nenhum modelo ainda" texto="Crie o primeiro modelo para padronizar os books da imobiliária.">
            <Botao variante="primario" onClick={() => setNovo(true)}><Plus className="w-4 h-4" aria-hidden /> Novo modelo</Botao>
          </Vazio>
        </div>
      ) : (
        <ul className="grid md:grid-cols-2 gap-3">
          {dados?.modelos.map((m) => {
            const bloqueado = ocupado === m.id;
            return (
              <li key={m.id} className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: "var(--card)", border: `1px solid ${m.padrao ? "var(--accent)" : "var(--line)"}`, opacity: bloqueado ? 0.6 : 1 }}>
                <div className="flex items-start gap-3">
                  <Swatch config={m.config} />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>{m.nome}</h3>
                    <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
                      Layout {ROTULO_LAYOUT[m.config.layout] || m.config.layout} · até {m.config.fotos_por_imovel} {m.config.fotos_por_imovel === 1 ? "foto" : "fotos"} por imóvel{m.config.mostrar_capa ? " · com capa" : ""}
                    </p>
                  </div>
                  <span className="flex flex-wrap justify-end gap-1">
                    {m.padrao && <Selo tom="ok">Padrão</Selo>}
                    {m.sistema && <Selo>De fábrica</Selo>}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-auto">
                  <Botao onClick={() => setEditando(m.id)} disabled={bloqueado} className="!px-3 !py-1.5 !text-[13px]"><Pencil className="w-3.5 h-3.5" aria-hidden /> Editar</Botao>
                  <Botao onClick={() => duplicar(m)} disabled={bloqueado} className="!px-3 !py-1.5 !text-[13px]"><Copy className="w-3.5 h-3.5" aria-hidden /> Duplicar</Botao>
                  {!m.padrao && <Botao onClick={() => padrao(m)} disabled={bloqueado} className="!px-3 !py-1.5 !text-[13px]"><Star className="w-3.5 h-3.5" aria-hidden /> Tornar padrão</Botao>}
                  {!m.padrao && !m.sistema && (
                    confirmando === m.id ? (
                      <span className="inline-flex items-center gap-1 ml-auto">
                        <Botao variante="perigo" onClick={() => excluir(m)} disabled={bloqueado} className="!px-3 !py-1.5 !text-[13px]">Excluir mesmo</Botao>
                        <Botao variante="fantasma" onClick={() => setConfirmando(null)} className="!px-2 !py-1.5 !text-[13px]">Não</Botao>
                      </span>
                    ) : (
                      <Botao variante="fantasma" onClick={() => setConfirmando(m.id)} disabled={bloqueado} aria-label={`Excluir ${m.nome}`} className="ml-auto !px-2.5 !py-1.5 !text-[13px]"><Trash2 className="w-3.5 h-3.5" aria-hidden /></Botao>
                    )
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
