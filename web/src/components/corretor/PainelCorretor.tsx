"use client";

import React, { useCallback, useEffect, useState } from "react";
import { BookOpen, Briefcase, CheckCircle, MessageCircle, RefreshCw, Send, Shuffle, Smartphone, UserRound, X, XCircle } from "lucide-react";
import { Aviso, Botao, Carregando, Entrada, Interruptor, Selo, useApi, useRecado } from "@/components/configuracoes/ui";
import AcoesRapidas from "@/components/crm/conversas/AcoesRapidas";
import { brl } from "@/lib/crm";
import AvatarCorretor from "./AvatarCorretor";
import { atualizarFotosCorretores } from "./useCorretoresFoto";

export interface PainelDados {
  id: string;
  nome: string | null;
  email: string | null;
  telefone: string;
  telefone_mascarado: string;
  status: string;
  recusa_motivo: string | null;
  criado_em: string | null;
  aprovado_em: string | null;
  foto_url: string | null;
  foto_origem: string | null;
  assistente: { ativo: boolean; avisos: boolean; carteira_auto: boolean };
  whatsapp_pessoal: { status: string; numero: string | null; visto_em: string | null };
  roleta: { ativa: boolean; participa: boolean };
  carteira: { clientes: number; quentes: number; negocios_abertos: number; valor_aberto: number; negocios_ganhos: number; atividades_abertas: number; atrasadas: number };
  atividade: { recebidas_30d: number; enviadas_30d: number; ultima_mensagem_em: string | null; aguardando_resposta: number };
}

type Aba = "perfil" | "situacao" | "assistente" | "carteira";
const ABAS: { id: Aba; rotulo: string; Icone: React.ComponentType<{ className?: string }> }[] = [
  { id: "perfil", rotulo: "Perfil", Icone: UserRound },
  { id: "situacao", rotulo: "Situação e roleta", Icone: Shuffle },
  { id: "assistente", rotulo: "Assistente e WhatsApp", Icone: Smartphone },
  { id: "carteira", rotulo: "Carteira e atalhos", Icone: Briefcase },
];

const STATUS: Record<string, { rotulo: string; tom: "ok" | "aviso" | "perigo" }> = {
  active: { rotulo: "Ativo", tom: "ok" }, pending: { rotulo: "Aguardando aprovação", tom: "aviso" },
  rejected: { rotulo: "Recusado", tom: "perigo" }, blocked: { rotulo: "Bloqueado", tom: "perigo" },
};
const WHATS: Record<string, string> = { connected: "Conectado", connecting: "Conectando", qr_pending: "Aguardando leitura do QR", disconnected: "Desconectado" };

const dataLonga = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const num = (n: number) => n.toLocaleString("pt-BR");

function Numero({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="rounded-xl p-3" style={{ background: "var(--card-2)", border: "1px solid var(--line)" }}>
      <p className="text-xl font-semibold tabular-nums" style={{ color: destaque ? "var(--warn)" : "var(--text)" }}>{valor}</p>
      <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>{rotulo}</p>
    </div>
  );
}

function Bloco({ titulo, descricao, children }: { titulo: string; descricao?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl p-4 space-y-3" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
      <div>
        <h4 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{titulo}</h4>
        {descricao && <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>{descricao}</p>}
      </div>
      {children}
    </section>
  );
}

function Preferencia({ rotulo, ajuda, ligado, onChange, disabled }: { rotulo: string; ajuda: string; ligado: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0"><p className="text-sm" style={{ color: "var(--text)" }}>{rotulo}</p><p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>{ajuda}</p></div>
      <Interruptor ligado={ligado} onChange={onChange} rotulo={rotulo} disabled={disabled} />
    </div>
  );
}

