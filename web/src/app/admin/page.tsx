"use client";

import React, { useEffect, useState } from "react";
import { PlusCircle, Shield, RefreshCw, Trash2, PowerOff, Building, Gauge, AlertTriangle, CheckCircle2, LogOut, X } from "lucide-react";
import { fetchApi, AuthError, clearToken, tokenRole } from "@/lib/api";
import LoginForm from "@/components/LoginForm";
import LogoAcessorHorizontal from "@/components/shell/LogoAcessorHorizontal";
import { BotaoTema, useTema } from "@/components/tema/tema";

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
  const cor = limite <= 0 ? "var(--text-4)" : pct >= 100 ? "var(--danger)" : pct >= alertaPct ? "var(--warn)" : "var(--accent)";
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs" style={{ color: "var(--text-3)" }}>
        <span>{rotulo}</span>
        <span>
          <span className="font-semibold" style={{ color: "var(--text)" }}>{formatarNumero(usado)}</span>
          {limite > 0 ? ` / ${formatarNumero(limite)} (${pct}%)` : ""}
        </span>
      </div>
      <div
        className="w-full h-2 rounded-full overflow-hidden"
        style={{ background: "var(--card-2)", border: "1px solid var(--line)" }}
        role="progressbar"
        aria-label={rotulo}
        aria-valuenow={usado}
        aria-valuemax={limite > 0 ? limite : undefined}
      >
        <div className="h-full rounded-full transition-all" style={{ width: `${limite > 0 ? pct : 100}%`, background: cor, opacity: limite > 0 ? 1 : 0.35 }} />
      </div>
    </div>
  );
}

/* --- Peças visuais do painel (mesmos tokens dos portais) --- */

const CAMPO = "w-full h-11 px-3.5 rounded-2xl text-sm border outline-none transition-shadow focus:ring-4 focus:ring-[color:var(--accent-soft)]";
const ROTULO = "block text-[13px] font-medium mb-1.5";

function Cartao({ titulo, acoes, children }: { titulo: React.ReactNode; acoes?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[20px] overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--line)", boxShadow: "var(--sombra)" }}>
      <header className="px-6 py-5 flex flex-wrap items-center justify-between gap-3" style={{ borderBottom: "1px solid var(--line)" }}>
        <h2 className="text-[15px] font-semibold flex items-center gap-2" style={{ color: "var(--text)" }}>{titulo}</h2>
        {acoes}
      </header>
      {children}
    </section>
  );
}

function Selo({ tom, children }: { tom: "ok" | "aviso" | "perigo" | "neutro"; children: React.ReactNode }) {
  const cores = {
    ok: ["var(--accent-soft)", "var(--accent-text)"],
    aviso: ["color-mix(in srgb, var(--warn) 14%, transparent)", "var(--warn)"],
    perigo: ["color-mix(in srgb, var(--danger) 12%, transparent)", "var(--danger)"],
    neutro: ["var(--card-2)", "var(--text-3)"],
  }[tom];
  return <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: cores[0], color: cores[1] }}>{children}</span>;
}

const BOTAO_REDONDO = "w-10 h-10 rounded-full flex items-center justify-center transition-colors hover:bg-[var(--hover-solid)] disabled:opacity-50";

