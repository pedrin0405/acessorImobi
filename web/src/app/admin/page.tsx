"use client";

import React, { useEffect, useState } from "react";
import { PlusCircle, Shield, Server, RefreshCw, Trash2, PowerOff, Building, Gauge, AlertTriangle, CheckCircle2 } from "lucide-react";
import { fetchApi, AuthError, clearToken, tokenRole } from "@/lib/api";
import LoginForm from "@/components/LoginForm";

interface Tenant {
  id: string;
  nome: string;
  slug: string;
  status: string;
  numero_whatsapp?: string;
  ollama_model: string;
}

interface LimiteInfo {
  limite: number;
  usado: number;
  rpm_limite: number;
  rpm: number;
  erros: number;
  rate_limited: number;
  tokens: number;
  ultimo_429: string | null;
  cooldown_segundos: number;
  status: "ok" | "alerta" | "atingido" | "sem_limite";
}

interface ModeloUso {
  provider: string;
  operation: string;
  model: string;
  requests: number;
  errors: number;
  input_tokens: number;
  output_tokens: number;
  characters: number;
  rate_limited: number;
}

interface UsoDia {
  dia: string;
  requests: number;
  errors: number;
}

interface UsoResponse {
  dia: string;
  alerta_percentual: number;
  limites: Record<string, LimiteInfo>;
  modelos: ModeloUso[];
  historico: UsoDia[];
  totais: {
    requests: number;
    errors: number;
    input_tokens: number;
    output_tokens: number;
  };
}

const ROTULO_LIMITE: Record<string, string> = {
  chat: "Gemini · Chat (IA)",
  tts: "Gemini · TTS (voz)",
  transcricao: "Whisper · Transcrição (local)",
};

const USO_REFRESH_MS = 30_000;

const formatarNumero = (n: number) => n.toLocaleString("pt-BR");

const formatarHoraIso = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";

