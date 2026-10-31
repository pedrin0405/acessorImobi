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
      perfis={PERFIS}
      onPerfil={setMode}
    />
  );
}