export default function AdminPage() {
  const { tema, alternar, classe } = useTema();
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

  const sair = () => {
    clearToken();
    localStorage.removeItem("acessor_role");
    setAuthed(false);
  };

  if (!authed) {
    return <LoginForm mode="developer" onSuccess={() => setAuthed(true)} />;
  }

  const estourados = uso ? Object.entries(uso.limites).filter(([, i]) => i.status === "atingido") : [];

  return (
    <div className={`${classe} h-dvh overflow-hidden flex flex-col`} style={{ background: "var(--shell)", color: "var(--text-2)" }}>
      {/* Moldura: marca e ações */}
      <header className="h-[68px] shrink-0 flex items-center gap-3 px-4 lg:px-8">
        <LogoAcessorHorizontal tema={tema} alt="Acessor Imobi" className="w-32 h-auto" />
        <span className="hidden sm:inline text-xs px-2.5 py-1 rounded-full" style={{ background: "var(--card)", border: "1px solid var(--line)", color: "var(--text-3)" }}>Desenvolvedor</span>
        <div className="ml-auto flex items-center gap-2">
          <BotaoTema tema={tema} onClick={alternar} />
          <button
            onClick={sair}
            className="w-11 h-11 rounded-full flex items-center justify-center transition-colors hover:bg-[var(--hover-solid)]"
            style={{ border: "1px solid var(--line)", color: "var(--text-3)", background: "var(--card)", boxShadow: "var(--sombra)" }}
            aria-label="Sair" title="Sair"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="shell-painel flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="max-w-6xl mx-auto px-5 py-8 lg:px-10 lg:py-10 space-y-8">
          {/* Título e ações */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}>
                <Shield className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--text)" }}>Painel do Desenvolvedor</h1>
                <p className="text-sm mt-0.5" style={{ color: "var(--text-3)" }}>Gerenciamento global de imobiliárias e provisionamento</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => { loadTenants(); loadUso(); }}
                className="w-11 h-11 rounded-full flex items-center justify-center transition-colors hover:bg-[var(--hover-solid)]"
                style={{ border: "1px solid var(--line-2)", color: "var(--text-2)", background: "var(--card)" }}
                title="Recarregar" aria-label="Recarregar"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={() => setModalOpen(true)}
                className="h-11 px-5 rounded-full flex items-center gap-2 text-sm font-semibold transition-opacity hover:opacity-90"
                style={{ background: "var(--chip)", color: "var(--chip-text)" }}
              >
                <PlusCircle className="w-[18px] h-[18px]" /> Novo tenant
              </button>
            </div>
          </div>

          {/* Consumo de APIs */}
          <Cartao
            titulo={<><Gauge className="w-5 h-5" style={{ color: "var(--accent)" }} /> Consumo de APIs (hoje, {uso?.dia ? uso.dia.split("-").reverse().join("/") : "—"})</>}
            acoes={
              <div className="flex items-center gap-3">
                {usoAtualizadoEm && (
                  <span className="text-xs" style={{ color: usoErro ? "var(--danger)" : "var(--text-4)" }}>
                    {usoErro ? "Falha ao atualizar · " : ""}
                    atualizado às {usoAtualizadoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                )}
                <button onClick={loadUso} className={BOTAO_REDONDO} style={{ color: "var(--text-3)" }} title="Atualizar consumo" aria-label="Atualizar consumo">
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            }
          >
            {!uso ? (
              <div className="p-10 text-center text-sm" style={{ color: "var(--text-3)" }}>
                {usoErro ? "Não foi possível carregar o consumo." : "Carregando consumo..."}
              </div>
            ) : (
              <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-5">
                {estourados.length > 0 && (
                  <div className="md:col-span-3 flex items-start gap-3 rounded-2xl px-5 py-4 text-sm" style={{ background: "color-mix(in srgb, var(--danger) 9%, transparent)", border: "1px solid color-mix(in srgb, var(--danger) 30%, transparent)" }}>
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "var(--danger)" }} />
                    <div>
                      <p className="font-semibold" style={{ color: "var(--danger)" }}>
                        Limite atingido: {estourados.map(([op]) => ROTULO_LIMITE[op] ?? op).join(", ")}
                      </p>
                      <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--text-3)" }}>
                        Enquanto isso o agente responde pelo fallback (respostas mais simples, voz pelo Qwen3 local).
                        A cota diária do Gemini renova à meia-noite do horário do Pacífico.
                      </p>
                    </div>
                  </div>
                )}

                {Object.entries(uso.limites).map(([op, info]) => {
                  const atingido = info.status === "atingido";
                  const emAlerta = info.status === "alerta";
                  return (
                    <div
                      key={op}
                      className="rounded-2xl p-5 space-y-4"
                      style={{
                        background: atingido ? "color-mix(in srgb, var(--danger) 6%, var(--card))" : emAlerta ? "color-mix(in srgb, var(--warn) 7%, var(--card))" : "var(--card-2)",
                        border: `1px solid ${atingido ? "color-mix(in srgb, var(--danger) 35%, transparent)" : emAlerta ? "color-mix(in srgb, var(--warn) 40%, transparent)" : "var(--line)"}`,
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{ROTULO_LIMITE[op] ?? op}</span>
                        {atingido ? (
                          <Selo tom="perigo"><AlertTriangle className="w-3.5 h-3.5" /> Limite atingido</Selo>
                        ) : emAlerta ? (
                          <Selo tom="aviso"><AlertTriangle className="w-3.5 h-3.5" /> Perto do limite</Selo>
                        ) : info.status === "sem_limite" ? (
                          <Selo tom="neutro">sem limite</Selo>
                        ) : (
                          <Selo tom="ok"><CheckCircle2 className="w-3.5 h-3.5" /> OK</Selo>
                        )}
                      </div>

                      <BarraUso rotulo="Requisições hoje" usado={info.usado} limite={info.limite} alertaPct={uso.alerta_percentual} />
                      {info.rpm_limite > 0 && (
                        <BarraUso rotulo="Último minuto (RPM)" usado={info.rpm} limite={info.rpm_limite} alertaPct={uso.alerta_percentual} />
                      )}

                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs" style={{ color: "var(--text-3)" }}>
                        {info.tokens > 0 && (
                          <>
                            <dt>Tokens hoje</dt>
                            <dd className="text-right" style={{ color: "var(--text-2)" }}>{formatarNumero(info.tokens)}</dd>
                          </>
                        )}
                        <dt>Erros hoje</dt>
                        <dd className="text-right" style={{ color: info.erros > 0 ? "var(--danger)" : "var(--text-2)" }}>{info.erros}</dd>
                        {info.limite > 0 && (
                          <>
                            <dt>Bloqueios (429)</dt>
                            <dd className={`text-right ${info.rate_limited > 0 ? "font-semibold" : ""}`} style={{ color: info.rate_limited > 0 ? "var(--danger)" : "var(--text-2)" }}>
                              {info.rate_limited}
                              {info.ultimo_429 ? ` · último ${formatarHoraIso(info.ultimo_429)}` : ""}
                            </dd>
                          </>
                        )}
                      </dl>

                      {info.cooldown_segundos > 0 && (
                        <p className="text-xs" style={{ color: "var(--danger)" }}>
                          Provedor recusou por cota. Chamadas pausadas por mais {info.cooldown_segundos}s.
                        </p>
                      )}
                    </div>
                  );
                })}

                <div className="md:col-span-3 grid grid-cols-1 lg:grid-cols-2 gap-5 pt-1">
                  {/* Modelos de hoje */}
                  <div className="rounded-2xl p-5" style={{ background: "var(--card-2)", border: "1px solid var(--line)" }}>
                    <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--text)" }}>Por modelo (hoje)</h3>
                    <p className="text-xs mb-4 leading-relaxed" style={{ color: "var(--text-3)" }}>
                      Qwen3-TTS e Whisper rodam localmente e não consomem cota do Gemini.
                    </p>
                    {uso.modelos.length === 0 ? (
                      <p className="text-sm" style={{ color: "var(--text-3)" }}>Nenhuma chamada registrada hoje.</p>
                    ) : (
                      <div className="overflow-x-auto -mx-1 px-1">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs" style={{ color: "var(--text-4)" }}>
                              <th className="pb-2 font-medium">Modelo</th>
                              <th className="pb-2 font-medium">Provedor</th>
                              <th className="pb-2 font-medium">Operação</th>
                              <th className="pb-2 font-medium text-right">Req.</th>
                              <th className="pb-2 font-medium text-right">Erros</th>
                              <th className="pb-2 font-medium text-right">429</th>
                              <th className="pb-2 font-medium text-right">Tokens</th>
                            </tr>
                          </thead>
                          <tbody>
                            {uso.modelos.map((m, i) => (
                              <tr key={i} className="h-10 hover:bg-[var(--hover-solid)] transition-colors" style={{ color: "var(--text-2)", borderTop: "1px solid var(--line)" }}>
                                <td className="font-mono text-xs pr-3" style={{ color: "var(--accent-text)" }}>{m.model}</td>
                                <td className="text-xs pr-3">{m.provider}</td>
                                <td className="text-xs pr-3">{m.operation}</td>
                                <td className="text-right tabular-nums">{m.requests}</td>
                                <td className="text-right tabular-nums" style={{ color: m.errors > 0 ? "var(--danger)" : undefined }}>{m.errors}</td>
                                <td className={`text-right tabular-nums ${m.rate_limited > 0 ? "font-semibold" : ""}`} style={{ color: m.rate_limited > 0 ? "var(--danger)" : undefined }}>{m.rate_limited ?? 0}</td>
                                <td className="text-right text-xs tabular-nums">{m.input_tokens + m.output_tokens}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Histórico 7 dias */}
                  <div className="rounded-2xl p-5" style={{ background: "var(--card-2)", border: "1px solid var(--line)" }}>
                    <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--text)" }}>Últimos 7 dias</h3>
                    <div className="flex items-end gap-2 h-32">
                      {uso.historico.map((d) => {
                        const max = Math.max(...uso.historico.map((h) => h.requests), 1);
                        const h = Math.max(4, Math.round((d.requests / max) * 100));
                        return (
                          <div key={d.dia} className="flex-1 h-full flex flex-col items-center justify-end gap-1" title={`${d.dia}: ${d.requests} req.`}>
                            <span className="text-[10px] tabular-nums" style={{ color: "var(--text-4)" }}>{d.requests}</span>
                            <div className="w-full rounded-t-md" style={{ height: `${h}%`, background: d.requests > 0 ? "var(--accent)" : "var(--line-2)", opacity: d.requests > 0 ? 0.75 : 1 }} />
                            <span className="text-[10px]" style={{ color: "var(--text-4)" }}>{d.dia.slice(8)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Cartao>

          {/* Lista de tenants */}
          <Cartao titulo={`Tenants cadastrados (${tenants.length})`}>
            {loading ? (
              <div className="p-12 text-center text-sm" style={{ color: "var(--text-3)" }}>Carregando tenants...</div>
            ) : tenants.length === 0 ? (
              <div className="p-12 text-center text-sm" style={{ color: "var(--text-3)" }}>Nenhum tenant cadastrado ainda.</div>
            ) : (
              <ul>
                {tenants.map((t, i) => (
                  <li
                    key={t.id}
                    className="px-6 py-5 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors hover:bg-[var(--hover-solid)]"
                    style={i > 0 ? { borderTop: "1px solid var(--line)" } : undefined}
                  >
                    <div className="space-y-2 min-w-0">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="font-semibold text-base" style={{ color: "var(--text)" }}>{t.nome}</span>
                        <span className="text-xs px-2.5 py-1 rounded-full font-mono" style={{ background: "var(--card-2)", border: "1px solid var(--line)", color: "var(--text-3)" }}>
                          {t.slug}.acessorimobi.com.br
                        </span>
                        <Selo tom={t.status === "active" ? "ok" : "perigo"}>{t.status === "active" ? "Ativo" : t.status === "suspended" ? "Suspenso" : t.status}</Selo>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs" style={{ color: "var(--text-3)" }}>
                        <span>Modelo: <code className="font-mono" style={{ color: "var(--accent-text)" }}>{t.ollama_model}</code></span>
                        <span className="break-all">ID: <code className="font-mono" style={{ color: "var(--text-4)" }}>{t.id}</code></span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {t.status === "active" && (
                        <button onClick={() => handleSuspend(t.id)} className={BOTAO_REDONDO} style={{ color: "var(--text-3)" }} title="Suspender tenant" aria-label="Suspender tenant">
                          <PowerOff className="w-[18px] h-[18px]" />
                        </button>
                      )}
                      <button onClick={() => handleDelete(t.id)} className={BOTAO_REDONDO} style={{ color: "var(--danger)" }} title="Excluir tenant" aria-label="Excluir tenant">
                        <Trash2 className="w-[18px] h-[18px]" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
        </div>
      </div>

      {/* Modal criar tenant */}
      {modalOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center p-4 z-50"
          style={{ background: "rgb(0 0 0 / 0.5)", backdropFilter: "blur(4px)" }}
          role="dialog" aria-modal="true" aria-label="Provisionar novo tenant"
          onMouseDown={(e) => e.target === e.currentTarget && setModalOpen(false)}
        >
          <div className="max-w-lg w-full max-h-[92vh] overflow-y-auto rounded-3xl p-7 sm:p-8 space-y-6" style={{ background: "var(--card)", border: "1px solid var(--line)", boxShadow: "var(--sombra-funda)" }}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold flex items-center gap-2.5" style={{ color: "var(--text)" }}>
                <span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}><Building className="w-[18px] h-[18px]" /></span>
                Provisionar novo tenant
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className={BOTAO_REDONDO} style={{ color: "var(--text-3)" }} aria-label="Fechar"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleCreateTenant} className="space-y-5">
              <div>
                <label htmlFor="t-nome" className={ROTULO} style={{ color: "var(--text-3)" }}>Nome da imobiliária</label>
                <input id="t-nome" type="text" required placeholder="Ex: Imobiliária Alvorada" value={nome} onChange={(e) => setNome(e.target.value)} className={CAMPO} />
              </div>

              <div>
                <label htmlFor="t-slug" className={ROTULO} style={{ color: "var(--text-3)" }}>Slug (subdomínio)</label>
                <input id="t-slug" type="text" required placeholder="alvorada" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().trim())} className={`${CAMPO} font-mono`} />
              </div>

              <div>
                <label htmlFor="t-zap" className={ROTULO} style={{ color: "var(--text-3)" }}>WhatsApp do agente</label>
                <input id="t-zap" type="text" required placeholder="(31) 99999-8888" value={numeroWhatsapp} onChange={(e) => setNumeroWhatsapp(e.target.value)} className={CAMPO} />
              </div>

              <p className="text-xs leading-relaxed" style={{ color: "var(--text-3)" }}>
                A integração com o Imoview (endereço e chave da API) é configurada pela própria imobiliária no portal
                dela, em Configurações &rsaquo; Integrações.
              </p>

              <div className="pt-5 space-y-5" style={{ borderTop: "1px solid var(--line)" }}>
                <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Administrador inicial da imobiliária</p>

                <div>
                  <label htmlFor="t-adm-nome" className={ROTULO} style={{ color: "var(--text-3)" }}>Nome do administrador</label>
                  <input id="t-adm-nome" type="text" placeholder="Ex: Maria Silva" value={adminNome} onChange={(e) => setAdminNome(e.target.value)} className={CAMPO} />
                </div>

                <div>
                  <label htmlFor="t-adm-mail" className={ROTULO} style={{ color: "var(--text-3)" }}>E-mail do administrador</label>
                  <input id="t-adm-mail" type="email" placeholder="admin@imobiliaria.com.br" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className={CAMPO} />
                </div>

                <div>
                  <label htmlFor="t-adm-senha" className={ROTULO} style={{ color: "var(--text-3)" }}>Senha do administrador</label>
                  <input id="t-adm-senha" type="password" placeholder="Mínimo 8 caracteres" value={adminSenha} onChange={(e) => setAdminSenha(e.target.value)} className={CAMPO} />
                </div>
              </div>

              <div>
                <label htmlFor="t-modelo" className={ROTULO} style={{ color: "var(--text-3)" }}>Modelo Ollama</label>
                <select id="t-modelo" value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)} className={CAMPO}>
                  <option value="llama3.1:8b-instruct-q4_K_M">llama3.1:8b-instruct-q4_K_M (Padrão)</option>
                  <option value="qwen2.5:7b">qwen2.5:7b</option>
                  <option value="mistral-nemo:12b">mistral-nemo:12b</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-5" style={{ borderTop: "1px solid var(--line)" }}>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="h-11 px-5 rounded-full text-sm font-medium transition-colors hover:bg-[var(--hover-solid)]"
                  style={{ border: "1px solid var(--line-2)", color: "var(--text-2)", background: "var(--card)" }}
                >
                  Cancelar
                </button>
                <button type="submit" className="h-11 px-6 rounded-full text-sm font-semibold transition-opacity hover:opacity-90" style={{ background: "var(--chip)", color: "var(--chip-text)" }}>
                  Criar e provisionar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