export default function PainelCorretor({
  corretorId, onFechar, onAuthError, onMudou, onAbrirConversa, onAprovar, onRecusar,
}: {
  corretorId: string;
  onFechar: () => void;
  onAuthError: (e: unknown) => boolean;
  onMudou: () => void;
  onAbrirConversa: (corretorId: string) => void;
  onAprovar: (corretorId: string) => void;
  onRecusar: (corretorId: string) => void;
}) {
  const api = useApi(onAuthError);
  const [dados, setDados] = useState<PainelDados | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>("perfil");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, mostrar] = useRecado();
  const [mensagem, setMensagem] = useState("");
  const [book, setBook] = useState(false);

  const aplicar = (d: PainelDados) => { setDados(d); setNome(d.nome ?? ""); setEmail(d.email ?? ""); };

  const carregar = useCallback(async () => {
    const r = await api<PainelDados>(`/admin/corretores/${corretorId}/painel`);
    if (r.ok && r.dados) { aplicar(r.dados); setErroCarga(null); } else setErroCarga(r.erro || "Não consegui abrir o painel deste corretor.");
  }, [api, corretorId]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && !book && onFechar();
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onFechar, book]);

  const salvar = async (chave: string, caminho: string, metodo: string, corpo: unknown, ok: string, depois?: (d: any) => void) => {
    setSalvando(chave); setErro(null);
    const r = await api<any>(caminho, { method: metodo, corpo });
    setSalvando(null);
    if (!r.ok) return setErro(r.erro);
    depois?.(r.dados);
    mostrar(ok);
    onMudou();
  };

  const salvarPerfil = () => salvar("perfil", `/admin/corretores/${corretorId}`, "PATCH", { nome, email }, "Dados salvos.", (d) => aplicar(d));
  const atualizarFoto = async () => {
    setSalvando("foto"); setErro(null);
    const r = await api<{ atualizada?: boolean }>(`/admin/corretores/${corretorId}/foto/atualizar`, { method: "POST" });
    if (!r.ok) { setSalvando(null); return setErro(r.erro); }
    await atualizarFotosCorretores();
    await carregar();
    setSalvando(null);
    mostrar("Foto atualizada pelo WhatsApp.");
    onMudou();
  };
  const preferencia = (campo: "ativo" | "avisos" | "carteira_auto", v: boolean) => {
    if (!dados) return;
    const novo = { ...dados.assistente, [campo]: v };
    setDados({ ...dados, assistente: novo });
    salvar("assistente", `/admin/corretores/${corretorId}/assistente`, "PUT", novo, "Preferências salvas.");
  };
  const roleta = (v: boolean) => {
    if (!dados) return;
    setDados({ ...dados, roleta: { ...dados.roleta, participa: v } });
    salvar("roleta", `/admin/corretores/${corretorId}/roleta`, "PUT", { participa: v }, v ? "Entrou na roleta de leads." : "Saiu da roleta de leads.");
  };
  const situacao = (ativo: boolean) => salvar("situacao", `/admin/corretores/${corretorId}/situacao`, "PUT", { ativo }, ativo ? "Corretor ativado." : "Corretor bloqueado.", () => carregar());
  const enviarMensagem = async () => {
    if (!mensagem.trim()) return;
    setSalvando("mensagem"); setErro(null);
    const r = await api(`/admin/conversas/${corretorId}/enviar`, { method: "POST", corpo: { texto: mensagem.trim() } });
    setSalvando(null);
    if (!r.ok) return setErro(r.erro);
    setMensagem("");
    mostrar("Mensagem enviada pelo número do agente.");
  };

  const st = dados ? STATUS[dados.status] ?? { rotulo: dados.status, tom: "aviso" as const } : null;
  const sujoPerfil = dados ? nome.trim() !== (dados.nome ?? "") || email.trim() !== (dados.email ?? "") : false;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-6" style={{ background: "rgb(0 0 0 / .6)" }} role="dialog" aria-modal="true" aria-label="Painel do corretor" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="w-full sm:max-w-3xl h-full sm:h-auto sm:max-h-[92vh] flex flex-col sm:rounded-2xl overflow-hidden" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--text)" }}>
        <header className="flex items-center gap-4 p-5 shrink-0" style={{ borderBottom: "1px solid var(--line)" }}>
          <AvatarCorretor nome={dados?.nome ?? null} fotoUrl={dados?.foto_url} tamanho={56} />
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold truncate">{dados?.nome || "Corretor"}</h3>
            <p className="text-xs flex flex-wrap items-center gap-2 mt-0.5" style={{ color: "var(--text-3)" }}>{dados?.telefone_mascarado}{st && <Selo tom={st.tom}>{st.rotulo}</Selo>}</p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="p-2 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}><X className="w-5 h-5" /></button>
        </header>

        <nav className="flex gap-1 px-3 pt-2 overflow-x-auto shrink-0" role="tablist" aria-label="Seções do corretor" style={{ borderBottom: "1px solid var(--line)" }}>
          {ABAS.map(({ id, rotulo, Icone }) => (
            <button key={id} type="button" role="tab" aria-selected={aba === id} onClick={() => setAba(id)} className="flex items-center gap-2 px-3 py-2.5 text-sm whitespace-nowrap rounded-t-lg"
              style={{ color: aba === id ? "var(--text)" : "var(--text-3)", borderBottom: `2px solid ${aba === id ? "var(--accent)" : "transparent"}`, fontWeight: aba === id ? 600 : 400 }}>
              <Icone className="w-4 h-4" aria-hidden />{rotulo}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {erroCarga && <Aviso tom="erro">{erroCarga}</Aviso>}
          {!dados && !erroCarga && <Carregando linhas={5} />}
          {dados && (
            <>
              {erro && <Aviso tom="erro">{erro}</Aviso>}
              {recado && <Aviso tom="ok">{recado}</Aviso>}

              {aba === "perfil" && (
                <>
                  <Bloco titulo="Foto" descricao="Vem do perfil do WhatsApp do corretor e aparece nas conversas, no fluxo, na agenda e nos clientes.">
                    <div className="flex items-center gap-4">
                      <AvatarCorretor nome={dados.nome} fotoUrl={dados.foto_url} tamanho={96} />
                      <div className="space-y-2">
                        <Botao onClick={atualizarFoto} carregando={salvando === "foto"}><RefreshCw className="w-4 h-4" />Atualizar foto do WhatsApp</Botao>
                        <p className="text-xs" style={{ color: "var(--text-3)" }}>{dados.foto_url ? "Foto do perfil do WhatsApp." : "Sem foto: o WhatsApp do corretor pode estar com a foto oculta."}</p>
                      </div>
                    </div>
                  </Bloco>
                  <Bloco titulo="Dados">
                    <div className="grid sm:grid-cols-2 gap-3">
                      <label className="block text-sm space-y-1"><span style={{ color: "var(--text-2)" }}>Nome</span><Entrada value={nome} onChange={(e) => setNome(e.target.value)} maxLength={255} /></label>
                      <label className="block text-sm space-y-1"><span style={{ color: "var(--text-2)" }}>E-mail</span><Entrada type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@imobiliaria.com.br" /></label>
                      <label className="block text-sm space-y-1"><span style={{ color: "var(--text-2)" }}>Telefone (login do corretor)</span><Entrada value={dados.telefone_mascarado} readOnly disabled /></label>
                      <div className="text-xs space-y-1 pt-6" style={{ color: "var(--text-3)" }}><p>Cadastrado em {dataLonga(dados.criado_em)}</p>{dados.aprovado_em && <p>Aprovado em {dataLonga(dados.aprovado_em)}</p>}</div>
                    </div>
                    <div className="flex justify-end"><Botao variante="primario" onClick={salvarPerfil} disabled={!sujoPerfil} carregando={salvando === "perfil"}>Salvar dados</Botao></div>
                  </Bloco>
                </>
              )}

              {aba === "situacao" && (
                <>
                  <Bloco titulo="Situação do acesso" descricao="Corretor bloqueado não conversa com o agente nem entra no portal do corretor.">
                    <div className="flex flex-wrap items-center gap-3">
                      {st && <Selo tom={st.tom}>{st.rotulo}</Selo>}
                      {dados.recusa_motivo && <span className="text-xs" style={{ color: "var(--text-3)" }}>Motivo: {dados.recusa_motivo}</span>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {dados.status === "active" && <Botao variante="perigo" onClick={() => situacao(false)} carregando={salvando === "situacao"}><XCircle className="w-4 h-4" />Bloquear acesso</Botao>}
                      {dados.status === "blocked" && <Botao variante="primario" onClick={() => situacao(true)} carregando={salvando === "situacao"}><CheckCircle className="w-4 h-4" />Reativar acesso</Botao>}
                      {(dados.status === "pending" || dados.status === "rejected") && (
                        <>
                          <Botao variante="primario" onClick={() => { onAprovar(dados.id); onFechar(); }}><CheckCircle className="w-4 h-4" />Aprovar</Botao>
                          {dados.status === "pending" && <Botao variante="perigo" onClick={() => { onRecusar(dados.id); onFechar(); }}><XCircle className="w-4 h-4" />Recusar</Botao>}
                        </>
                      )}
                    </div>
                  </Bloco>
                  <Bloco titulo="Roleta de leads" descricao="Quando a roleta está ligada, os clientes novos do Imoview são distribuídos em rodízio entre os corretores incluídos.">
                    <Preferencia rotulo="Participa da roleta" ajuda="Recebe clientes novos no rodízio." ligado={dados.roleta.participa} onChange={roleta} disabled={dados.status !== "active" || salvando === "roleta"} />
                    {!dados.roleta.ativa && <Aviso tom="aviso">A roleta geral está desligada em Configurações, então ninguém recebe clientes por rodízio ainda.</Aviso>}
                  </Bloco>
                </>
              )}

              {aba === "assistente" && (
                <>
                  <Bloco titulo="Assistente deste corretor" descricao="Valem para o WhatsApp pessoal conectado pelo corretor.">
                    <Preferencia rotulo="Ler e analisar os atendimentos" ajuda="O assistente observa as conversas com clientes e resume cada atendimento." ligado={dados.assistente.ativo} onChange={(v) => preferencia("ativo", v)} disabled={salvando === "assistente"} />
                    <Preferencia rotulo="Avisar quando um cliente espera resposta" ajuda="Manda um aviso pelo número do agente." ligado={dados.assistente.avisos} onChange={(v) => preferencia("avisos", v)} disabled={salvando === "assistente"} />
                    <Preferencia rotulo="Anotar clientes na carteira" ajuda="Cadastra sozinho quem o corretor atende sobre imóveis." ligado={dados.assistente.carteira_auto} onChange={(v) => preferencia("carteira_auto", v)} disabled={salvando === "assistente"} />
                  </Bloco>
                  <Bloco titulo="WhatsApp pessoal">
                    <dl className="grid sm:grid-cols-3 gap-3 text-sm">
                      <div><dt className="text-xs" style={{ color: "var(--text-3)" }}>Situação</dt><dd className="mt-0.5"><Selo tom={dados.whatsapp_pessoal.status === "connected" ? "ok" : "neutro"}>{WHATS[dados.whatsapp_pessoal.status] ?? dados.whatsapp_pessoal.status}</Selo></dd></div>
                      <div><dt className="text-xs" style={{ color: "var(--text-3)" }}>Número pareado</dt><dd className="mt-0.5">{dados.whatsapp_pessoal.numero || "—"}</dd></div>
                      <div><dt className="text-xs" style={{ color: "var(--text-3)" }}>Visto por último</dt><dd className="mt-0.5">{dataLonga(dados.whatsapp_pessoal.visto_em)}</dd></div>
                    </dl>
                  </Bloco>
                </>
              )}

              {aba === "carteira" && (
                <>
                  <Bloco titulo="Carteira">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <Numero rotulo="Clientes" valor={num(dados.carteira.clientes)} />
                      <Numero rotulo="Clientes quentes" valor={num(dados.carteira.quentes)} />
                      <Numero rotulo="Negócios abertos" valor={num(dados.carteira.negocios_abertos)} />
                      <Numero rotulo="Valor em aberto" valor={dados.carteira.valor_aberto ? brl(dados.carteira.valor_aberto) : "—"} />
                      <Numero rotulo="Negócios ganhos" valor={num(dados.carteira.negocios_ganhos)} />
                      <Numero rotulo="Atividades abertas" valor={num(dados.carteira.atividades_abertas)} />
                      <Numero rotulo="Atividades atrasadas" valor={num(dados.carteira.atrasadas)} destaque={dados.carteira.atrasadas > 0} />
                      <Numero rotulo="Aguardando resposta" valor={num(dados.atividade.aguardando_resposta)} destaque={dados.atividade.aguardando_resposta > 0} />
                    </div>
                  </Bloco>
                  <Bloco titulo="Conversa com o agente (30 dias)" descricao={`Última mensagem: ${dataLonga(dados.atividade.ultima_mensagem_em)}`}>
                    <div className="grid grid-cols-2 gap-2"><Numero rotulo="Mensagens do corretor" valor={num(dados.atividade.recebidas_30d)} /><Numero rotulo="Respostas do agente e da equipe" valor={num(dados.atividade.enviadas_30d)} /></div>
                  </Bloco>
                  <Bloco titulo="Atalhos">
                    <div className="flex flex-wrap gap-2">
                      <Botao onClick={() => { onAbrirConversa(dados.id); onFechar(); }}><MessageCircle className="w-4 h-4" />Abrir conversa</Botao>
                      <Botao onClick={() => setBook(true)} disabled={dados.status !== "active"}><BookOpen className="w-4 h-4" />Enviar book em PDF</Botao>
                    </div>
                    <label className="block text-sm space-y-1">
                      <span style={{ color: "var(--text-2)" }}>Enviar mensagem pelo número do agente</span>
                      <textarea value={mensagem} onChange={(e) => setMensagem(e.target.value)} rows={3} maxLength={4000} placeholder="Escreva o recado para o corretor" className="w-full rounded-xl px-3 py-2 text-sm" style={{ background: "var(--card-2)", border: "1px solid var(--line-2)", color: "var(--text)" }} />
                    </label>
                    <div className="flex justify-end"><Botao variante="primario" onClick={enviarMensagem} disabled={!mensagem.trim() || dados.status !== "active"} carregando={salvando === "mensagem"}><Send className="w-4 h-4" />Enviar mensagem</Botao></div>
                  </Bloco>
                </>
              )}
            </>
          )}
        </div>
      </div>
      {book && dados && (
        <AcoesRapidas
          corretorId={dados.id} corretorNome={dados.nome || "o corretor"} tipoInicial="book" onFechar={() => setBook(false)}
          onEnviado={(_m, falhas) => { setBook(false); mostrar(falhas ? "O book foi enviado, mas houve falha em parte do envio." : "Book enviado ao corretor."); }}
          onAuthError={onAuthError}
        />
      )}
    </div>
  );
}
