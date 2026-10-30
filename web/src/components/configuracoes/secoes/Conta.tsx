"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Trash2, Upload } from "lucide-react";
import { clearToken, setToken } from "@/lib/api";
import { UFS, mascaraTelefone } from "../constantes";
import { Area, Aviso, Botao, Bloco, Cartao, Carregando, Entrada, EntradaSenha, Iniciais, Linha, Salvar, Seletor, Titulo, reduzirImagem, useApi, useRecado } from "../ui";

interface Perfil {
  id: string;
  nome: string;
  email: string;
  telefone: string;
  creci_uf: string;
  creci_numero: string;
  foto: string | null;
}

export function PerfilSecao({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const api = useApi(onAuthError);
  const [original, setOriginal] = useState<Perfil | null>(null);
  const [f, setF] = useState<Perfil | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, mostrar] = useRecado();
  const arquivo = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    (async () => {
      const r = await api<Perfil>("/admin/configuracoes/perfil");
      if (r.ok && r.dados) { setOriginal(r.dados); setF(r.dados); }
      else if (r.erro) setErro(r.erro);
    })();
  }, [api]);

  const sujo = useMemo(() => JSON.stringify(f) !== JSON.stringify(original), [f, original]);
  if (!f) return <><Titulo titulo="Perfil" descricao="Como você aparece para a equipe e nas conversas." />{erro ? <Aviso tom="erro">{erro}</Aviso> : <Carregando />}</>;
  const set = <K extends keyof Perfil>(k: K, v: Perfil[K]) => setF((x) => (x ? { ...x, [k]: v } : x));

  const escolherFoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const a = e.target.files?.[0];
    e.target.value = "";
    if (!a) return;
    try { set("foto", await reduzirImagem(a, 256)); setErro(null); } catch (x) { setErro((x as Error).message); }
  };

  const salvar = async () => {
    setSalvando(true); setErro(null);
    const r = await api<Perfil & { token: string }>("/admin/configuracoes/perfil", { method: "PUT", corpo: f });
    setSalvando(false);
    if (!r.ok || !r.dados) return setErro(r.erro);
    const { token, ...perfil } = r.dados;
    if (token) setToken(token); // o e-mail faz parte da sessão
    setOriginal(perfil); setF(perfil); mostrar("Perfil salvo.");
  };

  return (
    <>
      <Titulo titulo="Perfil" descricao="Como você aparece para a equipe e nas conversas." />
      <Cartao className="mb-6">
        <div className="flex flex-wrap items-center gap-5 px-5 py-5">
          <Iniciais nome={f.nome} imagem={f.foto} tamanho={72} />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold truncate" style={{ color: "var(--text)" }}>{f.nome || "Sem nome"}</p>
            <p className="text-sm truncate" style={{ color: "var(--text-3)" }}>{f.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <input ref={arquivo} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={escolherFoto} />
            <Botao onClick={() => arquivo.current?.click()}><Upload className="w-4 h-4" aria-hidden /> Alterar foto</Botao>
            {f.foto && <Botao variante="fantasma" onClick={() => set("foto", null)}>Remover</Botao>}
          </div>
        </div>
      </Cartao>

      <Bloco titulo="Dados pessoais">
        <Cartao>
          <Linha rotulo="Nome" htmlFor="p-nome"><Entrada id="p-nome" value={f.nome} onChange={(e) => set("nome", e.target.value)} required maxLength={255} /></Linha>
          <Linha rotulo="E-mail" htmlFor="p-email" ajuda="Usado para entrar."><Entrada id="p-email" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} required maxLength={255} /></Linha>
          <Linha rotulo="Telefone" htmlFor="p-tel"><Entrada id="p-tel" inputMode="tel" placeholder="(63) 99999-9999" value={mascaraTelefone(f.telefone)} onChange={(e) => set("telefone", e.target.value.replace(/\D/g, ""))} /></Linha>
          <Linha rotulo="CRECI" htmlFor="p-creci">
            <div className="flex gap-2">
              <Seletor aria-label="UF do CRECI" value={f.creci_uf} onChange={(e) => set("creci_uf", e.target.value)} className="!w-24 shrink-0"><option value="">UF</option>{UFS.map((u) => <option key={u}>{u}</option>)}</Seletor>
              <Entrada id="p-creci" inputMode="numeric" placeholder="123456" value={f.creci_numero} onChange={(e) => set("creci_numero", e.target.value.replace(/\D/g, ""))} maxLength={20} />
            </div>
          </Linha>
        </Cartao>
      </Bloco>
      <p className="mt-3 text-xs" style={{ color: "var(--text-4)" }}>Nome e e-mail são obrigatórios.</p>
      <Salvar onSalvar={salvar} salvando={salvando} sujo={sujo} recado={recado} erro={erro} />
    </>
  );
}

