"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import LoginForm, { LoginMode } from "@/components/LoginForm";

const PERFIS: { id: LoginMode; rotulo: string }[] = [
  { id: "corretor", rotulo: "Corretor" },
  { id: "admin", rotulo: "Imobiliária" },
  { id: "developer", rotulo: "Dev" },
];

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>("corretor");

  const redirect: Record<string, string> = {
    developer: "/admin",
    admin: "/tenant",
    corretor: "/corretor",
  };

  return (
    <LoginForm
      key={mode}
      mode={mode}
      onSuccess={(role) => router.push(redirect[role] || "/")}
      topo={
        <div className="inline-flex p-1 rounded-full gap-1" role="tablist" aria-label="Perfil de acesso" style={{ background: "var(--card)", border: "1px solid var(--line)", boxShadow: "var(--sombra)" }}>
          {PERFIS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={mode === p.id}
              onClick={() => setMode(p.id)}
              className="h-9 px-5 rounded-full text-[13px] font-medium transition-colors"
              style={mode === p.id ? { background: "var(--chip)", color: "var(--chip-text)" } : { color: "var(--text-3)" }}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
      }
    />
  );
}
