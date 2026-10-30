"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, Check, Copy, Plus, Shuffle, Upload, User } from "lucide-react";
import { UFS, dataCurta, mascaraDocumento, mascaraTelefone } from "../constantes";
import AvatarCorretor from "../../corretor/AvatarCorretor";
import { Aviso, Botao, Bloco, Cartao, Carregando, Entrada, Iniciais, Interruptor, Linha, Salvar, Selo, Seletor, Titulo, Vazio, reduzirImagem, useApi, useRecado } from "../ui";

/* ---------- Dados da imobiliária ---------- */

interface Imobiliaria {
  tipo_conta: "imobiliaria" | "autonomo";
  nome: string; documento: string; creci_uf: string; creci_numero: string; pais: string; telefone: string;
  email_contato: string; site: string; cidade: string; uf: string; comissao_padrao: number; logo: string | null;
  fuso: string; horario_inicio: string; horario_fim: string; slug: string;
}

const FUSOS = [
  ["America/Sao_Paulo", "Brasília (GMT-3)"], ["America/Manaus", "Manaus (GMT-4)"], ["America/Cuiaba", "Cuiabá (GMT-4)"],
  ["America/Rio_Branco", "Rio Branco (GMT-5)"], ["America/Fortaleza", "Fortaleza (GMT-3)"], ["America/Noronha", "Fernando de Noronha (GMT-2)"],
];

