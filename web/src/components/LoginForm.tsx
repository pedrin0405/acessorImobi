"use client";

import React, { useState } from "react";
import { Lock, Mail, Phone, Building, ArrowRight, KeyRound } from "lucide-react";
import LogoAcessor from "@/components/shell/LogoAcessor";
import { TelaDeEntrada } from "@/components/tema/tema";
import { API_BASE, setToken } from "@/lib/api";

export type LoginMode = "developer" | "admin" | "corretor";

interface Props {
  mode: LoginMode;
  onSuccess: (role: string) => void;
  compact?: boolean;
  /** Conteúdo acima do cartão (ex.: seletor de perfil da página /login). */
  topo?: React.ReactNode;
}

export default function LoginForm({ mode, onSuccess, compact, topo }: Props) {
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
    developer: "Painel do Desenvolvedor",
    admin: "Portal da Imobiliária",
    corretor: "Portal do Corretor",
  };
  const subtitulos: Record<LoginMode, string> = {
    developer: "Entre com a senha de desenvolvedor.",
    admin: "Entre com o e-mail e a senha da sua imobiliária.",
    corretor: codigoEnviado ? "Digite o código que enviamos ao seu WhatsApp." : "Receba um código no WhatsApp cadastrado para entrar.",
  };

  const campo = "w-full h-12 pl-11 pr-4 rounded-2xl text-[15px] border outline-none transition-shadow focus:ring-4 focus:ring-[color:var(--accent-soft)] disabled:opacity-60";
  const icone = "w-[18px] h-[18px] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none";
  const rotulo = "block text-[13px] font-medium mb-1.5";

  const cartao = (
    <div
      className={`w-full max-w-[420px] rounded-3xl p-8 sm:p-10 space-y-7 ${compact ? "" : ""}`}
      style={{ background: "var(--card)", border: "1px solid var(--line)", boxShadow: "var(--sombra-funda)" }}
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <LogoAcessor className="w-16 h-16 rounded-2xl" alt="acessorImobi" />
        <div className="space-y-1.5">
          <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: "var(--text)" }}>{titles[mode]}</h1>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-3)" }}>{subtitulos[mode]}</p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-5">
        {mode === "developer" && (
          <div>
            <label htmlFor="dev-senha" className={rotulo} style={{ color: "var(--text-3)" }}>Senha de desenvolvedor</label>
            <div className="relative">
              <Lock className={icone} style={{ color: "var(--text-4)" }} />
              <input id="dev-senha" type="password" required value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="••••••••" autoComplete="current-password" className={campo} />
            </div>
          </div>
        )}

        {mode === "admin" && (
          <>
            <div>
              <label htmlFor="adm-slug" className={rotulo} style={{ color: "var(--text-3)" }}>Slug da imobiliária</label>
              <div className="relative">
                <Building className={icone} style={{ color: "var(--text-4)" }} />
                <input id="adm-slug" type="text" required value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().trim())} placeholder="alvorada" className={`${campo} font-mono`} />
              </div>
            </div>
            <div>
              <label htmlFor="adm-email" className={rotulo} style={{ color: "var(--text-3)" }}>E-mail</label>
              <div className="relative">
                <Mail className={icone} style={{ color: "var(--text-4)" }} />
                <input id="adm-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@imobiliaria.com.br" autoComplete="username" className={campo} />
              </div>
            </div>
            <div>
              <label htmlFor="adm-senha" className={rotulo} style={{ color: "var(--text-3)" }}>Senha</label>
              <div className="relative">
                <Lock className={icone} style={{ color: "var(--text-4)" }} />
                <input id="adm-senha" type="password" required value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" className={campo} />
              </div>
            </div>
          </>
        )}

        {mode === "corretor" && (
          <>
            <div>
              <label htmlFor="cor-slug" className={rotulo} style={{ color: "var(--text-3)" }}>Slug da imobiliária</label>
              <div className="relative">
                <Building className={icone} style={{ color: "var(--text-4)" }} />
                <input id="cor-slug" type="text" required value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().trim())} placeholder="alvorada" className={`${campo} font-mono`} />
              </div>
            </div>
            <div>
              <label htmlFor="cor-tel" className={rotulo} style={{ color: "var(--text-3)" }}>WhatsApp cadastrado</label>
              <div className="relative">
                <Phone className={icone} style={{ color: "var(--text-4)" }} />
                <input id="cor-tel" type="tel" required value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(31) 99999-8888" disabled={codigoEnviado} className={campo} />
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
                    className={`${campo} tracking-[0.3em] font-mono`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => { setCodigoEnviado(false); setCodigo(""); setAviso(null); }}
                  className="mt-2.5 text-[13px] underline underline-offset-2 hover:opacity-80"
                  style={{ color: "var(--text-3)" }}
                >
                  Trocar número ou pedir outro código
                </button>
              </div>
            )}
          </>
        )}

        {aviso && !error && (
          <div role="status" className="px-3.5 py-3 rounded-2xl text-[13px] leading-relaxed" style={{ background: "var(--accent-soft)", color: "var(--accent-text)", border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)" }}>{aviso}</div>
        )}

        {error && (
          <div role="alert" className="px-3.5 py-3 rounded-2xl text-[13px] leading-relaxed" style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)", color: "var(--danger)", border: "1px solid color-mix(in srgb, var(--danger) 28%, transparent)" }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full h-12 rounded-full text-[15px] font-semibold flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--accent-soft)]"
          style={{ background: "var(--chip)", color: "var(--chip-text)" }}
        >
          {loading ? "Aguarde..." : mode === "corretor" && !codigoEnviado ? "Receber código no WhatsApp" : "Entrar"}
          {!loading && <ArrowRight className="w-4 h-4" />}
        </button>
      </form>
    </div>
  );

  if (compact) return <div className="w-full flex justify-center">{cartao}</div>;
  return (
    <TelaDeEntrada>
      {topo}
      {cartao}
    </TelaDeEntrada>
  );
}
