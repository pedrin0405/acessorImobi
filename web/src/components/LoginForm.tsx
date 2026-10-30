"use client";

import React, { useState } from "react";
import { Lock, Mail, Phone, Building, ArrowRight, KeyRound } from "lucide-react";
import { API_BASE, setToken } from "@/lib/api";

export type LoginMode = "developer" | "admin" | "corretor";

interface Props {
  mode: LoginMode;
  onSuccess: (role: string) => void;
  compact?: boolean;
}

export default function LoginForm({ mode, onSuccess, compact }: Props) {
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

  return (
    <div className={compact ? "w-full" : "min-h-screen flex items-center justify-center p-4 bg-slate-900"}>
      <div className={`bg-slate-800 border border-slate-700/60 rounded-3xl p-8 w-full ${compact ? "max-w-md" : "max-w-md shadow-2xl"} space-y-6 text-slate-100`}>
        <div className="text-center space-y-2">
          <h1 className="text-xl font-bold tracking-tight text-white">{titles[mode]}</h1>
          <p className="text-sm text-slate-400">Informe suas credenciais para continuar</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === "developer" && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Senha de Desenvolvedor</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="password"
                  required
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>
          )}

          {mode === "admin" && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Slug da Imobiliária</label>
                <div className="relative">
                  <Building className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    required
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().trim())}
                    placeholder="alvorada"
                    className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">E-mail</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@imobiliaria.com.br"
                    className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Senha</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="password"
                    required
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </>
          )}

          {mode === "corretor" && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Slug da Imobiliária</label>
                <div className="relative">
                  <Building className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    required
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().trim())}
                    placeholder="alvorada"
                    className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">WhatsApp cadastrado</label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="tel"
                    required
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    placeholder="(31) 99999-8888"
                    disabled={codigoEnviado}
                    className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm focus:outline-none focus:border-amber-500 disabled:opacity-60"
                  />
                </div>
              </div>
              {codigoEnviado && (
                <div>
                  <label htmlFor="codigo" className="block text-xs font-medium text-slate-400 mb-1">Código recebido no WhatsApp</label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                    <input
                      id="codigo"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      required
                      autoFocus
                      maxLength={6}
                      value={codigo}
                      onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
                      placeholder="000000"
                      className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm tracking-[0.3em] font-mono focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCodigoEnviado(false);
                      setCodigo("");
                      setAviso(null);
                    }}
                    className="mt-2 text-xs text-slate-400 underline hover:text-slate-200"
                  >
                    Trocar número ou pedir outro código
                  </button>
                </div>
              )}
            </>
          )}

          {aviso && !error && (
            <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs">{aviso}</div>
          )}

          {error && (
            <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium rounded-xl text-sm shadow-lg shadow-sky-600/20 flex items-center justify-center gap-2 transition-all"
          >
            {loading
              ? "Aguarde..."
              : mode === "corretor" && !codigoEnviado
                ? "Receber código no WhatsApp"
                : "Entrar"}{" "}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