export function DadosSecao({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const api = useApi(onAuthError);
  const [original, setOriginal] = useState<Imobiliaria | null>(null);
  const [f, setF] = useState<Imobiliaria | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, mostrar] = useRecado();
  const arquivo = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    (async () => {
      const r = await api<Imobiliaria>("/admin/configuracoes/imobiliaria");
      if (r.ok && r.dados) { setOriginal(r.dados); setF(r.dados); } else setErro(r.erro);
    })();
  }, [api]);

  const sujo = useMemo(() => JSON.stringify(f) !== JSON.stringify(original), [f, original]);
  if (!f) return <><Titulo titulo="Dados da imobiliária" />{erro ? <Aviso tom="erro">{erro}</Aviso> : <Carregando />}</>;
  const set = <K extends keyof Imobiliaria>(k: K, v: Imobiliaria[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const empresa = f.tipo_conta === "imobiliaria";

  const salvar = async () => {
    setSalvando(true); setErro(null);
    const r = await api<Imobiliaria>("/admin/configuracoes/imobiliaria", { method: "PUT", corpo: f });
    setSalvando(false);
    if (!r.ok || !r.dados) return setErro(r.erro);
    setOriginal(r.dados); setF(r.dados); mostrar("Dados salvos.");
  };

  const escolherLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const a = e.target.files?.[0];
    e.target.value = "";
    if (!a) return;
    try { set("logo", await reduzirImagem(a, 320)); setErro(null); } catch (x) { setErro((x as Error).message); }
  };

  return (
    <>
      <Titulo titulo="Dados da imobiliária" descricao="Identidade, contato e marca que aparecem para os clientes e nos materiais, e a comissão que vale quando o negócio não define a sua." />

      <Bloco titulo="Tipo de conta">
        <div role="radiogroup" aria-label="Tipo de conta" className="flex flex-wrap gap-2">
          {([["imobiliaria", "Imobiliária", Building2], ["autonomo", "Corretor autônomo", User]] as const).map(([id, rotulo, Icone]) => {
            const ativo = f.tipo_conta === id;
            return (
              <button key={id} type="button" role="radio" aria-checked={ativo} onClick={() => { set("tipo_conta", id); set("documento", ""); }} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border text-sm transition-colors" style={{ background: ativo ? "var(--accent-soft)" : "var(--card)", borderColor: ativo ? "var(--accent)" : "var(--line)", color: ativo ? "var(--accent-text)" : "var(--text-2)" }}>
                <Icone className="w-4 h-4" aria-hidden /> {rotulo}
              </button>
            );
          })}
        </div>
      </Bloco>

      <Bloco titulo="Identificação">
        <Cartao>
          <Linha rotulo={empresa ? "Nome da imobiliária" : "Seu nome"} htmlFor="d-nome"><Entrada id="d-nome" value={f.nome} onChange={(e) => set("nome", e.target.value)} maxLength={255} required /></Linha>
          <Linha rotulo={empresa ? "CNPJ" : "CPF"} htmlFor="d-doc"><Entrada id="d-doc" inputMode="numeric" placeholder={empresa ? "00.000.000/0000-00" : "000.000.000-00"} value={mascaraDocumento(f.documento, f.tipo_conta)} onChange={(e) => set("documento", e.target.value.replace(/\D/g, ""))} /></Linha>
          <Linha rotulo="CRECI" htmlFor="d-creci">
            <div className="flex gap-2">
              <Seletor aria-label="UF do CRECI" value={f.creci_uf} onChange={(e) => set("creci_uf", e.target.value)} className="!w-24 shrink-0"><option value="">UF</option>{UFS.map((u) => <option key={u}>{u}</option>)}</Seletor>
              <Entrada id="d-creci" inputMode="numeric" placeholder="123456" value={f.creci_numero} onChange={(e) => set("creci_numero", e.target.value.replace(/\D/g, ""))} maxLength={20} />
            </div>
          </Linha>
          <Linha rotulo="Comissão padrão" htmlFor="d-com" ajuda="Vale quando o negócio não define a própria.">
            <div className="flex items-center gap-2"><Entrada id="d-com" type="number" min={0} max={100} step={0.5} value={f.comissao_padrao} onChange={(e) => set("comissao_padrao", Number(e.target.value))} className="!w-28" /><span className="text-sm" style={{ color: "var(--text-3)" }}>% do valor</span></div>
          </Linha>
        </Cartao>
      </Bloco>

      <Bloco titulo="Logo" descricao="Quadrada, com fundo transparente de preferência.">
        <Cartao>
          <div className="flex flex-wrap items-center gap-5 px-5 py-5">
            <Iniciais nome={f.nome} imagem={f.logo} tamanho={72} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium" style={{ color: "var(--text)" }}>{f.logo ? "Logo enviada" : "Sem logo por enquanto"}</p>
              <p className="text-[13px]" style={{ color: "var(--text-3)" }}>{f.logo ? "Ela aparece no lugar das iniciais." : "Enquanto isso, as iniciais do nome ocupam o lugar."}</p>
            </div>
            <input ref={arquivo} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={escolherLogo} />
            <div className="flex gap-2"><Botao onClick={() => arquivo.current?.click()}><Upload className="w-4 h-4" aria-hidden /> Enviar logo</Botao>{f.logo && <Botao variante="fantasma" onClick={() => set("logo", null)}>Remover</Botao>}</div>
          </div>
        </Cartao>
      </Bloco>

      <Bloco titulo="Contato">
        <Cartao>
          <Linha rotulo="País" htmlFor="d-pais"><Seletor id="d-pais" value={f.pais} onChange={(e) => set("pais", e.target.value)}><option value="+55">+55 Brasil</option><option value="+351">+351 Portugal</option><option value="+1">+1 Estados Unidos</option></Seletor></Linha>
          <Linha rotulo="Telefone" htmlFor="d-tel"><Entrada id="d-tel" inputMode="tel" placeholder="(11) 3000-0000" value={mascaraTelefone(f.telefone)} onChange={(e) => set("telefone", e.target.value.replace(/\D/g, ""))} /></Linha>
          <Linha rotulo="E-mail de contato" htmlFor="d-mail"><Entrada id="d-mail" type="email" value={f.email_contato} onChange={(e) => set("email_contato", e.target.value)} maxLength={255} /></Linha>
          <Linha rotulo="Site" htmlFor="d-site"><Entrada id="d-site" inputMode="url" placeholder="https://" value={f.site} onChange={(e) => set("site", e.target.value)} maxLength={200} /></Linha>
          <Linha rotulo="Cidade e UF" htmlFor="d-cidade">
            <div className="flex gap-2"><Entrada id="d-cidade" value={f.cidade} onChange={(e) => set("cidade", e.target.value)} maxLength={120} /><Seletor aria-label="UF" value={f.uf} onChange={(e) => set("uf", e.target.value)} className="!w-24 shrink-0"><option value="">UF</option>{UFS.map((u) => <option key={u}>{u}</option>)}</Seletor></div>
          </Linha>
        </Cartao>
      </Bloco>

      <Bloco titulo="Atendimento" descricao="O agente só manda avisos e lembretes dentro deste horário.">
        <Cartao>
          <Linha rotulo="Fuso horário" htmlFor="d-fuso"><Seletor id="d-fuso" value={f.fuso} onChange={(e) => set("fuso", e.target.value)}>{FUSOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</Seletor></Linha>
          <Linha rotulo="Horário">
            <div className="flex items-center gap-2"><Entrada type="time" aria-label="Início do atendimento" value={f.horario_inicio} onChange={(e) => set("horario_inicio", e.target.value)} /><span className="text-sm" style={{ color: "var(--text-3)" }}>até</span><Entrada type="time" aria-label="Fim do atendimento" value={f.horario_fim} onChange={(e) => set("horario_fim", e.target.value)} /></div>
          </Linha>
        </Cartao>
      </Bloco>
      <Salvar onSalvar={salvar} salvando={salvando} sujo={sujo} recado={recado} erro={erro} />
    </>
  );
}

/* ---------- Equipe ---------- */

interface Admin { id: string; nome: string; email: string; ativo: boolean; desde: string; foto: string | null; papel: "proprietario" | "admin"; voce: boolean }
interface Corretor { id: string; nome: string | null; telefone_mascarado: string; status: string; desde: string; foto_url?: string | null }
interface Equipe { admins: Admin[]; corretores: Corretor[] }

const PAPEIS = [
  ["Proprietário", "Quem criou a conta. Acesso total e não pode ser desativado."],
  ["Administrador", "Acessa todas as telas do portal e as Configurações, e convida outros administradores."],
  ["Corretor", "Usa o agente pelo WhatsApp e o Portal do Corretor. Aprovação e cadastro ficam na aba Corretores."],
];
const STATUS_CORRETOR: Record<string, [string, "ok" | "aviso" | "perigo" | "neutro"]> = { active: ["Ativo", "ok"], pending: ["Pendente", "aviso"], blocked: ["Bloqueado", "perigo"], rejected: ["Recusado", "perigo"] };

export function EquipeSecao({ onAuthError, onIr }: { onAuthError: (e: unknown) => boolean; onIr: (tab: string) => void }) {
  const api = useApi(onAuthError);
  const [eq, setEq] = useState<Equipe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [convidar, setConvidar] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [rodando, setRodando] = useState(false);
  const [senhaTemp, setSenhaTemp] = useState<{ email: string; senha: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [buscandoFoto, setBuscandoFoto] = useState<string | null>(null);
  const [recadoFoto, mostrarFoto] = useRecado(5000);

  const carregar = useCallback(async () => {
    const r = await api<Equipe>("/admin/configuracoes/equipe");
    if (r.ok && r.dados) setEq(r.dados); else setErro(r.erro);
  }, [api]);
  useEffect(() => { carregar(); }, [carregar]);

  const enviar = async () => {
    setRodando(true); setErro(null);
    const r = await api<{ email: string; senha_temporaria: string }>("/admin/configuracoes/equipe/admins", { method: "POST", corpo: { nome, email } });
    setRodando(false);
    if (!r.ok || !r.dados) return setErro(r.erro);
    setSenhaTemp({ email: r.dados.email, senha: r.dados.senha_temporaria });
    setNome(""); setEmail(""); setConvidar(false); carregar();
  };

  const atualizarFoto = async (c: Corretor) => {
    setBuscandoFoto(c.id);
    const r = await api<{ mensagem: string }>(`/admin/corretores/${c.id}/foto/atualizar`, { method: "POST" });
    setBuscandoFoto(null);
    if (!r.ok || !r.dados) return setErro(r.erro);
    setErro(null); mostrarFoto(r.dados.mensagem); carregar();
  };

  const alternar = async (a: Admin) => {
    const r = await api(`/admin/configuracoes/equipe/admins/${a.id}`, { method: "PATCH", corpo: { ativo: !a.ativo } });
    if (!r.ok) setErro(r.erro); else { setErro(null); carregar(); }
  };

  const ativos = eq ? eq.admins.filter((a) => a.ativo).length : 0;
  return (
    <>
      <Titulo titulo="Equipe" descricao="Administradores com acesso ao portal e os corretores que usam o agente, e o papel de cada um."
        acao={<Botao variante="primario" onClick={() => { setConvidar((v) => !v); setSenhaTemp(null); }}><Plus className="w-4 h-4" aria-hidden /> Convidar administrador</Botao>} />
      {erro && <div className="mb-4"><Aviso tom="erro">{erro}</Aviso></div>}

      {senhaTemp && (
        <div className="mb-5 assist-fade">
          <Aviso tom="ok">
            <p><strong>{senhaTemp.email}</strong> foi cadastrado. Envie esta senha temporária por um canal seguro; ela aparece só agora e a pessoa pode trocá-la em Segurança.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="px-2.5 py-1 rounded-md font-mono text-sm" style={{ background: "var(--card-2)", color: "var(--text)" }}>{senhaTemp.senha}</code>
              <Botao onClick={async () => { await navigator.clipboard?.writeText(senhaTemp.senha).catch(() => undefined); setCopiado(true); setTimeout(() => setCopiado(false), 1600); }}>{copiado ? <Check className="w-4 h-4" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />} {copiado ? "Copiada" : "Copiar"}</Botao>
            </div>
          </Aviso>
        </div>
      )}

      {convidar && (
        <div className="assist-fade mb-5 rounded-2xl p-4 grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
          <div><label htmlFor="e-nome" className="text-xs" style={{ color: "var(--text-3)" }}>Nome</label><Entrada id="e-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={255} /></div>
          <div><label htmlFor="e-mail" className="text-xs" style={{ color: "var(--text-3)" }}>E-mail</label><Entrada id="e-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} /></div>
          <Botao variante="primario" onClick={enviar} carregando={rodando} disabled={!nome.trim() || !email.includes("@")}>Convidar</Botao>
        </div>
      )}

      <Bloco titulo="Pessoas" descricao={eq ? `${ativos} ${ativos === 1 ? "ativa" : "ativas"}` : undefined}>
        {!eq ? <Carregando linhas={2} /> : (
          <Cartao>
            {eq.admins.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <Iniciais nome={a.nome} imagem={a.foto} tamanho={40} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--text)" }}>{a.nome}{a.voce && <span style={{ color: "var(--text-3)", fontWeight: 400 }}> (você)</span>}</p>
                  <p className="text-xs truncate" style={{ color: "var(--text-3)" }}>{a.email} · desde {dataCurta(a.desde)}</p>
                </div>
                <Selo tom={a.papel === "proprietario" ? "info" : "neutro"}>{a.papel === "proprietario" ? "Proprietário" : "Administrador"}</Selo>
                <Selo tom={a.ativo ? "ok" : "aviso"}>{a.ativo ? "Ativo" : "Desativado"}</Selo>
                {!a.voce && a.papel !== "proprietario" && <Botao variante="fantasma" onClick={() => alternar(a)}>{a.ativo ? "Desativar" : "Reativar"}</Botao>}
              </div>
            ))}
          </Cartao>
        )}
      </Bloco>

      <Bloco titulo="Corretores" descricao="Quem usa o agente pelo WhatsApp. Aprovação, cadastro e bloqueio ficam na aba Corretores.">
        {!eq ? null : eq.corretores.length === 0 ? (
          <div className="rounded-2xl" style={{ border: "1px dashed var(--line-2)" }}><Vazio icone={<User className="w-6 h-6" aria-hidden />} titulo="Nenhum corretor ainda" texto="Cadastre os corretores para cada um atender a própria carteira, com o Acessor ajudando todos."><Botao variante="primario" onClick={() => onIr("corretores")}>Cadastrar corretor</Botao></Vazio></div>
        ) : (
          <>
            <Cartao>
              {eq.corretores.map((c) => {
                const [rotulo, tom] = STATUS_CORRETOR[c.status] || [c.status, "neutro" as const];
                return (
                  <div key={c.id} className="flex items-center gap-3 px-5 py-3">
                    <AvatarCorretor nome={c.nome} fotoUrl={c.foto_url} tamanho={36} />
                    <div className="min-w-0 flex-1"><p className="text-sm truncate" style={{ color: "var(--text)" }}>{c.nome || "Aguardando cadastro…"}</p><p className="text-xs" style={{ color: "var(--text-3)" }}>{c.telefone_mascarado} · desde {dataCurta(c.desde)}</p></div>
                    <Selo tom={tom}>{rotulo}</Selo>
                    {c.status === "active" && <Botao variante="fantasma" onClick={() => atualizarFoto(c)} carregando={buscandoFoto === c.id} title="Buscar de novo a foto do perfil do WhatsApp">Atualizar foto</Botao>}
                  </div>
                );
              })}
            </Cartao>
            {recadoFoto && <div className="mt-3"><Aviso tom="ok">{recadoFoto}</Aviso></div>}
            <p className="mt-3 text-xs" style={{ color: "var(--text-3)" }}>A foto de cada corretor é a do perfil do WhatsApp dele, atualizada todo dia. Sem foto visível, aparecem as iniciais.</p>
            <div className="mt-3"><Botao onClick={() => onIr("corretores")}>Gerenciar corretores</Botao></div>
          </>
        )}
      </Bloco>

      <Bloco titulo="O que cada papel pode">
        <Cartao>
          {PAPEIS.map(([p, d]) => (
            <div key={p} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-6 px-5 py-3.5"><p className="sm:w-40 shrink-0 text-sm font-medium" style={{ color: "var(--text)" }}>{p}</p><p className="text-[13px] leading-relaxed" style={{ color: "var(--text-3)" }}>{d}</p></div>
          ))}
        </Cartao>
      </Bloco>
    </>
  );
}

