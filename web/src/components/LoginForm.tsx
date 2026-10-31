"use client";

import React, { useState } from "react";
import { Lock, Mail, Phone, Building, ArrowRight, KeyRound, Eye, EyeOff } from "lucide-react";
import { MarcaHorizontal } from "@/components/marca/Marca";
import { TelaDeEntrada } from "@/components/tema/tema";
import { API_BASE, setToken } from "@/lib/api";

export type LoginMode = "developer" | "admin" | "corretor";

interface Props {
  mode: LoginMode;
  onSuccess: (role: string) => void;
  compact?: boolean;
  /** Perfis para o seletor em pílula do topo do formulário (página /login); sem isso o seletor não aparece. */
  perfis?: { id: LoginMode; rotulo: string }[];
  onPerfil?: (m: LoginMode) => void;
}

export default function LoginForm({ mode, onSuccess, compact, perfis, onPerfil }: Props) {
  const [verSenha, setVerSenha] = useState(false);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [telefone, setTelefone] = useState("");
  const [slug, setSlug] = useState("");
  // Corretor entra com um código enviado ao WhatsApp dele (o portal mostra conversas com clientes).
  const [codigo, setCodigo] = useState("");
  const [codigoEnviado, setCodigoEnviado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      let path = "";
      let body: Record<string, string> = {};

      if (mode === "developer") {
        path = "/auth/dev/login";
        body = { senha };
      } else if (mode === "admin") {
        path = "/auth/admin/login";
        body = { email, senha, slug_tenant: slug };
      } else if (!codigoEnviado) {
        const res = await fetch(`${API_BASE}/auth/corretor/codigo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telefone, slug_tenant: slug }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.detail || "Não foi possível enviar o código");
          return;
        }
        setCodigoEnviado(true);
        setAviso(data.detail || "Enviamos um código para o seu WhatsApp.");
        return;
      } else {
        path = "/auth/corretor/login";
        body = { telefone, slug_tenant: slug, codigo };
      }

      const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail || "Não foi possível autenticar");
        return;
      }

      setToken(data.access_token);
      localStorage.setItem("acessor_role", data.role);
      onSuccess(data.role);
    } catch {
      setError("Falha de comunicação com a API. Verifique se ela está rodando.");
    } finally {
      setLoading(false);
    }
  };

  const titles: Record<LoginMode, string> = {
    developer: "Painel do desenvolvedor",
    admin: "Bem-vindo(a) de volta!",
    corretor: "Bem-vindo(a) de volta!",
  };
  const subtitulos: Record<LoginMode, string> = {
    developer: "Entre com a senha de desenvolvedor para gerenciar a plataforma.",
    admin: "Estamos felizes em ter você conosco novamente. Entre com o e-mail e a senha da sua imobiliária.",
    corretor: codigoEnviado ? "Digite o código que enviamos ao seu WhatsApp." : "Receba um código no WhatsApp cadastrado para entrar.",
  };

  const campo = "w-full h-[52px] pl-12 pr-5 rounded-full text-[15px] border outline-none transition-shadow placeholder:text-[var(--text-4)] focus:ring-4 focus:ring-[color:var(--accent-soft)] focus:border-[var(--accent)] disabled:opacity-60";
  const estiloCampo = { background: "#ffffff", borderColor: "var(--line-2)", color: "var(--text)" } as const;
  const icone = "w-[18px] h-[18px] absolute left-[18px] top-1/2 -translate-y-1/2 pointer-events-none";
  const rotulo = "block text-[13px] font-medium mb-1.5 pl-1";

  const senhaCampo = (id: string, valor: string, mudar: (v: string) => void, rot: string) => (
    <div>
      <label htmlFor={id} className={rotulo} style={{ color: "var(--text-3)" }}>{rot}</label>
      <div className="relative">
        <Lock className={icone} style={{ color: "var(--text-4)" }} />
        <input
          id={id} type={verSenha ? "text" : "password"} required value={valor} onChange={(e) => mudar(e.target.value)}
          placeholder="Digite sua senha" autoComplete="current-password" className={`${campo} pr-12`} style={estiloCampo}
        />
        <button
          type="button" onClick={() => setVerSenha((v) => !v)} aria-label={verSenha ? "Ocultar senha" : "Mostrar senha"}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-full hover:opacity-80" style={{ color: "var(--text-3)" }}
        >
          {verSenha ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
        </button>
      </div>
    </div>
  );

  const conteudo = (
    <div className="w-full space-y-7">
      <MarcaHorizontal animada className="h-12 w-auto" alt="Acessor Imobi" />

      <div className="space-y-2">
        <h1 className="text-[34px] sm:text-[38px] leading-[1.1] font-bold tracking-tight" style={{ color: "var(--text)" }}>{titles[mode]}</h1>
        <p className="text-[15.5px] leading-relaxed" style={{ color: "var(--text-3)" }}>{subtitulos[mode]}</p>
      </div>

      {perfis && onPerfil && (
        <div className="grid p-1 rounded-full" role="tablist" aria-label="Perfil de acesso" style={{ gridTemplateColumns: `repeat(${perfis.length}, 1fr)`, background: "var(--card-2)", border: "1px solid var(--line)" }}>
          {perfis.map((p) => (
            <button
              key={p.id} type="button" role="tab" aria-selected={mode === p.id} onClick={() => onPerfil(p.id)}
              className="h-11 rounded-full text-[14px] font-medium transition-all"
              style={mode === p.id ? { background: "#ffffff", color: "var(--text)", boxShadow: "var(--sombra)" } : { color: "var(--text-3)" }}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        {mode === "developer" && senhaCampo("dev-senha", senha, setSenha, "Senha de desenvolvedor")}

        {mode === "admin" && (
          <>
            <div>
              <label htmlFor="adm-slug" className={rotulo} style={{ color: "var(--text-3)" }}>Identificador da imobiliária</label>
              <div className="relative">
                <Building className={icone} style={{ color: "var(--text-4)" }} />
                <input id="adm-slug" type="text" required value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().trim())} placeholder="Ex.: alvorada" className={`${campo} font-mono`} style={estiloCampo} />
              </div>
            </div>
            <div>
              <label htmlFor="adm-email" className={rotulo} style={{ color: "var(--text-3)" }}>E-mail</label>
              <div className="relative">
                <Mail className={icone} style={{ color: "var(--text-4)" }} />
                <input id="adm-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Digite seu e-mail" autoComplete="username" className={campo} style={estiloCampo} />
              </div>
            </div>
            {senhaCampo("adm-senha", senha, setSenha, "Senha")}
          </>
        )}

        {mode === "corretor" && (
          <>
            <div>
              <label htmlFor="cor-slug" className={rotulo} style={{ color: "var(--text-3)" }}>Identificador da imobiliária</label>
              <div className="relative">
                <Building className={icone} style={{ color: "var(--text-4)" }} />
                <input id="cor-slug" type="text" required value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().trim())} placeholder="Ex.: alvorada" className={`${campo} font-mono`} style={estiloCampo} />
              </div>
            </div>
            <div>
              <label htmlFor="cor-tel" className={rotulo} style={{ color: "var(--text-3)" }}>WhatsApp cadastrado</label>
              <div className="relative">
                <Phone className={icone} style={{ color: "var(--text-4)" }} />
                <input id="cor-tel" type="tel" required value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(31) 99999-8888" disabled={codigoEnviado} className={campo} style={estiloCampo} />
              </div>
            </div>
            {codigoEnviado && (
              <div>
                <label htmlFor="codigo" className={rotulo} style={{ color: "var(--text-3)" }}>Código recebido no WhatsApp</label>
                <div className="relative">
                  <KeyRound className={icone} style={{ color: "var(--text-4)" }} />
                  <input
                    id="codigo" inputMode="numeric" autoComplete="one-time-code" required autoFocus maxLength={6} value={codigo}
                    onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} placeholder="000000"
                    className={`${campo} tracking-[0.3em] font-mono`} style={estiloCampo}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => { setCodigoEnviado(false); setCodigo(""); setAviso(null); }}
                  className="mt-2.5 ml-1 text-[13px] font-medium hover:opacity-80"
                  style={{ color: "var(--accent-text)" }}
                >
                  Trocar número ou pedir outro código
                </button>
              </div>
            )}
          </>
        )}

        {aviso && !error && (
          <div role="status" className="px-4 py-3 rounded-2xl text-[13px] leading-relaxed" style={{ background: "var(--accent-soft)", color: "var(--accent-text)", border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)" }}>{aviso}</div>
        )}

        {error && (
          <div role="alert" className="px-4 py-3 rounded-2xl text-[13px] leading-relaxed" style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)", color: "var(--danger)", border: "1px solid color-mix(in srgb, var(--danger) 28%, transparent)" }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full h-[54px] rounded-full text-[16px] font-semibold flex items-center justify-center gap-2 transition-[opacity,transform] hover:opacity-95 active:scale-[0.99] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--accent-soft)]"
          style={{ background: "var(--accent-strong)", color: "#ffffff", boxShadow: "0 12px 28px -12px color-mix(in srgb, var(--accent-strong) 75%, transparent)" }}
        >
          {loading ? "Aguarde..." : mode === "corretor" && !codigoEnviado ? "Receber código no WhatsApp" : "Entrar"}
          {!loading && <ArrowRight className="w-4 h-4" />}
        </button>
      </form>
    </div>
  );

  if (compact) return <div className="app-tema app-claro w-full">{conteudo}</div>;
  return <TelaDeEntrada>{conteudo}</TelaDeEntrada>;
}
