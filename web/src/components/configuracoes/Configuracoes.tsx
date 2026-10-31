"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Bell, BookOpen, Brain, Building2, ChevronLeft, CreditCard, Globe, MapPin, Plug, QrCode, Search, Shapes, Shield, Shuffle, Sparkles, Tags, User, Users, AlarmClock,
} from "lucide-react";
import { Selo, useApi } from "./ui";
import { VozSecao, MemoriaSecao } from "./secoes/Acessor";
import { IntegracoesSecao, LembretesSecao } from "./secoes/Canais";
import { PerfilSecao, SegurancaSecao } from "./secoes/Conta";
import { DadosSecao, EquipeSecao, RoletaSecao } from "./secoes/Imobiliaria";
import { BooksSecao } from "./secoes/Books";
import { CamposSecao, LocalidadesSecao, TiposSecao } from "./secoes/Personalizacao";

type Icone = React.ComponentType<{ className?: string }>;
interface Item { id: string; grupo: string; rotulo: string; icone: Icone; palavras: string; emBreve?: boolean }
interface Resumo { slug: string; whatsapp: string; equipe_ativos: number; roleta_ativa: boolean; lembretes_ligados: number }

const ITENS: Item[] = [
  { id: "perfil", grupo: "Conta", rotulo: "Perfil", icone: User, palavras: "nome e-mail foto telefone creci usuário" },
  { id: "seguranca", grupo: "Conta", rotulo: "Segurança", icone: Shield, palavras: "senha trocar resetar excluir conta sessão" },
  { id: "notificacoes", grupo: "Conta", rotulo: "Notificações", icone: Bell, palavras: "avisos alertas", emBreve: true },
  { id: "voz", grupo: "Acessor", rotulo: "Voz e comportamento", icone: Sparkles, palavras: "tom voz áudio frequência persona palavras proibidas especialidades público confirmar agente" },
  { id: "memoria", grupo: "Acessor", rotulo: "Memória", icone: Brain, palavras: "lembrar regras instruções preferências" },
  { id: "dados", grupo: "Imobiliária", rotulo: "Dados da imobiliária", icone: Building2, palavras: "logo cnpj cpf creci comissão telefone horário fuso atendimento contato" },
  { id: "equipe", grupo: "Imobiliária", rotulo: "Equipe", icone: Users, palavras: "administradores corretores convidar papéis acesso" },
  { id: "roleta", grupo: "Imobiliária", rotulo: "Roleta de leads", icone: Shuffle, palavras: "distribuição rodízio leads novos" },
  { id: "plano", grupo: "Imobiliária", rotulo: "Plano & Cobrança", icone: CreditCard, palavras: "assinatura fatura pagamento", emBreve: true },
  { id: "campos", grupo: "Personalização", rotulo: "Campos & Opções", icone: Tags, palavras: "origem lead motivos de perda etiquetas forma de pagamento tipos de imóvel portais listas" },
  { id: "localidades", grupo: "Personalização", rotulo: "Localidades", icone: MapPin, palavras: "cidades bairros regiões" },
  { id: "tipos", grupo: "Personalização", rotulo: "Tipos de atividade", icone: Shapes, palavras: "agenda visita reunião ligação ícone cor" },
  { id: "books", grupo: "Personalização", rotulo: "Books de imóveis", icone: BookOpen, palavras: "pdf book catálogo modelo imóveis fotos capa layout enviar" },
  { id: "whatsapp", grupo: "Canais & Publicação", rotulo: "WhatsApp", icone: QrCode, palavras: "número qr código conectar agente instância" },
  { id: "lembretes", grupo: "Canais & Publicação", rotulo: "Lembretes da agenda", icone: AlarmClock, palavras: "avisos antecedência compromissos mensagem" },
  { id: "integracoes", grupo: "Canais & Publicação", rotulo: "Integrações", icone: Plug, palavras: "imoview google calendar meta ads portais crm sincronizar" },
  { id: "site", grupo: "Canais & Publicação", rotulo: "Meu site", icone: Globe, palavras: "página domínio publicar", emBreve: true },
];

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function Configuracoes({
  secaoInicial = "perfil",
  onSecao,
  onAuthError,
  onIr,
  onSair,
  renderWhatsApp,
}: {
  secaoInicial?: string;
  onSecao?: (id: string) => void;
  onAuthError: (e: unknown) => boolean;
  onIr: (tab: string) => void;
  onSair: () => void;
  renderWhatsApp: () => React.ReactNode;
}) {
  const api = useApi(onAuthError);
  const [secao, setSecao] = useState(ITENS.some((i) => i.id === secaoInicial) ? secaoInicial : "perfil");
  const [busca, setBusca] = useState("");
  const [navMovel, setNavMovel] = useState(false);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  useEffect(() => { onSecao?.(secao); }, [secao, onSecao]);

  useEffect(() => {
    (async () => {
      const r = await api<Resumo>("/admin/configuracoes/resumo");
      if (r.ok && r.dados) setResumo(r.dados);
    })();
  }, [api, secao]);

  const meta = (id: string): string | null => {
    if (!resumo) return null;
    if (id === "equipe") return `${resumo.equipe_ativos} ${resumo.equipe_ativos === 1 ? "ativo" : "ativos"}`;
    if (id === "roleta") return resumo.roleta_ativa ? "Ligada" : "Desligada";
    if (id === "whatsapp") return resumo.whatsapp === "connected" ? "Conectado" : "Desconectado";
    if (id === "lembretes") return resumo.lembretes_ligados ? `${resumo.lembretes_ligados} ${resumo.lembretes_ligados === 1 ? "ligada" : "ligadas"}` : "Desligadas";
    return null;
  };

  const visiveis = useMemo(() => {
    const q = semAcento(busca.trim());
    return q ? ITENS.filter((i) => semAcento(`${i.rotulo} ${i.palavras} ${i.grupo}`).includes(q)) : ITENS;
  }, [busca]);
  const grupos = useMemo(() => {
    const out: { nome: string; itens: Item[] }[] = [];
    for (const i of visiveis) {
      const g = out.find((x) => x.nome === i.grupo);
      if (g) g.itens.push(i); else out.push({ nome: i.grupo, itens: [i] });
    }
    return out;
  }, [visiveis]);

  const atual = ITENS.find((i) => i.id === secao) || ITENS[0];

  const conteudo = () => {
    switch (atual.id) {
      case "perfil": return <PerfilSecao onAuthError={onAuthError} />;
      case "seguranca": return <SegurancaSecao onAuthError={onAuthError} slug={resumo?.slug || ""} onSair={onSair} />;
      case "voz": return <VozSecao onAuthError={onAuthError} />;
      case "memoria": return <MemoriaSecao onAuthError={onAuthError} />;
      case "dados": return <DadosSecao onAuthError={onAuthError} />;
      case "equipe": return <EquipeSecao onAuthError={onAuthError} onIr={onIr} />;
      case "roleta": return <RoletaSecao onAuthError={onAuthError} />;
      case "campos": return <CamposSecao onAuthError={onAuthError} />;
      case "localidades": return <LocalidadesSecao onAuthError={onAuthError} />;
      case "tipos": return <TiposSecao onAuthError={onAuthError} />;
      case "books": return <BooksSecao onAuthError={onAuthError} />;
      case "whatsapp": return renderWhatsApp();
      case "lembretes": return <LembretesSecao onAuthError={onAuthError} />;
      case "integracoes": return <IntegracoesSecao onAuthError={onAuthError} onVerClientes={() => onIr("leads")} />;
      default:
        return (
          <div className="py-16 text-center">
            <Selo>EM BREVE</Selo>
            <h2 className="mt-3 text-2xl font-semibold" style={{ color: "var(--text)" }}>{atual.rotulo}</h2>
            <p className="mt-2 text-sm" style={{ color: "var(--text-3)" }}>Esta seção ainda está em construção.</p>
          </div>
        );
    }
  };

  const escolher = (i: Item) => {
    if (i.emBreve) return;
    setSecao(i.id); setNavMovel(false);
  };

  return (
    <div className="max-w-[1180px] mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight" style={{ color: "var(--text)" }}>Configurações</h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--text-3)" }}>Sua conta, a imobiliária, o Acessor e os canais. Cada ajuste no seu lugar.</p>
      </header>

      <div className="grid lg:grid-cols-[290px_minmax(0,1fr)] gap-x-12 gap-y-6">
        <nav aria-label="Seções das configurações" className={`${navMovel ? "block" : "hidden"} lg:block lg:sticky lg:top-24 self-start`}>
          <label className="relative block mb-5">
            <span className="sr-only">Buscar ajuste</span>
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-4)" }} aria-hidden />
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar ajuste" className="w-full pl-11 pr-4 py-2.5 rounded-full text-sm outline-none border focus:border-[var(--accent)]" style={{ background: "var(--card-2)", borderColor: "var(--line)", color: "var(--text)" }} />
          </label>
          {grupos.length === 0 && <p className="px-2 text-sm" style={{ color: "var(--text-3)" }}>Nenhum ajuste encontrado para “{busca}”.</p>}
          {grupos.map((g) => (
            <div key={g.nome} className="mb-5">
              <p className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-4)" }}>{g.nome}</p>
              <ul className="space-y-0.5">
                {g.itens.map((i) => {
                  const sel = i.id === atual.id;
                  const Icone = i.icone;
                  const m = i.emBreve ? null : meta(i.id);
                  return (
                    <li key={i.id} className="relative">
                      {sel && <span aria-hidden className="hidden lg:block absolute -left-4 top-2 bottom-2 w-[3px] rounded-full" style={{ background: "var(--accent)" }} />}
                      <button type="button" onClick={() => escolher(i)} disabled={i.emBreve} aria-current={sel ? "page" : undefined} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left transition-colors hover:bg-[var(--card-2)] disabled:cursor-not-allowed disabled:hover:bg-transparent" style={{ background: sel ? "var(--hover-solid)" : undefined, color: i.emBreve ? "var(--text-4)" : sel ? "var(--text)" : "var(--text-2)", fontWeight: sel ? 600 : 400 }}>
                        <Icone className="w-[18px] h-[18px] shrink-0" />
                        <span className="flex-1 truncate">{i.rotulo}</span>
                        {i.emBreve ? <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide" style={{ background: "var(--card-2)", color: "var(--text-4)" }}>Em breve</span>
                          : m ? <span className="text-xs" style={{ color: m === "Conectado" || m === "Ligada" ? "var(--accent-text)" : "var(--text-4)" }}>{m}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <main className={`${navMovel ? "hidden" : "block"} lg:block min-w-0 pb-16`}>
          <button type="button" onClick={() => setNavMovel(true)} className="lg:hidden mb-4 inline-flex items-center gap-1 text-sm" style={{ color: "var(--text-3)" }}><ChevronLeft className="w-4 h-4" aria-hidden /> Todas as configurações</button>
          <div key={atual.id} className="assist-rise">{conteudo()}</div>
        </main>
      </div>
    </div>
  );
}
