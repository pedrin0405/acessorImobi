"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Search,
  Copy,
  Check,
  MessageSquare,
  Building2,
  Users,
  RefreshCw,
  Loader2,
  CheckCheck,
  Mic,
  ImageIcon,
  FileText,
  MessagesSquare,
  Smartphone,
} from "lucide-react";
import { fetchApi, AuthError, clearToken, tokenRole, tokenSub } from "@/lib/api";
import LoginForm from "@/components/LoginForm";
import AppShell from "@/components/shell/AppShell";
import Atendimentos from "@/components/corretor/Atendimentos";
import MeuWhatsApp from "@/components/corretor/MeuWhatsApp";

interface Imovel {
  codigo: number;
  tipo: string;
  bairro: string;
  cidade: string;
  area_m2: number;
  quartos: number;
  vagas: number;
  valor: number;
  situacao: string;
  link_anuncio: string;
  resumo_texto: string;
}

interface Mensagem {
  id: string;
  direcao: "inbound" | "outbound" | string;
  tipo: string;
  conteudo: string | null;
  status: string;
  created_at: string | null;
}

export default function CorretorPortalPage() {
  const [authed, setAuthed] = useState(false);
  const [checkedAuth, setCheckedAuth] = useState(false);
  const [tab, setTab] = useState<"atendimentos" | "imoveis" | "clientes" | "historico" | "whatsapp">("atendimentos");

  // Usado pelos componentes do assistente: sessão expirada volta para o login.
  const tratarAuthError = (e: unknown) => {
    if (e instanceof AuthError) {
      clearToken();
      setAuthed(false);
      return true;
    }
    return false;
  };

  // Filtros imóveis
  const [finalidade, setFinalidade] = useState("aluguel");
  const [bairro, setBairro] = useState("");
  const [tipo, setTipo] = useState("");
  const [quartos, setQuartos] = useState("");
  const [valorMax, setValorMax] = useState("");
  const [imoveis, setImoveis] = useState<Imovel[]>([]);
  const [loadingImoveis, setLoadingImoveis] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Clientes
  const [termoCliente, setTermoCliente] = useState("");
  const [clientes, setClientes] = useState<any[]>([]);
  const [loadingClientes, setLoadingClientes] = useState(false);

  // Conversa com o agente (estilo WhatsApp)
  const [historico, setHistorico] = useState<Mensagem[]>([]);
  const [loadingHistorico, setLoadingHistorico] = useState(false);
  const [historicoErro, setHistoricoErro] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const carregarHistorico = async () => {
    setLoadingHistorico(true);
    setHistoricoErro(null);
    try {
      const res = await fetchApi("/corretor/historico?limit=100");
      if (res.ok) {
        setHistorico(await res.json());
      } else {
        setHistoricoErro("Não foi possível carregar sua conversa.");
      }
    } catch (e) {
      if (e instanceof AuthError) {
        clearToken();
        setAuthed(false);
      } else {
        setHistoricoErro("Falha na comunicação com a API.");
      }
    } finally {
      setLoadingHistorico(false);
    }
  };

  const buscarImoveis = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoadingImoveis(true);
    try {
      const params = new URLSearchParams({ finalidade });
      if (bairro) params.set("bairro", bairro);
      if (tipo) params.set("tipo", tipo);
      if (quartos) params.set("quartos_min", quartos);
      if (valorMax) params.set("valor_max", valorMax);

      const res = await fetchApi(`/corretor/imoveis?${params.toString()}`);
      if (res.ok) {
        setImoveis(await res.json());
      }
    } catch (e) {
      if (e instanceof AuthError) {
        clearToken();
        setAuthed(false);
      } else {
        console.error(e);
      }
    } finally {
      setLoadingImoveis(false);
    }
  };

  const buscarClientes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!termoCliente) return;
    setLoadingClientes(true);
    try {
      const res = await fetchApi(`/corretor/clientes?q=${encodeURIComponent(termoCliente)}`);
      if (res.ok) {
        setClientes(await res.json());
      }
    } catch (e) {
      if (e instanceof AuthError) {
        clearToken();
        setAuthed(false);
      } else {
        console.error(e);
      }
    } finally {
      setLoadingClientes(false);
    }
  };

  const copiarTexto = (im: Imovel) => {
    navigator.clipboard.writeText(im.resumo_texto);
    setCopiedId(im.codigo);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatarHora = (iso: string | null) => {
    if (!iso) return "";
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const conteudoMensagem = (m: Mensagem) => {
    if (m.conteudo) return m.conteudo;
    if (m.tipo === "audio") return "🎤 Áudio";
    if (m.tipo === "image") return "📷 Foto";
    if (m.tipo === "document") return "📄 Documento";
    return "(mensagem sem texto)";
  };

  useEffect(() => {
    setAuthed(tokenRole() === "corretor");
    setCheckedAuth(true);
  }, []);

  useEffect(() => {
    if (!authed || tab !== "historico") return;
    carregarHistorico();

    const timer = setInterval(() => {
      carregarHistorico();
    }, 8000);

    return () => clearInterval(timer);
  }, [authed, tab]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [historico]);

  if (!authed) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <LoginForm mode="corretor" onSuccess={() => setAuthed(true)} />
      </div>
    );
  }

  return (
    <AppShell
      marca="Acessor"
      subtitulo="Portal do corretor"
      ativo={tab}
      onSelecionar={(id) => setTab(id as typeof tab)}
      grupos={[
        {
          itens: [
            { id: "atendimentos", rotulo: "Atendimentos", icone: MessagesSquare },
            { id: "imoveis", rotulo: "Imóveis", icone: Building2 },
            { id: "clientes", rotulo: "Clientes no Imoview", icone: Users },
          ],
        },
        { titulo: "Agente", itens: [{ id: "historico", rotulo: "Conversas com o agente", icone: MessageSquare }] },
      ]}
      rodape={[{ id: "whatsapp", rotulo: "Meu WhatsApp", icone: Smartphone }]}
      usuario={{ nome: tokenSub() || "Corretor", papel: "Corretor" }}
      onSair={() => {
        clearToken();
        setAuthed(false);
      }}
    >

        {tab === "atendimentos" && <Atendimentos onAuthError={tratarAuthError} />}
        {tab === "whatsapp" && <MeuWhatsApp onAuthError={tratarAuthError} />}

        {/* Tab Imóveis */}
        {tab === "imoveis" && (
          <div className="space-y-6">
            {/* Filtros */}
            <form onSubmit={buscarImoveis} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-5 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Finalidade</label>
                <select
                  value={finalidade}
                  onChange={(e) => setFinalidade(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-amber-600"
                >
                  <option value="aluguel">Aluguel</option>
                  <option value="venda">Venda</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Bairro</label>
                <input
                  type="text"
                  placeholder="Ex: Centro"
                  value={bairro}
                  onChange={(e) => setBairro(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-amber-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Tipo</label>
                <input
                  type="text"
                  placeholder="Ex: Apartamento"
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-amber-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Mín. Quartos</label>
                <input
                  type="number"
                  placeholder="2"
                  value={quartos}
                  onChange={(e) => setQuartos(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-amber-600"
                />
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={loadingImoveis}
                  className="w-full py-2 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-lg text-sm shadow-md flex items-center justify-center gap-2"
                >
                  <Search className="w-4 h-4" /> Buscar
                </button>
              </div>
            </form>

            {/* Lista de Imóveis */}
            <div className="space-y-4">
              {loadingImoveis ? (
                <div className="p-12 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">
                  Pesquisando imóveis disponíveis...
                </div>
              ) : imoveis.length === 0 ? (
                <div className="p-12 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">
                  Nenhum imóvel encontrado. Utilize os filtros acima para consultar.
                </div>
              ) : (
                imoveis.map((im) => (
                  <div key={im.codigo} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-lg text-slate-900">{im.tipo} no {im.bairro}</span>
                        <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-mono">
                          Cód: {im.codigo}
                        </span>
                      </div>
                      <div className="text-sm text-slate-600 flex items-center gap-4">
                        {im.quartos && <span>🛏️ {im.quartos} quartos</span>}
                        {im.vagas && <span>🚗 {im.vagas} vagas</span>}
                        {im.area_m2 && <span>📐 {im.area_m2}m²</span>}
                      </div>
                      <div className="text-lg font-extrabold text-amber-600">
                        R$ {im.valor?.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </div>
                    </div>

                    <button
                      onClick={() => copiarTexto(im)}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                        copiedId === im.codigo
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-900 hover:bg-slate-800 text-white shadow-sm"
                      }`}
                    >
                      {copiedId === im.codigo ? (
                        <>
                          <Check className="w-4 h-4" /> Copiado!
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" /> Copiar para WhatsApp
                        </>
                      )}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Tab Clientes */}
        {tab === "clientes" && (
          <div className="space-y-6">
            <form onSubmit={buscarClientes} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex gap-4">
              <input
                type="text"
                placeholder="Busque por nome, telefone, e-mail ou código do cliente..."
                value={termoCliente}
                onChange={(e) => setTermoCliente(e.target.value)}
                className="flex-1 px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-amber-600"
              />
              <button
                type="submit"
                disabled={loadingClientes}
                className="px-6 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-xl text-sm shadow-md flex items-center gap-2"
              >
                <Search className="w-4 h-4" /> Buscar
              </button>
            </form>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
              {clientes.length === 0 ? (
                <div className="p-12 text-center text-slate-400">
                  Nenhum cliente consultado ainda.
                </div>
              ) : (
                clientes.map((c) => (
                  <div key={c.codigo} className="p-6 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-slate-900">{c.nome}</div>
                      <div className="text-xs text-slate-500 mt-1">
                        Tel: {c.telefone_mascarado} • {c.email || "Sem e-mail"}
                      </div>
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-mono">
                      Cód: {c.codigo}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        {/* Tab Conversas */}
        {tab === "historico" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-amber-600" /> Conversa com o Acessor
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Histórico das mensagens trocadas com o agente virtual pelo WhatsApp.
                </p>
              </div>
              <button
                onClick={carregarHistorico}
                disabled={loadingHistorico}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${loadingHistorico ? "animate-spin" : ""}`} />
                Atualizar
              </button>
            </div>

            {historicoErro && (
              <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">
                {historicoErro}
              </div>
            )}

            <div className="h-[560px] flex flex-col bg-[#efeae2]">
              <div className="flex-1 overflow-y-auto px-4 py-5 space-y-2">
                {loadingHistorico && historico.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-500 gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-sm">Carregando conversa...</span>
                  </div>
                ) : historico.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center px-8 gap-3">
                    <div className="w-14 h-14 rounded-full bg-white/70 flex items-center justify-center">
                      <MessageSquare className="w-7 h-7 text-slate-400" />
                    </div>
                    <p className="text-sm font-medium text-slate-700">Nenhuma mensagem ainda</p>
                    <p className="text-xs text-slate-500 max-w-xs">
                      Envie uma mensagem para o WhatsApp do agente para iniciar a conversa. As respostas
                      aparecerão aqui.
                    </p>
                  </div>
                ) : (
                  <>
                    {historico.map((m) => {
                      const doCorretor = m.direcao === "inbound";
                      return (
                        <div
                          key={m.id}
                          className={`flex ${doCorretor ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[78%] px-3 py-2 shadow-sm text-sm whitespace-pre-wrap break-words ${
                              doCorretor
                                ? "bg-amber-100 text-slate-800 rounded-2xl rounded-tr-sm"
                                : "bg-white text-slate-800 rounded-2xl rounded-tl-sm"
                            }`}
                          >
                            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mb-0.5">
                              {m.tipo === "audio" && <Mic className="w-3 h-3" />}
                              {m.tipo === "image" && <ImageIcon className="w-3 h-3" />}
                              {m.tipo === "document" && <FileText className="w-3 h-3" />}
                              <span>{doCorretor ? "Você" : "Acessor"}</span>
                            </div>
                            <p>{conteudoMensagem(m)}</p>
                            <div
                              className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${
                                doCorretor ? "text-amber-800/60" : "text-slate-400"
                              }`}
                            >
                              <span>{formatarHora(m.created_at)}</span>
                              {doCorretor && <CheckCheck className="w-3.5 h-3.5" />}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={chatEndRef} />
                  </>
                )}
              </div>
              <div className="px-4 py-2.5 bg-white border-t border-slate-200 text-[11px] text-slate-500 text-center">
                O Acessor responde automaticamente. Para enviar uma nova mensagem, use o WhatsApp.
              </div>
            </div>
          </div>
        )}
    </AppShell>
  );
}
