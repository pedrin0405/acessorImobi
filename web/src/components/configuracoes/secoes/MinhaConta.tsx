"use client";

import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { tokenCorretorId } from "@/lib/api";
import AvatarCorretor from "@/components/corretor/AvatarCorretor";
import { atualizarFotosCorretores } from "@/components/corretor/useCorretoresFoto";
import { Aviso, Botao, Bloco, Cartao, Carregando, Entrada, Linha, Salvar, Selo, Titulo, useApi, useRecado } from "../ui";

interface Painel {
  id: string; nome: string | null; email: string | null; telefone: string; telefone_mascarado: string; status: string;
  criado_em: string | null; foto_url: string | null;
}

const dataLonga = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) : "—");

/** Meu perfil: o corretor ajusta o próprio nome, e-mail e foto (a do WhatsApp). O telefone é o login e só a gestão muda. */
export function MeuPerfilSecao({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const api = useApi(onAuthError);
  const eu = tokenCorretorId();
  const [dados, setDados] = useState<Painel | null>(null);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, mostrar] = useRecado();

  const aplicar = (d: Painel) => { setDados(d); setNome(d.nome ?? ""); setEmail(d.email ?? ""); };
  const carregar = useCallback(async () => {
    const r = await api<Painel>(`/admin/corretores/${eu}/painel`);
    if (r.ok && r.dados) aplicar(r.dados); else setErro(r.erro || "Não consegui abrir o seu perfil.");
  }, [api, eu]);
  useEffect(() => { carregar(); }, [carregar]);

  if (!dados) return <><Titulo titulo="Meu perfil" descricao="Como você aparece para a imobiliária e nas conversas." />{erro ? <Aviso tom="erro">{erro}</Aviso> : <Carregando />}</>;
  const sujo = nome.trim() !== (dados.nome ?? "") || email.trim() !== (dados.email ?? "");

  const salvar = async () => {
    setSalvando("perfil"); setErro(null);
    const r = await api<Painel>(`/admin/corretores/${eu}`, { method: "PATCH", corpo: { nome, email } });
    setSalvando(null);
    if (!r.ok || !r.dados) return setErro(r.erro);
    aplicar(r.dados); mostrar("Perfil salvo."); await atualizarFotosCorretores();
  };
  const atualizarFoto = async () => {
    setSalvando("foto"); setErro(null);
    const r = await api(`/admin/corretores/${eu}/foto/atualizar`, { method: "POST" });
    if (!r.ok) { setSalvando(null); return setErro(r.erro); }
    await atualizarFotosCorretores();
    await carregar();
    setSalvando(null);
    mostrar("Foto atualizada pelo WhatsApp.");
  };

  return (
    <>
      <Titulo titulo="Meu perfil" descricao="Como você aparece para a imobiliária e nas conversas." />
      <Cartao className="mb-6">
        <div className="flex items-center gap-4 px-5 py-5">
          <AvatarCorretor nome={dados.nome} fotoUrl={dados.foto_url} tamanho={72} />
          <div className="space-y-2 min-w-0">
            <Botao onClick={atualizarFoto} carregando={salvando === "foto"}><RefreshCw className="w-4 h-4" aria-hidden />Atualizar foto do WhatsApp</Botao>
            <p className="text-xs" style={{ color: "var(--text-3)" }}>{dados.foto_url ? "Foto do seu perfil do WhatsApp." : "Sem foto: o seu WhatsApp pode estar com a foto oculta."}</p>
          </div>
        </div>
      </Cartao>
      <Bloco titulo="Dados">
        <Cartao>
          <Linha rotulo="Nome" htmlFor="mp-nome"><Entrada id="mp-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={255} /></Linha>
          <Linha rotulo="E-mail" htmlFor="mp-mail"><Entrada id="mp-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} /></Linha>
          <Linha rotulo="Telefone" ajuda="É o seu login no portal. Para trocar, fale com a gestão."><span className="text-sm" style={{ color: "var(--text-2)" }}>{dados.telefone_mascarado}</span></Linha>
          <Linha rotulo="Situação"><Selo tom={dados.status === "active" ? "ok" : "aviso"}>{dados.status === "active" ? "Ativo" : dados.status}</Selo></Linha>
          <Linha rotulo="Cadastro"><span className="text-sm" style={{ color: "var(--text-2)" }}>{dataLonga(dados.criado_em)}</span></Linha>
        </Cartao>
      </Bloco>
      <Salvar onSalvar={salvar} salvando={salvando === "perfil"} sujo={sujo} recado={recado} erro={erro} />
    </>
  );
}