function BarraUso({ usado, limite, alertaPct, rotulo }: { usado: number; limite: number; alertaPct: number; rotulo: string }) {
  const pct = limite > 0 ? Math.min(100, Math.round((usado / limite) * 100)) : 0;
  const cor = limite <= 0 ? "bg-slate-600" : pct >= 100 ? "bg-rose-500" : pct >= alertaPct ? "bg-amber-400" : "bg-sky-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-slate-400">
        <span>{rotulo}</span>
        <span>
          <span className="text-white font-semibold">{formatarNumero(usado)}</span>
          {limite > 0 ? ` / ${formatarNumero(limite)} (${pct}%)` : ""}
        </span>
      </div>
      <div
        className="w-full h-2 rounded-full bg-slate-700 overflow-hidden"
        role="progressbar"
        aria-label={rotulo}
        aria-valuenow={usado}
        aria-valuemax={limite > 0 ? limite : undefined}
      >
        <div className={`h-full rounded-full ${cor} transition-all`} style={{ width: `${limite > 0 ? pct : 100}%` }} />
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [uso, setUso] = useState<UsoResponse | null>(null);
  const [usoAtualizadoEm, setUsoAtualizadoEm] = useState<Date | null>(null);
  const [usoErro, setUsoErro] = useState(false);

  // Form states
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [numeroWhatsapp, setNumeroWhatsapp] = useState("");
  const [ollamaModel, setOllamaModel] = useState("llama3.1:8b-instruct-q4_K_M");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminSenha, setAdminSenha] = useState("");
  const [adminNome, setAdminNome] = useState("");

  const loadTenants = async () => {
    setLoading(true);
    try {
      const res = await fetchApi("/dev/tenants");
      if (res.ok) {
        const data = await res.json();
        setTenants(data);
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
    }
  };

  const loadUso = async () => {
    try {
      const res = await fetchApi("/dev/usage?dias=7");
      if (res.ok) {
        setUso(await res.json());
        setUsoAtualizadoEm(new Date());
        setUsoErro(false);
      } else {
        setUsoErro(true);
      }
    } catch {
      // Consumo é best-effort; falha não deve derrubar o painel.
      setUsoErro(true);
    }
  };

  useEffect(() => {
    if (tokenRole() === "developer") {
      loadTenants();
      loadUso();
    } else {
      setLoading(false);
    }
  }, []);

  // O RPM é uma janela de 60s: atualiza sozinho para o painel refletir o momento.
  useEffect(() => {
    if (!authed) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") loadUso();
    }, USO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [authed]);

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetchApi("/dev/tenants", {
        method: "POST",
        body: JSON.stringify({
          nome,
          slug,
          numero_whatsapp: numeroWhatsapp,
          ollama_model: ollamaModel,
          admin_email: adminEmail || undefined,
          admin_senha: adminSenha || undefined,
          admin_nome: adminNome || undefined,
        }),
      });

      if (res.ok) {
        setModalOpen(false);
        setNome("");
        setSlug("");
        setNumeroWhatsapp("");
        setAdminEmail("");
        setAdminSenha("");
        setAdminNome("");
        loadTenants();
      } else {
        const err = await res.json();
        alert(err.detail || "Erro ao criar tenant");
      }
    } catch (err) {
      if (err instanceof AuthError) {
        clearToken();
        setAuthed(false);
      } else {
        alert("Falha na comunicação com a API");
      }
    }
  };

  const handleSuspend = async (id: string) => {
    if (!confirm("Deseja realmente suspender este tenant?")) return;
    await fetchApi(`/dev/tenants/${id}/suspender`, {
      method: "PATCH",
      body: JSON.stringify({ motivo: "Suspensão manual via painel do desenvolvedor" }),
    });
    loadTenants();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("ATENÇÃO: Deseja remover permanentemente este tenant?")) return;
    await fetchApi(`/dev/tenants/${id}`, { method: "DELETE" });
    loadTenants();
  };

  if (!authed) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <LoginForm mode="developer" onSuccess={() => setAuthed(true)} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-400">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Painel do Desenvolvedor</h1>
              <p className="text-sm text-slate-400">Gerenciamento global de imobiliárias e provisionamento</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { loadTenants(); loadUso(); }}
              className="p-2.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 transition-colors"
              title="Recarregar"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-500 rounded-lg font-medium text-white shadow-lg shadow-sky-600/20 transition-all"
            >
              <PlusCircle className="w-5 h-5" /> Novo Tenant
            </button>
          </div>
        </div>

        {/* Consumo de APIs */}
        <div className="bg-slate-800/40 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center">
            <h2 className="font-semibold text-slate-200 flex items-center gap-2">
              <Gauge className="w-5 h-5 text-sky-400" /> Consumo de APIs (hoje, {uso?.dia ? uso.dia.split("-").reverse().join("/") : "—"})
            </h2>
            <div className="flex items-center gap-3">
              {usoAtualizadoEm && (
                <span className={`text-[11px] ${usoErro ? "text-rose-400" : "text-slate-500"}`}>
                  {usoErro ? "Falha ao atualizar · " : ""}
                  atualizado às {usoAtualizadoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              )}
              <button
                onClick={loadUso}
                className="p-2 rounded-lg text-slate-400 hover:text-sky-400 hover:bg-slate-700/50 transition-colors"
                title="Atualizar consumo"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {!uso ? (
            <div className="p-8 text-center text-slate-500">
              {usoErro ? "Não foi possível carregar o consumo." : "Carregando consumo..."}
            </div>
          ) : (
            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
              {(() => {
                const estourados = Object.entries(uso.limites).filter(([, i]) => i.status === "atingido");
                if (estourados.length === 0) return null;
                return (
                  <div className="md:col-span-3 flex items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                    <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-rose-300">
                        Limite atingido: {estourados.map(([op]) => ROTULO_LIMITE[op] ?? op).join(", ")}
                      </p>
                      <p className="text-xs text-rose-200/80">
                        Enquanto isso o agente responde pelo fallback (respostas mais simples, voz pelo Qwen3 local).
                        A cota diária do Gemini renova à meia-noite do horário do Pacífico.
                      </p>
                    </div>
                  </div>
                );
              })()}

              {Object.entries(uso.limites).map(([op, info]) => {
                const atingido = info.status === "atingido";
                const emAlerta = info.status === "alerta";
                return (
                  <div
                    key={op}
                    className={`rounded-xl border p-4 space-y-3 ${
                      atingido
                        ? "border-rose-500/40 bg-rose-500/5"
                        : emAlerta
                          ? "border-amber-400/40 bg-amber-400/5"
                          : "border-slate-700 bg-slate-900/40"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-200">{ROTULO_LIMITE[op] ?? op}</span>
                      {atingido ? (
                        <span className="flex items-center gap-1 text-xs text-rose-400 font-medium">
                          <AlertTriangle className="w-4 h-4" /> Limite atingido
                        </span>
                      ) : emAlerta ? (
                        <span className="flex items-center gap-1 text-xs text-amber-300 font-medium">
                          <AlertTriangle className="w-4 h-4" /> Perto do limite
                        </span>
                      ) : info.status === "sem_limite" ? (
                        <span className="text-xs text-slate-500">sem limite</span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-emerald-400">
                          <CheckCircle2 className="w-4 h-4" /> OK
                        </span>
                      )}
                    </div>

                    <BarraUso rotulo="Requisições hoje" usado={info.usado} limite={info.limite} alertaPct={uso.alerta_percentual} />
                    {info.rpm_limite > 0 && (
                      <BarraUso rotulo="Último minuto (RPM)" usado={info.rpm} limite={info.rpm_limite} alertaPct={uso.alerta_percentual} />
                    )}

                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-400">
                      {info.tokens > 0 && (
                        <>
                          <dt>Tokens hoje</dt>
                          <dd className="text-right text-slate-300">{formatarNumero(info.tokens)}</dd>
                        </>
                      )}
                      <dt>Erros hoje</dt>
                      <dd className={`text-right ${info.erros > 0 ? "text-rose-400" : "text-slate-300"}`}>{info.erros}</dd>
                      {info.limite > 0 && (
                        <>
                          <dt>Bloqueios (429)</dt>
                          <dd className={`text-right ${info.rate_limited > 0 ? "text-rose-400 font-semibold" : "text-slate-300"}`}>
                            {info.rate_limited}
                            {info.ultimo_429 ? ` · último ${formatarHoraIso(info.ultimo_429)}` : ""}
                          </dd>
                        </>
                      )}
                    </dl>

                    {info.cooldown_segundos > 0 && (
                      <p className="text-[11px] text-rose-300">
                        Provedor recusou por cota. Chamadas pausadas por mais {info.cooldown_segundos}s.
                      </p>
                    )}
                  </div>
                );
              })}

              <div className="md:col-span-3 grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2">
                {/* Modelos de hoje */}
                <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
                  <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-3">Por modelo (hoje)</h3>
                  <p className="text-[11px] text-slate-500 mb-3">
                    Qwen3-TTS e Whisper rodam localmente e não consomem cota do Gemini.
                  </p>
                  {uso.modelos.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhuma chamada registrada hoje.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-slate-500">
                          <th className="pb-2">Modelo</th>
                          <th className="pb-2">Provedor</th>
                          <th className="pb-2">Operação</th>
                          <th className="pb-2 text-right">Req.</th>
                          <th className="pb-2 text-right">Erros</th>
                          <th className="pb-2 text-right">429</th>
                          <th className="pb-2 text-right">Tokens</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {uso.modelos.map((m, i) => (
                          <tr key={i} className="text-slate-300">
                            <td className="py-1.5 font-mono text-xs text-sky-400">{m.model}</td>
                            <td className="py-1.5 text-xs">{m.provider}</td>
                            <td className="py-1.5 text-xs">{m.operation}</td>
                            <td className="py-1.5 text-right">{m.requests}</td>
                            <td className={`py-1.5 text-right ${m.errors > 0 ? "text-rose-400" : ""}`}>{m.errors}</td>
                            <td className={`py-1.5 text-right ${m.rate_limited > 0 ? "text-rose-400 font-semibold" : ""}`}>{m.rate_limited ?? 0}</td>
                            <td className="py-1.5 text-right text-xs">{m.input_tokens + m.output_tokens}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Histórico 7 dias */}
                <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
                  <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-3">Últimos 7 dias</h3>
                  <div className="flex items-end gap-2 h-28">
                    {uso.historico.map((d) => {
                      const max = Math.max(...uso.historico.map((h) => h.requests), 1);
                      const h = Math.max(4, Math.round((d.requests / max) * 100));
                      return (
                        <div key={d.dia} className="flex-1 flex flex-col items-center gap-1" title={`${d.dia}: ${d.requests} req.`}>
                          <span className="text-[10px] text-slate-500">{d.requests}</span>
                          <div className={`w-full rounded-t ${d.requests > 0 ? "bg-sky-500/70" : "bg-slate-700"}`} style={{ height: `${h}%` }} />
                          <span className="text-[10px] text-slate-500">{d.dia.slice(8)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Lista de Tenants */}
        <div className="bg-slate-800/40 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center">
            <h2 className="font-semibold text-slate-200">Tenants Cadastrados ({tenants.length})</h2>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-500">Carregando tenants...</div>
          ) : tenants.length === 0 ? (
            <div className="p-12 text-center text-slate-500">Nenhum tenant cadastrado ainda.</div>
          ) : (
            <div className="divide-y divide-slate-800">
              {tenants.map((t) => (
                <div key={t.id} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-800/30 transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-lg text-white">{t.nome}</span>
                      <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-700 text-slate-300 font-mono">
                        {t.slug}.acessorimobi.com.br
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          t.status === "active"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                        }`}
                      >
                        {t.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-400">
                      <span>Modelo: <code className="text-sky-400">{t.ollama_model}</code></span>
                      <span>ID: <code className="text-slate-500">{t.id}</code></span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {t.status === "active" && (
                      <button
                        onClick={() => handleSuspend(t.id)}
                        className="p-2 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-700/50 transition-colors"
                        title="Suspender Tenant"
                      >
                        <PowerOff className="w-5 h-5" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(t.id)}
                      className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-700/50 transition-colors"
                      title="Excluir Tenant"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal Criar Tenant */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-lg w-full p-6 space-y-6 shadow-2xl">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <Building className="w-5 h-5 text-sky-400" /> Provisionar Novo Tenant
            </h3>

            <form onSubmit={handleCreateTenant} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Nome da Imobiliária</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Imobiliária Alvorada"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Slug (Subdomínio)</label>
                <input
                  type="text"
                  required
                  placeholder="alvorada"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().trim())}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">WhatsApp do Agente</label>
                <input
                  type="text"
                  required
                  placeholder="(31) 99999-8888"
                  value={numeroWhatsapp}
                  onChange={(e) => setNumeroWhatsapp(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-sky-500"
                />
              </div>

              <p className="text-xs text-slate-500 leading-relaxed">
                A integração com o Imoview (endereço e chave da API) é configurada pela própria imobiliária no portal
                dela, em Configurações &rsaquo; Integrações.
              </p>

              <div className="border-t border-slate-700 pt-4 space-y-4">
                <p className="text-xs font-semibold text-slate-300">Administrador inicial da imobiliária</p>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Nome do Administrador</label>
                  <input
                    type="text"
                    placeholder="Ex: Maria Silva"
                    value={adminNome}
                    onChange={(e) => setAdminNome(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">E-mail do Administrador</label>
                  <input
                    type="email"
                    placeholder="admin@imobiliaria.com.br"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Senha do Administrador</label>
                  <input
                    type="password"
                    placeholder="Mínimo 8 caracteres"
                    value={adminSenha}
                    onChange={(e) => setAdminSenha(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Modelo Ollama</label>
                <select
                  value={ollamaModel}
                  onChange={(e) => setOllamaModel(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-sky-500"
                >
                  <option value="llama3.1:8b-instruct-q4_K_M">llama3.1:8b-instruct-q4_K_M (Padrão)</option>
                  <option value="qwen2.5:7b">qwen2.5:7b</option>
                  <option value="mistral-nemo:12b">mistral-nemo:12b</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-medium rounded-lg text-sm shadow-md"
                >
                  Criar e Provisionar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