/* ---------- Roleta de leads ---------- */

interface Roleta { ativa: boolean; participantes: string[]; proximo: string | null; elegiveis: { id: string; nome: string }[] }

export function RoletaSecao({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const api = useApi(onAuthError);
  const [roleta, setRoleta] = useState<Roleta | null>(null);
  const [corretores, setCorretores] = useState<{ id: string; nome: string }[]>([]);
  const [participantes, setParticipantes] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [recado, mostrar] = useRecado();

  const carregar = useCallback(async () => {
    const [r, e] = await Promise.all([api<Roleta>("/admin/configuracoes/roleta"), api<Equipe>("/admin/configuracoes/equipe")]);
    if (r.ok && r.dados) { setRoleta(r.dados); setParticipantes(r.dados.participantes); } else setErro(r.erro);
    if (e.dados) setCorretores(e.dados.corretores.filter((c) => c.status === "active").map((c) => ({ id: c.id, nome: c.nome || "Corretor" })));
  }, [api]);
  useEffect(() => { carregar(); }, [carregar]);

  const gravar = async (ativa: boolean, lista: string[]) => {
    setSalvando(true); setErro(null);
    const r = await api<Roleta>("/admin/configuracoes/roleta", { method: "PUT", corpo: { ativa, participantes: lista } });
    setSalvando(false);
    if (!r.ok || !r.dados) { setErro(r.erro); return false; }
    setRoleta(r.dados); setParticipantes(r.dados.participantes); mostrar(ativa ? "Roleta ligada." : "Roleta desligada.");
    return true;
  };

  if (!roleta) return <><Titulo titulo="Roleta de leads" />{erro ? <Aviso tom="erro">{erro}</Aviso> : <Carregando linhas={2} />}</>;
  const nomeDoProximo = corretores.find((c) => c.id === roleta.proximo)?.nome;
  const alterou = JSON.stringify([...participantes].sort()) !== JSON.stringify([...roleta.participantes].sort());

  return (
    <>
      <Titulo titulo="Roleta de leads" descricao="Distribui automaticamente os leads novos sem responsável entre os corretores, em rodízio. Desligada, nada muda: a atribuição continua manual." />
      <Cartao>
        <div className="flex items-center gap-4 px-5 py-5">
          <span className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center" style={{ background: "var(--card-2)", color: roleta.ativa ? "var(--accent)" : "var(--text-3)" }}><Shuffle className="w-5 h-5" aria-hidden /></span>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-semibold" style={{ color: "var(--text)" }}>{roleta.ativa ? "Roleta ligada" : "Roleta desligada"}</p>
            <p className="text-[13px]" style={{ color: "var(--text-3)" }}>{roleta.ativa ? "Leads novos sem responsável vão para o próximo corretor da fila." : "Leads novos chegam sem responsável e alguém atribui na mão."}</p>
          </div>
          <Interruptor ligado={roleta.ativa} onChange={(v) => gravar(v, participantes)} rotulo="Roleta de leads" disabled={salvando} />
        </div>
      </Cartao>
      {erro && <div className="mt-4"><Aviso tom="erro">{erro}</Aviso></div>}

      {roleta.ativa && (
        <div className="assist-fade">
          <Bloco titulo="Quem participa" descricao="Sem ninguém marcado, todos os corretores ativos entram no rodízio.">
            {corretores.length === 0 ? <Aviso tom="aviso">Não há corretores ativos. Aprove ou cadastre corretores na aba Corretores.</Aviso> : (
              <Cartao>
                {corretores.map((c) => {
                  const marcado = participantes.includes(c.id);
                  return (
                    <label key={c.id} className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-[var(--hover-solid)]">
                      <input type="checkbox" checked={marcado} onChange={() => setParticipantes((p) => (marcado ? p.filter((x) => x !== c.id) : [...p, c.id]))} className="w-4 h-4 accent-[var(--accent)]" />
                      <span className="text-sm flex-1" style={{ color: "var(--text)" }}>{c.nome}</span>
                      {roleta.proximo === c.id && <Selo tom="ok">Próximo da fila</Selo>}
                    </label>
                  );
                })}
              </Cartao>
            )}
            <Salvar onSalvar={() => gravar(true, participantes)} salvando={salvando} sujo={alterou} recado={recado} erro={null} rotulo="Salvar participantes" />
          </Bloco>
          <p className="mt-4 text-[13px]" style={{ color: "var(--text-3)" }}>
            {nomeDoProximo ? <>O próximo lead sem responsável vai para <strong style={{ color: "var(--text)" }}>{nomeDoProximo}</strong>. </> : null}
            A roleta vale para clientes criados no portal sem corretor escolhido. Clientes que o corretor anota pelo WhatsApp ficam com ele.
          </p>
        </div>
      )}
    </>
  );
}
