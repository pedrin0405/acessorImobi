"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import LoginForm, { LoginMode } from "@/components/LoginForm";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>("corretor");

  const redirect: Record<string, string> = {
    developer: "/admin",
    admin: "/tenant",
    corretor: "/corretor",
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 gap-6">
      <div className="flex bg-slate-800 border border-slate-700 p-1 rounded-xl text-xs font-medium">
        {(["corretor", "admin", "developer"] as LoginMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`px-4 py-1.5 rounded-lg transition-all ${
              mode === m
                ? m === "developer"
                  ? "bg-sky-600 text-white"
                  : m === "admin"
                  ? "bg-emerald-600 text-white"
                  : "bg-amber-600 text-white"
                : "text-slate-400"
            }`}
          >
            {m === "developer" ? "Dev" : m === "admin" ? "Imobiliária" : "Corretor"}
          </button>
        ))}
      </div>

      <LoginForm
        mode={mode}
        onSuccess={(role) => router.push(redirect[role] || "/")}
      />
    </div>
  );
}