function AcaoPerigosa({
  titulo, descricao, botao, confirmarComo, rotuloConfirmacao, onConfirmar,
}: {
  titulo: string; descricao: string; botao: string; confirmarComo: string; rotuloConfirmacao: string;
  onConfirmar: (senha: string, confirmacao: string) => Promise<string | null>;
}) {
  const [aberto, setAberto] = useState(false);
  const [senha, setSenha] = useState("");
  const [conf, setConf] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);
  const pronto = senha.length > 0 && conf.trim().toLowerCase() === confirmarComo.toLowerCase();

  const confirmar = async () => {
    setRodando(true); setErro(null);
    const e = await onConfirmar(senha, conf);
    setRodando(false);
    if (e) setErro(e); else { setAberto(false); setSenha(""); setConf(""); }
  };

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <AlertTriangle className="w-[18px] h-[18px] mt-0.5 shrink-0" style={{ color: "var(--danger)" }} aria-hidden />
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>{titulo}</p>
            <p className="text-[13px] mt-0.5 max-w-xl" style={{ color: "var(--text-3)" }}>{descricao}</p>
          </div>
        </div>
        <Botao variante="perigo" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>{botao}</Botao>
      </div>
      {aberto && (
        <div className="assist-fade mt-4 p-4 rounded-xl space-y-3" style={{ background: "var(--card-2)", border: "1px solid var(--line)" }}>
          <div>
            <label className="text-xs" style={{ color: "var(--text-3)" }} htmlFor={`senha-${confirmarComo}`}>Sua senha</label>
            <EntradaSenha id={`senha-${confirmarComo}`} value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" />
          </div>
          <div>
            <label className="text-xs" style={{ color: "var(--text-3)" }} htmlFor={`conf-${confirmarComo}`}>{rotuloConfirmacao}</label>
            <Entrada id={`conf-${confirmarComo}`} value={conf} onChange={(e) => setConf(e.target.value)} placeholder={confirmarComo} autoComplete="off" />
          </div>
          {erro && <p role="alert" className="text-[13px]" style={{ color: "var(--danger)" }}>{erro}</p>}
          <div className="flex justify-end gap-2">
            <Botao variante="fantasma" onClick={() => setAberto(false)}>Cancelar</Botao>
            <Botao variante="perigo" onClick={confirmar} disabled={!pronto} carregando={rodando}><Trash2 className="w-4 h-4" aria-hidden /> {botao.replace("…", "")}</Botao>
          </div>
        </div>
      )}
    </div>
  );
}

export function SegurancaSecao({ onAuthError, slug, onSair }: { onAuthError: (e: unknown) => boolean; slug: string; onSair: () => void }) {
  const api = useApi(onAuthError);
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, mostrar] = useRecado(5000);
  const [resetado, setResetado] = useState<string | null>(null);

  const trocar = async () => {
    setErro(null);
    if (nova.length < 8) return setErro("A nova senha precisa ter pelo menos 8 caracteres.");
    if (nova !== confirmar) return setErro("A confirmação não é igual à nova senha.");
    setSalvando(true);
    const r = await api<{ token: string }>("/admin/configuracoes/senha", { method: "POST", corpo: { atual, nova, confirmar } });
    setSalvando(false);
    if (!r.ok || !r.dados) return setErro(r.erro);
    setToken(r.dados.token); // esta sessão continua; as outras foram encerradas
    setAtual(""); setNova(""); setConfirmar("");
    mostrar("Senha alterada. As sessões nos outros dispositivos foram encerradas.");
  };

  return (
    <>
      <Titulo titulo="Segurança" descricao="Quem entra na sua conta. Troque a senha e, se precisar, resete ou exclua a conta." />
      <Bloco titulo="Senha" descricao="Trocar a senha encerra as sessões abertas nos outros dispositivos.">
        <Cartao>
          <Linha rotulo="Senha atual" htmlFor="s-atual"><EntradaSenha id="s-atual" value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" /></Linha>
          <Linha rotulo="Nova senha" htmlFor="s-nova" ajuda="Mínimo de 8 caracteres."><EntradaSenha id="s-nova" value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" /></Linha>
          <Linha rotulo="Confirmar nova senha" htmlFor="s-conf"><EntradaSenha id="s-conf" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" /></Linha>
        </Cartao>
        <Salvar onSalvar={trocar} salvando={salvando} sujo={!!atual && !!nova && !!confirmar} recado={recado} erro={erro} rotulo="Alterar senha" />
      </Bloco>

      <Bloco titulo="Resetar e excluir" descricao="Ações que não têm volta. Peça a confirmação de quem decide antes de usar.">
        {resetado && <div className="mb-3"><Aviso tom="ok">{resetado}</Aviso></div>}
        <Cartao>
          <AcaoPerigosa
            titulo="Resetar dados do CRM"
            descricao="Apaga clientes, negócios, agenda, notas e conversas com o assistente. Mantém corretores, etapas do funil, imóveis e o histórico do WhatsApp."
            botao="Resetar dados…" confirmarComo="RESETAR" rotuloConfirmacao="Digite RESETAR para confirmar"
            onConfirmar={async (senha, confirmacao) => {
              const r = await api<{ apagados: Record<string, number> }>("/admin/configuracoes/resetar", { method: "POST", corpo: { senha, confirmacao } });
              if (!r.ok) return r.erro;
              const total = Object.values(r.dados?.apagados || {}).reduce((a, b) => a + b, 0);
              setResetado(`Dados do CRM apagados (${total} registros).`);
              return null;
            }}
          />
          <AcaoPerigosa
            titulo="Excluir conta"
            descricao="Suspende a conta agora e agenda a exclusão definitiva dos dados da imobiliária. Você será desconectado."
            botao="Excluir conta…" confirmarComo={slug} rotuloConfirmacao="Digite o endereço da imobiliária para confirmar"
            onConfirmar={async (senha, confirmacao) => {
              const r = await api("/admin/configuracoes/excluir", { method: "POST", corpo: { senha, confirmacao } });
              if (!r.ok) return r.erro;
              clearToken(); onSair();
              return null;
            }}
          />
        </Cartao>
      </Bloco>
    </>
  );
}
