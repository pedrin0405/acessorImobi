"use client";

import React, { useEffect, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck, Smartphone, Unplug } from "lucide-react";
import { fetchApi } from "@/lib/api";

interface Status {
  status: "not_provisioned" | "disconnected" | "qr_pending" | "connected" | "numero_divergente";
  numero: string | null;
  qr_code: string | null;
  pairing_code?: string | null;
  mensagem?: string;
}

interface Preferencias {
  ativo: boolean;
  avisos: boolean;
  carteira_auto: boolean;
}

const PREFERENCIAS: { chave: keyof Preferencias; titulo: string; texto: string }[] = [
  { chave: "ativo", titulo: "Assistente ligado", texto: "Lê e analisa seus atendimentos. Desligado, nada novo é lido." },
  {
    chave: "avisos",
    titulo: "Avisar quando um cliente esperar resposta",
    texto: "Manda no WhatsApp do agente um resumo e uma sugestão de resposta, só no horário comercial.",
  },
  {
    chave: "carteira_auto",
    titulo: "Anotar clientes na carteira",
    texto: "Atendimentos sobre imóveis viram clientes na sua carteira, com o que cada um procura.",
  },
];

export default function MeuWhatsApp({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [pairing, setPairing] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Preferencias | null>(null);
  const [consentimento, setConsentimento] = useState(false);
  const [acao, setAcao] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = async () => {
    try {
      const [rS, rP] = await Promise.all([fetchApi("/corretor/whatsapp"), fetchApi("/corretor/assistente")]);
      if (!rS.ok || !rP.ok) {
        setErro("Não foi possível consultar seu WhatsApp. Entre de novo no Portal do Corretor.");
        return;
      }
      setStatus(await rS.json());
      setPrefs(await rP.json());
    } catch (e) {
      if (!onAuthError(e)) setErro("Não foi possível consultar seu WhatsApp.");
    }
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enquanto o pareamento está pendente, acompanha até conectar.
  useEffect(() => {
    if (status?.status !== "qr_pending") return;
    const timer = setInterval(async () => {
      try {
        const res = await fetchApi("/corretor/whatsapp");
        if (res.ok) {
          const novo: Status = await res.json();
          setStatus((atual) => (novo.status === "qr_pending" ? { ...novo, qr_code: novo.qr_code ?? atual?.qr_code ?? null } : novo));
          if (novo.status !== "qr_pending") setPairing(null);
        }
      } catch (e) {
        onAuthError(e);
      }
    }, 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.status]);

  const conectar = async () => {
    setAcao(true);
    setErro(null);
    try {
      const res = await fetchApi("/corretor/whatsapp/conectar", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(data.detail || "Não foi possível gerar a conexão.");
        return;
      }
      setStatus(data);
      setPairing(data.pairing_code ?? null);
    } catch (e) {
      if (!onAuthError(e)) setErro("Falha na comunicação com o serviço de WhatsApp.");
    } finally {
      setAcao(false);
    }
  };

  const desconectar = async () => {
    if (!confirm("Desconectar seu WhatsApp? O assistente para de ler seus atendimentos.")) return;
    setAcao(true);
    try {
      const res = await fetchApi("/corretor/whatsapp/desconectar", { method: "POST" });
      if (res.ok) setStatus(await res.json());
    } catch (e) {
      onAuthError(e);
    } finally {
      setAcao(false);
    }
  };

  const salvarPref = async (chave: keyof Preferencias, valor: boolean) => {
    if (!prefs) return;
    const novo = { ...prefs, [chave]: valor };
    setPrefs(novo);
    try {
      const res = await fetchApi("/corretor/assistente", { method: "PUT", body: JSON.stringify(novo) });
      if (!res.ok) throw new Error("falha");
    } catch (e) {
      if (!onAuthError(e)) {
        setPrefs(prefs);
        setErro("Não foi possível salvar a preferência.");
      }
    }
  };

  const conectado = status?.status === "connected";
  const qr = status?.qr_code ? (status.qr_code.startsWith("data:") ? status.qr_code : `data:image/png;base64,${status.qr_code}`) : null;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-amber-600" /> Meu WhatsApp
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Conecte o seu número para o assistente acompanhar seus atendimentos e te ajudar a vender.
            </p>
          </div>
          {conectado && (
            <span className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5" /> Conectado
            </span>
          )}
        </div>

        {erro && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">{erro}</div>}
        {status?.status === "numero_divergente" && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">{status.mensagem}</div>
        )}

        {!status ? (
          !erro && <p className="text-sm text-slate-400">Consultando...</p>
        ) : conectado ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              Número <strong>{status.numero}</strong> conectado. O Acessor lê suas conversas com clientes e só envia
              mensagens por este número quando você manda pelo portal; nunca por conta própria.
            </p>
            <button
              onClick={desconectar}
              disabled={acao}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <Unplug className="w-4 h-4" /> Desconectar
            </button>
          </div>
        ) : status.status === "qr_pending" && (qr || pairing) ? (
          <div className="grid md:grid-cols-2 gap-6 items-start">
            {qr && (
              <div className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="QR code para conectar o WhatsApp" className="w-56 h-56 border border-slate-200 rounded-xl" />
                <p className="text-xs text-slate-500">Use se estiver vendo esta tela em outro aparelho.</p>
              </div>
            )}
            <div className="space-y-3 text-sm text-slate-600">
              {pairing && (
                <div>
                  <p className="text-xs text-slate-500">Código de pareamento</p>
                  <p className="text-2xl font-mono font-bold tracking-[0.25em] text-slate-900">{pairing}</p>
                </div>
              )}
              <ol className="list-decimal pl-5 space-y-1">
                <li>No celular, abra o WhatsApp → <strong>Aparelhos conectados</strong> → <strong>Conectar aparelho</strong>.</li>
                <li>
                  Leia o QR code, ou toque em <strong>Conectar com número de telefone</strong> e digite o código acima.
                </li>
                <li>Use o mesmo número cadastrado na imobiliária ({status.numero}).</li>
              </ol>
              <p className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Aguardando a conexão...
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 space-y-2">
              <p className="font-medium text-slate-800 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-600" /> Como funciona
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>O assistente lê as conversas individuais deste número (grupos ficam de fora).</li>
                <li>Ele <strong>nunca envia nada sozinho</strong> aos seus clientes: só sai mensagem pelo seu número quando você escreve ou escolhe imóveis no portal e confirma o envio. Resumos e sugestões chegam só para você.</li>
                <li>Só você vê seus atendimentos no portal; a imobiliária não tem acesso às conversas.</li>
                <li>As mensagens ficam guardadas por até 180 dias. Você pode desconectar quando quiser.</li>
              </ul>
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={consentimento}
                onChange={(e) => setConsentimento(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-amber-600"
              />
              Entendi e autorizo o assistente a ler meus atendimentos para me ajudar.
            </label>
            <button
              onClick={conectar}
              disabled={!consentimento || acao}
              className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-medium"
            >
              {acao ? "Gerando conexão..." : "Conectar meu WhatsApp"}
            </button>
          </div>
        )}
      </div>

      {prefs && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <h3 className="font-semibold text-slate-900">Preferências do assistente</h3>
          {PREFERENCIAS.map((p) => (
            <label key={p.chave} className="flex items-start justify-between gap-4 cursor-pointer">
              <span>
                <span className="block text-sm font-medium text-slate-800">{p.titulo}</span>
                <span className="block text-xs text-slate-500">{p.texto}</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={prefs[p.chave]}
                onChange={(e) => salvarPref(p.chave, e.target.checked)}
                className="mt-1 h-4 w-4 accent-amber-600"
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
