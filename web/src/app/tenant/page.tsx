"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Users,
  Home,
  LayoutGrid,
  Handshake,
  CalendarDays,
  Contact,
  CheckCircle,
  XCircle,
  Sliders,
  History,
  AlertTriangle,
  RefreshCw,
  PlusCircle,
  QrCode,
  Smartphone,
  WifiOff,
  Loader2,
  MessageSquare,
  ArrowLeft,
  CheckCheck,
  Mic,
  ImageIcon,
  FileText,
} from "lucide-react";
import { fetchApi, AuthError, clearToken, tokenRole, tokenSub } from "@/lib/api";
import LoginForm from "@/components/LoginForm";
import AppShell from "@/components/shell/AppShell";
import ChatMensagens from "@/components/crm/ChatMensagens";
import Inicio from "@/components/crm/Inicio";
import VisaoGeral from "@/components/crm/VisaoGeral";
import AgenteConfig from "@/components/crm/AgenteConfig";
import Agenda from "@/components/crm/Agenda";
import Leads from "@/components/crm/Leads";
import Negociacoes from "@/components/crm/Negociacoes";

interface Corretor {
  id: string;
  nome: string | null;
  email: string | null;
  telefone_mascarado: string;
  status: string;
  created_at: string;
}

interface ConversaResumo {
  corretor_id: string;
  corretor_nome: string | null;
  telefone_mascarado: string;
  corretor_status: string;
  ultima_mensagem: string | null;
  ultima_direcao: "inbound" | "outbound" | string;
  ultimo_tipo: string;
  ultima_em: string | null;
  nao_respondidas: number;
}

interface Mensagem {
  id: string;
  direcao: "inbound" | "outbound" | string;
  tipo: string;
  conteudo: string | null;
  status: string;
  created_at: string | null;
  midia?: string | null;
}

interface WhatsAppStatus {
  status: "not_provisioned" | "connected" | "qr_pending" | "disconnected" | string;
  instance_id: string | null;
  numero: string | null;
  qr_code: string | null;
  pairing_code?: string | null;
  degradado?: boolean;
  mensagem?: string;
  evolution_state?: string | null;
}

const ABAS = ["inicio", "visao", "conversas", "negociacoes", "agenda", "leads", "corretores", "whatsapp", "agente", "auditoria", "pendencias"] as const;
type Aba = (typeof ABAS)[number];

export default function TenantAdminPage() {
  const [authed, setAuthed] = useState(false);
  const [checkedAuth, setCheckedAuth] = useState(false);
  const [tab, setTab] = useState<Aba>("inicio");
  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [loading, setLoading] = useState(false);

  // Conversas (preview estilo WhatsApp)
  const [conversas, setConversas] = useState<ConversaResumo[]>([]);
  const [conversaSel, setConversaSel] = useState<ConversaResumo | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [loadingConversas, setLoadingConversas] = useState(false);
  const [loadingMensagens, setLoadingMensagens] = useState(false);
  const [conversaErro, setConversaErro] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Modal novo corretor
  const [novoCorretorOpen, setNovoCorretorOpen] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoTelefone, setNovoTelefone] = useState("");
  const [novoEmail, setNovoEmail] = useState("");
  const [novoErro, setNovoErro] = useState<string | null>(null);
  const [salvandoCorretor, setSalvandoCorretor] = useState(false);

  // Conexão do WhatsApp
  const [whatsapp, setWhatsapp] = useState<WhatsAppStatus | null>(null);
  const [whatsappLoading, setWhatsappLoading] = useState(false);
  const [whatsappErro, setWhatsappErro] = useState<string | null>(null);
  const [numeroPareamento, setNumeroPareamento] = useState("");
  const [whatsappAcao, setWhatsappAcao] = useState(false);

  // Modal recusa
  const [recusaModalOpen, setRecusaModalOpen] = useState(false);
  const [recusaId, setRecusaId] = useState<string | null>(null);
  const [recusaMotivo, setRecusaMotivo] = useState("");

  // Auditoria e pendências
  const [auditoria, setAuditoria] = useState<any[]>([]);
  const [pendencias, setPendencias] = useState<any[]>([]);

  const totalSemResposta = conversas.reduce((soma, c) => soma + (c.nao_respondidas || 0), 0);

  // Usado pelos componentes de CRM: sessão expirada volta para o login.
  const tratarAuthError = (e: unknown) => {
    if (e instanceof AuthError) {
      clearToken();
      setAuthed(false);
      return true;
    }
    return false;
  };

  const loadCorretores = async () => {
    setLoading(true);
    try {
      const res = await fetchApi("/admin/corretores");
      if (res.ok) {
        setCorretores(await res.json());
        setAuthed(true);
      }
    } catch (e) {
      if (e instanceof AuthError) {
        clearToken();
        setAuthed(false);
      } else {
        console.error(e);
      }
    } finally {
      setLoading(false);
      setCheckedAuth(true);
    }
  };

  const loadConversas = async () => {
    setLoadingConversas(true);
    setConversaErro(null);
    try {
      const res = await fetchApi("/admin/conversas");
      if (res.ok) {
        const data: ConversaResumo[] = await res.json();
        setConversas(data);
        setAuthed(true);
        setConversaSel((atual) =>
          atual ? data.find((c) => c.corretor_id === atual.corretor_id) ?? null : null
        );
      } else {
        setConversaErro("Não foi possível carregar as conversas.");
      }
    } catch (e) {
      if (e instanceof AuthError) {
        clearToken();
        setAuthed(false);
      } else {
        setConversaErro("Falha na comunicação com a API.");
      }
    } finally {
      setLoadingConversas(false);
    }
  };

  const abrirConversa = async (conversa: ConversaResumo) => {
    setConversaSel(conversa);
    setLoadingMensagens(true);
    setConversaErro(null);
    try {
      const res = await fetchApi(
        `/admin/conversas/${conversa.corretor_id}/mensagens?limit=200`
      );
      if (res.ok) {
        const data = await res.json();
        setMensagens(data.mensagens || []);
      } else {
        setMensagens([]);
        setConversaErro("Não foi possível carregar as mensagens desta conversa.");
      }
    } catch (e) {
      if (e instanceof AuthError) {
        clearToken();
        setAuthed(false);
      } else {
        setConversaErro("Falha na comunicação com a API.");
      }
    } finally {
      setLoadingMensagens(false);
    }
  };

  const atualizarConversaAtual = async () => {
    if (!conversaSel) return;
    await loadConversas();
    await abrirConversa(conversaSel);
  };

  const loadAuditoria = async () => {
    try {
      const res = await fetchApi("/admin/auditoria");
      if (res.ok) {
        const data = await res.json();
        setAuditoria(data.items || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadPendencias = async () => {
    try {
      const res = await fetchApi("/admin/pendencias");
      if (res.ok) {
        setPendencias(await res.json());
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadWhatsApp = async () => {
    setWhatsappLoading(true);
    try {
      const res = await fetchApi("/admin/whatsapp");
      if (res.ok) {
        setWhatsapp(await res.json());
        setWhatsappErro(null);
      }
    } catch (e) {
      if (e instanceof AuthError) {
        clearToken();
        setAuthed(false);
      } else {
        setWhatsappErro("Não foi possível consultar o status do WhatsApp.");
      }
    } finally {
      setWhatsappLoading(false);
    }
  };

  const handleCriarCorretor = async (e: React.FormEvent) => {
    e.preventDefault();
    setNovoErro(null);
    setSalvandoCorretor(true);

    try {
      const res = await fetchApi("/admin/corretores", {
        method: "POST",
        body: JSON.stringify({
          nome: novoNome,
          telefone: novoTelefone,
          email: novoEmail || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setNovoCorretorOpen(false);
        setNovoNome("");
        setNovoTelefone("");
        setNovoEmail("");
        await loadCorretores();
      } else {
        setNovoErro(data.detail || "Não foi possível cadastrar o corretor.");
      }
    } catch (err) {
      if (err instanceof AuthError) {
        clearToken();
        setAuthed(false);
        setNovoCorretorOpen(false);
      } else {
        setNovoErro("Falha na comunicação com a API.");
      }
    } finally {
      setSalvandoCorretor(false);
    }
  };

  const handleConectarWhatsApp = async (numero?: string) => {
    setWhatsappAcao(true);
    setWhatsappErro(null);

    try {
      const res = await fetchApi("/admin/whatsapp/conectar", {
        method: "POST",
        body: JSON.stringify(numero ? { numero } : {}),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setWhatsapp(data);
      } else {
        setWhatsappErro(data.detail || "Não foi possível gerar o QR code.");
      }
    } catch (err) {
      if (err instanceof AuthError) {
        clearToken();
        setAuthed(false);
      } else {
        setWhatsappErro("Falha na comunicação com o serviço de WhatsApp.");
      }
    } finally {
      setWhatsappAcao(false);
    }
  };

  const handleDesconectarWhatsApp = async () => {
    if (!confirm("Desconectar o WhatsApp deste agente? O agente ficará sem atender até reconectar.")) {
      return;
    }
    setWhatsappAcao(true);
    setWhatsappErro(null);

    try {
      const res = await fetchApi("/admin/whatsapp/desconectar", { method: "POST" });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setWhatsapp(data);
      } else {
        setWhatsappErro(data.detail || "Não foi possível desconectar o WhatsApp.");
      }
    } catch (err) {
      if (err instanceof AuthError) {
        clearToken();
        setAuthed(false);
      } else {
        setWhatsappErro("Falha na comunicação com o serviço de WhatsApp.");
      }
    } finally {
      setWhatsappAcao(false);
    }
  };

  // Mantém a aba ativa ao recarregar a página (ex.: #agente).
  useEffect(() => {
    const salva = window.location.hash.replace("#", "");
    if (ABAS.includes(salva as Aba)) setTab(salva as Aba);
  }, []);

  useEffect(() => {
    if (window.location.hash !== `#${tab}`) {
      window.history.replaceState(null, "", `#${tab}`);
    }
  }, [tab]);

  useEffect(() => {
    if (tokenRole() !== "admin") {
      setCheckedAuth(true);
      setLoading(false);
      return;
    }
    // O token é de admin: entra já (a API recusa com 401 se ele expirou).
    setAuthed(true);
    setCheckedAuth(true);
    if (tab === "conversas" || tab === "inicio") loadConversas();
    if (tab === "corretores") loadCorretores();
    if (tab === "whatsapp") loadWhatsApp();
    if (tab === "auditoria") loadAuditoria();
    if (tab === "pendencias") loadPendencias();
  }, [tab]);

  // Enquanto o QR está pendente, consulta o status até o celular concluir o pareamento.
  useEffect(() => {
    if (!authed || tab !== "whatsapp" || whatsapp?.status !== "qr_pending") return;

    const timer = setInterval(() => {
      loadWhatsApp();
    }, 4000);

    return () => clearInterval(timer);
  }, [authed, tab, whatsapp?.status]);

  // Atualiza a lista de conversas periodicamente (sem auditar conteúdo).
  useEffect(() => {
    if (!authed || tab !== "conversas") return;

    const timer = setInterval(() => {
      loadConversas();
    }, 8000);

    return () => clearInterval(timer);
  }, [authed, tab]);

  // Mantém o fim da conversa visível ao abrir ou atualizar o histórico.
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  if (!authed) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <LoginForm
          mode="admin"
          onSuccess={() => {
            setAuthed(true);
            loadConversas();
          }}
        />
      </div>
    );
  }

  const handleDecidir = async (corretorId: string, aprovado: boolean, motivo?: string) => {
    try {
      const res = await fetchApi(`/admin/corretores/${corretorId}/decisao`, {
        method: "PATCH",
        body: JSON.stringify({ aprovado, motivo }),
      });
      if (res.ok) {
        loadCorretores();
      } else {
        const err = await res.json();
        alert(err.detail || "Erro ao registrar decisão");
      }
    } catch (e) {
      alert("Falha na comunicação");
    }
  };

  const qrSrc = whatsapp?.qr_code
    ? whatsapp.qr_code.startsWith("data:image")
      ? whatsapp.qr_code
      : `data:image/png;base64,${whatsapp.qr_code}`
    : null;

  const formatarHora = (iso: string | null) => {
    if (!iso) return "";
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatarData = (iso: string | null) => {
    if (!iso) return "";
    const data = new Date(iso);
    const hoje = new Date();
    const mesmoDia = data.toDateString() === hoje.toDateString();
    return mesmoDia
      ? formatarHora(iso)
      : data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  };

  const previewMensagem = (conversa: ConversaResumo) => {
    if (!conversa.ultima_mensagem) {
      if (conversa.ultimo_tipo === "audio") return "🎤 Áudio";
      if (conversa.ultimo_tipo === "image") return "📷 Foto";
      if (conversa.ultimo_tipo === "document") return "📄 Documento";
      return "Sem prévia";
    }
    const prefixo = conversa.ultima_direcao === "outbound" ? "Acessor: " : "";
    if (conversa.ultimo_tipo === "image") {
      const titulo = conversa.ultima_mensagem.split("\n")[0].replace(/^[^A-Za-z0-9À-ÿ]+/, "").replace(/\*/g, "").trim();
      return `${prefixo}📷 ${titulo || "Foto"}`;
    }
    if (conversa.ultimo_tipo === "audio") return `${prefixo}🎤 ${conversa.ultima_mensagem}`;
    return `${prefixo}${conversa.ultima_mensagem.replace(/\*/g, "")}`;
  };

  return (
    <AppShell
      marca="Acessor"
      subtitulo="Portal da imobiliária"
      ativo={tab}
      onSelecionar={(id) => setTab(id as Aba)}
      grupos={[
        {
          itens: [
            { id: "inicio", rotulo: "Início", icone: Home },
            { id: "visao", rotulo: "Visão Geral", icone: LayoutGrid },
            { id: "conversas", rotulo: "Conversas", icone: MessageSquare, contador: totalSemResposta || undefined },
            { id: "leads", rotulo: "Clientes", icone: Contact },
            { id: "negociacoes", rotulo: "Negociações", icone: Handshake },
            { id: "agenda", rotulo: "Agenda", icone: CalendarDays },
          ],
        },
        { titulo: "Equipe", itens: [{ id: "corretores", rotulo: "Corretores", icone: Users }] },
        {
          titulo: "Controle",
          itens: [
            { id: "auditoria", rotulo: "Auditoria", icone: History },
            { id: "pendencias", rotulo: "Pendências", icone: AlertTriangle },
          ],
        },
      ]}
      rodape={[
        { id: "agente", rotulo: "Agente", icone: Sliders },
        { id: "whatsapp", rotulo: "WhatsApp", icone: QrCode },
      ]}
      usuario={{ nome: tokenSub() || "Administrador", papel: "Administrador da imobiliária" }}
      onSair={() => {
        clearToken();
        setAuthed(false);
      }}
    >
        {tab === "inicio" && <Inicio nome={tokenSub().split("@")[0] || "equipe"} onIr={(id) => setTab(id as Aba)} onAuthError={tratarAuthError} />}
        {tab === "visao" && <VisaoGeral onAuthError={tratarAuthError} />}

        {/* Tab Conversas */}
        {tab === "conversas" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-900">Conversas do WhatsApp</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Acompanhe as mensagens trocadas entre o agente Acessor e os corretores da imobiliária.
                </p>
              </div>
              <button
                onClick={atualizarConversaAtual}
                disabled={loadingConversas || loadingMensagens}
                className="flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 transition-colors"
              >
                <RefreshCw
                  className={`w-4 h-4 ${loadingConversas || loadingMensagens ? "animate-spin" : ""}`}
                />
                Atualizar
              </button>
            </div>

            {conversaErro && (
              <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{conversaErro}</span>
              </div>
            )}

            <div className="flex h-[600px] border-t border-slate-100">
              {/* Lista de conversas */}
              <aside
                className={`${
                  conversaSel ? "hidden md:flex" : "flex"
                } w-full md:w-[330px] shrink-0 flex-col border-r border-slate-200 bg-white`}
              >
                {loadingConversas && conversas.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-2">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span className="text-sm">Carregando conversas...</span>
                  </div>
                ) : conversas.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-3">
                    <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center">
                      <MessageSquare className="w-7 h-7 text-slate-400" />
                    </div>
                    <p className="text-sm font-medium text-slate-700">Nenhuma conversa ainda</p>
                    <p className="text-xs text-slate-500">
                      Quando um corretor enviar mensagem para o WhatsApp do agente, a conversa aparece aqui.
                    </p>
                    <button
                      onClick={() => setTab("whatsapp")}
                      className="mt-1 text-xs font-medium text-emerald-700 hover:text-emerald-600 underline underline-offset-2"
                    >
                      Verificar conexão do WhatsApp
                    </button>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                    {conversas.map((c) => {
                      const ativa = conversaSel?.corretor_id === c.corretor_id;
                      return (
                        <button
                          key={c.corretor_id}
                          onClick={() => abrirConversa(c)}
                          className={`w-full text-left px-4 py-3.5 flex items-start gap-3 transition-colors ${
                            ativa ? "bg-emerald-50/70" : "hover:bg-slate-50"
                          }`}
                        >
                          <div className="w-11 h-11 shrink-0 rounded-full bg-slate-900 text-white flex items-center justify-center font-semibold text-sm">
                            {(c.corretor_nome || "?").trim().charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-slate-900 text-sm truncate">
                                {c.corretor_nome || c.telefone_mascarado}
                              </span>
                              <span className="text-[11px] text-slate-400 shrink-0">
                                {formatarData(c.ultima_em)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 mt-0.5">
                              <span className="text-xs text-slate-500 truncate">
                                {previewMensagem(c)}
                              </span>
                              {c.nao_respondidas > 0 && (
                                <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center">
                                  {c.nao_respondidas}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </aside>

              {/* Conversa aberta */}
              <section
                className={`${conversaSel ? "flex" : "hidden md:flex"} flex-1 min-w-0 flex-col bg-[#efeae2]`}
              >
                {conversaSel ? (
                  <>
                    <div className="px-4 py-3 bg-white border-b border-slate-200 flex items-center gap-3">
                      <button
                        onClick={() => setConversaSel(null)}
                        className="md:hidden p-1.5 -ml-1 text-slate-500 hover:bg-slate-100 rounded-lg"
                        title="Voltar para as conversas"
                      >
                        <ArrowLeft className="w-5 h-5" />
                      </button>
                      <div className="w-10 h-10 shrink-0 rounded-full bg-slate-900 text-white flex items-center justify-center font-semibold text-sm">
                        {(conversaSel.corretor_nome || "?").trim().charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 text-sm truncate">
                          {conversaSel.corretor_nome || "Corretor"}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {conversaSel.telefone_mascarado}
                          {conversaSel.corretor_status !== "active" && (
                            <span className="ml-2 text-amber-600 font-medium uppercase">
                              {conversaSel.corretor_status}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div
                      className="flex-1 overflow-y-auto"
                      style={{
                        backgroundImage: "radial-gradient(var(--line) 1px, transparent 1px)",
                        backgroundSize: "22px 22px",
                      }}
                    >
                      {loadingMensagens ? (
                        <div className="h-full flex items-center justify-center text-slate-500 gap-2">
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span className="text-sm">Carregando mensagens...</span>
                        </div>
                      ) : mensagens.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                          Nenhuma mensagem nesta conversa.
                        </div>
                      ) : (
                        <>
                          <ChatMensagens mensagens={mensagens} />
                          <div ref={chatEndRef} />
                        </>
                      )}
                    </div>

                    <div className="px-4 py-2.5 bg-white border-t border-slate-200 text-[11px] text-slate-500 text-center">
                      Painel somente leitura. O agente Acessor responde automaticamente pelo WhatsApp.
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-3">
                    <div className="w-16 h-16 rounded-full bg-white/70 flex items-center justify-center">
                      <MessageSquare className="w-8 h-8 text-slate-400" />
                    </div>
                    <p className="text-sm font-medium text-slate-700">Selecione uma conversa</p>
                    <p className="text-xs text-slate-500 max-w-xs">
                      Escolha um corretor ao lado para visualizar o histórico de mensagens.
                    </p>
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {/* Tab Corretores */}
        {tab === "corretores" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h2 className="font-semibold text-slate-900">Corretores da Imobiliária ({corretores.length})</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setNovoErro(null);
                    setNovoCorretorOpen(true);
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium shadow-sm transition-colors"
                >
                  <PlusCircle className="w-4 h-4" /> Novo Corretor
                </button>
                <button onClick={loadCorretores} className="p-2 text-slate-400 hover:text-slate-600" title="Atualizar lista">
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {loading ? (
              <div className="p-12 text-center text-slate-400">Carregando...</div>
            ) : corretores.length === 0 ? (
              <div className="p-12 text-center text-slate-400">Nenhum corretor cadastrado.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {corretores.map((c) => (
                  <div key={c.id} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-slate-900">{c.nome || "Aguardando cadastro..."}</span>
                        <span
                          className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                            c.status === "active"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : c.status === "pending"
                              ? "bg-amber-50 text-amber-700 border border-amber-200"
                              : "bg-rose-50 text-rose-700 border border-rose-200"
                          }`}
                        >
                          {c.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1 space-x-3">
                        <span>Tel: {c.telefone_mascarado}</span>
                        {c.email && <span>E-mail: {c.email}</span>}
                      </div>
                    </div>

                    {c.status === "pending" && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleDecidir(c.id, true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium shadow-sm transition-colors"
                        >
                          <CheckCircle className="w-4 h-4" /> Aprovar
                        </button>
                        <button
                          onClick={() => {
                            setRecusaId(c.id);
                            setRecusaModalOpen(true);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-medium shadow-sm transition-colors"
                        >
                          <XCircle className="w-4 h-4" /> Recusar
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab WhatsApp */}
        {tab === "whatsapp" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <div>
                <h2 className="font-semibold text-slate-900">WhatsApp do Agente</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Conecte o número que o agente virtual usará para conversar com os corretores.
                </p>
              </div>
              <button
                onClick={loadWhatsApp}
                title="Atualizar status"
                className="p-2 text-slate-400 hover:text-slate-600"
              >
                <RefreshCw className={`w-4 h-4 ${whatsappLoading ? "animate-spin" : ""}`} />
              </button>
            </div>

            {whatsappErro && (
              <div className="mx-6 mt-6 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-start gap-2">
                <WifiOff className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{whatsappErro}</span>
              </div>
            )}

            {!whatsapp ? (
              <div className="p-12 text-center text-slate-400">
                {whatsappLoading ? "Consultando status..." : "Nenhuma informação disponível."}
              </div>
            ) : (
              <div className="p-6 grid md:grid-cols-2 gap-8">
                {/* Status e ações */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center gap-2 text-xs px-3 py-1 rounded-full font-medium border ${
                        whatsapp.status === "connected"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : whatsapp.status === "qr_pending"
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : whatsapp.status === "not_provisioned"
                          ? "bg-slate-100 text-slate-600 border-slate-200"
                          : "bg-rose-50 text-rose-700 border-rose-200"
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          whatsapp.status === "connected"
                            ? "bg-emerald-500"
                            : whatsapp.status === "qr_pending"
                            ? "bg-amber-500 animate-pulse"
                            : "bg-rose-500"
                        }`}
                      />
                      {whatsapp.status === "connected"
                        ? "Conectado"
                        : whatsapp.status === "qr_pending"
                        ? "Aguardando leitura do QR code"
                        : whatsapp.status === "not_provisioned"
                        ? "Não provisionado"
                        : "Desconectado"}
                    </span>
                  </div>

                  {whatsapp.numero && (
                    <div className="text-sm">
                      <span className="text-slate-500">Número conectado: </span>
                      <span className="font-medium text-slate-900">{whatsapp.numero}</span>
                    </div>
                  )}

                  {whatsapp.instance_id && (
                    <div className="text-xs text-slate-500">
                      Instância: <span className="font-mono">{whatsapp.instance_id}</span>
                    </div>
                  )}

                  {whatsapp.status === "not_provisioned" && (
                    <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3">
                      {whatsapp.mensagem ||
                        "Esta imobiliária ainda não possui uma sessão de WhatsApp provisionada. Fale com o suporte da plataforma."}
                    </p>
                  )}

                  {whatsapp.degradado && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>
                        Não foi possível falar com o serviço de mensageria agora. O status exibido pode estar
                        desatualizado.
                      </span>
                    </div>
                  )}

                  {whatsapp.status !== "not_provisioned" && (
                    <div className="flex flex-wrap items-center gap-2 pt-2">
                      {whatsapp.status === "connected" ? (
                        <button
                          onClick={handleDesconectarWhatsApp}
                          disabled={whatsappAcao}
                          className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium shadow-sm transition-colors"
                        >
                          {whatsappAcao ? <Loader2 className="w-4 h-4 animate-spin" /> : <WifiOff className="w-4 h-4" />}
                          Desconectar
                        </button>
                      ) : (
                        <button
                          onClick={() => handleConectarWhatsApp()}
                          disabled={whatsappAcao}
                          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium shadow-sm transition-colors"
                        >
                          {whatsappAcao ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <QrCode className="w-4 h-4" />
                          )}
                          {whatsapp.status === "qr_pending" ? "Gerar novo QR code" : "Conectar WhatsApp"}
                        </button>
                      )}
                    </div>
                  )}

                  {whatsapp.status !== "not_provisioned" && whatsapp.status !== "connected" && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleConectarWhatsApp(numeroPareamento);
                      }}
                      className="space-y-2 pt-3 border-t border-slate-200"
                    >
                      <label htmlFor="numero-pareamento" className="block text-xs font-medium text-slate-600">
                        Não consegue ler o QR code? Conecte com o número do WhatsApp
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <input
                          id="numero-pareamento"
                          type="tel"
                          inputMode="tel"
                          autoComplete="off"
                          value={numeroPareamento}
                          onChange={(e) => setNumeroPareamento(e.target.value)}
                          placeholder="DDD + número, ex.: 63 99999-9999"
                          className="flex-1 min-w-[12rem] px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-slate-900"
                        />
                        <button
                          type="submit"
                          disabled={whatsappAcao || numeroPareamento.replace(/\D/g, "").length < 10}
                          className="px-4 py-2 bg-slate-900 hover:bg-slate-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors"
                        >
                          Conectar por código
                        </button>
                      </div>
                    </form>
                  )}

                  {whatsapp.status === "qr_pending" && (
                    <p className="text-xs text-slate-500">
                      O QR code expira em cerca de 40 segundos. Esta tela verifica automaticamente quando o
                      pareamento for concluído.
                    </p>
                  )}
                </div>

                {/* Área do QR code */}
                <div className="flex flex-col items-center justify-center bg-slate-50 border border-slate-200 rounded-2xl p-6 min-h-[260px]">
                  {whatsapp.status === "connected" ? (
                    <div className="text-center space-y-2">
                      <Smartphone className="w-12 h-12 text-emerald-500 mx-auto" />
                      <p className="font-medium text-slate-800">WhatsApp conectado</p>
                      <p className="text-xs text-slate-500">
                        O agente já pode enviar e receber mensagens por este número.
                      </p>
                    </div>
                  ) : !qrSrc && whatsapp.pairing_code ? (
                    <div className="text-center space-y-3">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Código de pareamento</p>
                      <p
                        className="font-mono text-3xl font-semibold tracking-widest text-slate-900 select-all"
                        aria-label={`Código ${whatsapp.pairing_code.split("").join(" ")}`}
                      >
                        {whatsapp.pairing_code.length === 8
                          ? `${whatsapp.pairing_code.slice(0, 4)}-${whatsapp.pairing_code.slice(4)}`
                          : whatsapp.pairing_code}
                      </p>
                      <p className="text-xs text-slate-600 max-w-xs mx-auto">
                        No celular: WhatsApp → <strong>Dispositivos conectados</strong> →{" "}
                        <strong>Conectar dispositivo</strong> → <strong>Conectar com número de telefone</strong> e
                        digite o código. Ele vale por poucos minutos.
                      </p>
                    </div>
                  ) : qrSrc ? (
                    <div className="text-center space-y-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={qrSrc}
                        alt="QR code para conectar o WhatsApp"
                        className="w-56 h-56 mx-auto rounded-xl bg-white p-2 border border-slate-200"
                      />
                      <p className="text-xs text-slate-600">
                        Abra o WhatsApp no celular do agente → <strong>Dispositivos conectados</strong> →{" "}
                        <strong>Conectar dispositivo</strong> e aponte para o código.
                      </p>
                      {whatsapp.pairing_code && (
                        <p className="text-xs text-slate-500">
                          Código de pareamento:{" "}
                          <span className="font-mono font-semibold text-slate-800">{whatsapp.pairing_code}</span>
                        </p>
                      )}
                    </div>
                  ) : whatsapp.status === "qr_pending" ? (
                    <div className="text-center space-y-2 text-slate-500">
                      <Loader2 className="w-8 h-8 mx-auto animate-spin" />
                      <p className="text-sm">Gerando QR code...</p>
                    </div>
                  ) : (
                    <div className="text-center space-y-2 text-slate-500">
                      <QrCode className="w-12 h-12 mx-auto text-slate-300" />
                      <p className="text-sm font-medium text-slate-700">Nenhum QR code ativo</p>
                      <p className="text-xs">
                        Clique em <strong>Conectar WhatsApp</strong> para gerar o código de pareamento.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab Agente */}
        {tab === "agente" && <AgenteConfig onAuthError={tratarAuthError} />}

        {tab === "negociacoes" && <Negociacoes onAuthError={tratarAuthError} />}
        {tab === "agenda" && <Agenda onAuthError={tratarAuthError} />}
        {tab === "leads" && <Leads onAuthError={tratarAuthError} />}

        {/* Tab Auditoria */}
        {tab === "auditoria" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h2 className="font-semibold text-slate-900">Auditoria Append-Only ({auditoria.length})</h2>
              <span className="text-xs text-slate-400">Protegido contra UPDATE e DELETE</span>
            </div>
            <div className="divide-y divide-slate-100">
              {auditoria.map((a) => (
                <div key={a.id} className="p-4 flex items-center justify-between text-sm">
                  <div>
                    <span className="font-semibold text-slate-900">{a.acao}</span>
                    <span className="text-slate-400 text-xs ml-2">[{a.entidade} #{a.entidade_id}]</span>
                    <div className="text-xs text-slate-500 mt-0.5">Origem: {a.origem} • {a.created_at}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab Pendências */}
        {tab === "pendencias" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Falhas e Pendências no Imoview</h2>
            {pendencias.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhuma pendência aberta! Sincronização em dia.</p>
            ) : (
              <div className="space-y-3">
                {pendencias.map((p) => (
                  <div key={p.id} className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs space-y-1">
                    <div className="font-semibold text-rose-900">Operação: {p.tipo} (Tentativas: {p.tentativas})</div>
                    <div className="text-rose-700 font-mono">{p.ultimo_erro}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      {/* Modal Recusa */}
      {recusaModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <h3 className="font-bold text-slate-900">Recusar Cadastro de Corretor</h3>
            <p className="text-xs text-slate-500">O motivo é obrigatório conforme especificação da plataforma.</p>
            <textarea
              rows={3}
              required
              value={recusaMotivo}
              onChange={(e) => setRecusaMotivo(e.target.value)}
              placeholder="Ex: Número não reconhecido pela diretoria da imobiliária."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-rose-500"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRecusaModalOpen(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (!recusaMotivo.trim()) return alert("Informe o motivo");
                  if (recusaId) handleDecidir(recusaId, false, recusaMotivo);
                  setRecusaModalOpen(false);
                  setRecusaMotivo("");
                }}
                className="px-3 py-1.5 text-xs bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-medium"
              >
                Confirmar Recusa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Novo Corretor */}
      {novoCorretorOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div>
              <h3 className="font-bold text-slate-900">Cadastrar Novo Corretor</h3>
              <p className="text-xs text-slate-500 mt-1">
                O corretor é criado já ativo e poderá entrar no Portal do Corretor usando o WhatsApp cadastrado.
              </p>
            </div>

            <form onSubmit={handleCriarCorretor} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nome completo *</label>
                <input
                  type="text"
                  required
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  placeholder="Ex: João da Silva"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">WhatsApp *</label>
                <input
                  type="tel"
                  required
                  value={novoTelefone}
                  onChange={(e) => setNovoTelefone(e.target.value)}
                  placeholder="(63) 99999-8888"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900"
                />
                <p className="text-[11px] text-slate-400 mt-1">Use DDD + número. Este telefone será o login do corretor.</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">E-mail (opcional)</label>
                <input
                  type="email"
                  value={novoEmail}
                  onChange={(e) => setNovoEmail(e.target.value)}
                  placeholder="joao@imobiliaria.com.br"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900"
                />
              </div>

              {novoErro && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                  {novoErro}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setNovoCorretorOpen(false)}
                  className="px-3 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoCorretor}
                  className="flex items-center gap-2 px-4 py-2 text-xs bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg font-medium"
                >
                  {salvandoCorretor && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {salvandoCorretor ? "Cadastrando..." : "Cadastrar Corretor"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
