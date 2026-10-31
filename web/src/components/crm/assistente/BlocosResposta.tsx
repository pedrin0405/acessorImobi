"use client";

import React, { useEffect, useState } from "react";
import { BookOpen, Download, ExternalLink, FileText, Loader2, Send } from "lucide-react";
import { fetchApi, tokenCorretorId } from "@/lib/api";
import { useEhCorretor } from "@/components/portal/papel";
import { brl } from "@/lib/crm";
import CartaoImovel from "@/components/crm/imoveis/CartaoImovel";

export interface CartaoIA {
  codigo: number;
  titulo: string | null;
  finalidade: string | null;
  tipo: string | null;
  bairro: string | null;
  cidade: string | null;
  valor: number | null;
  quartos: number | null;
  suites: number | null;
  vagas: number | null;
  area_m2: number | null;
  foto_url: string | null;
  link: string | null;
}

export type BlocoIA =
  | { tipo: "imoveis"; titulo?: string | null; imoveis: CartaoIA[] }
  | { tipo: "book"; titulo: string; modelo: string; arquivo: string; url: string; imoveis: CartaoIA[] };

interface CorretorAtivo { id: string; nome: string | null; telefone_mascarado: string; status: string }

function EnviarAoCorretor({ bloco, onAuthError }: { bloco: BlocoIA; onAuthError: (e: unknown) => boolean }) {
  const ehCorretor = useEhCorretor();  // o corretor recebe no próprio WhatsApp: sem escolher destinatário
  const [aberto, setAberto] = useState(false);
  const [corretores, setCorretores] = useState<CorretorAtivo[] | null>(null);
  const [destino, setDestino] = useState(ehCorretor ? tokenCorretorId() : "");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    if (!aberto || corretores || ehCorretor) return;
    fetchApi("/admin/corretores")
      .then(async (r) => (r.ok ? ((await r.json()) as CorretorAtivo[]).filter((c) => c.status === "active") : []))
      .then(setCorretores)
      .catch((e) => { if (!onAuthError(e)) setCorretores([]); });
  }, [aberto, corretores, onAuthError]);

  const enviar = async () => {
    if (!destino) return;
    setEnviando(true);
    setAviso(null);
    const codigos = bloco.imoveis.map((i) => i.codigo);
    const corpo = bloco.tipo === "book" ? { tipo: "book", codigos, titulo: bloco.titulo, mensagem: "" } : { tipo: "imoveis", codigos: codigos.slice(0, 6), mensagem: "" };
    try {
      const r = await fetchApi(`/admin/conversas/${destino}/acoes-rapidas/enviar`, { method: "POST", body: JSON.stringify(corpo) });
      const d = await r.json().catch(() => null);
      if (!r.ok) setAviso({ ok: false, texto: typeof d?.detail === "string" ? d.detail : "Não consegui enviar agora." });
      else setAviso({ ok: true, texto: bloco.tipo === "book" ? "Book enviado pelo WhatsApp do agente." : "Cartões enviados pelo WhatsApp do agente." });
    } catch (e) {
      if (!onAuthError(e)) setAviso({ ok: false, texto: "Falha de conexão. Tente de novo." });
    }
    setEnviando(false);
  };

  return (
    <div className="mt-3">
      {ehCorretor ? (
        <button type="button" onClick={enviar} disabled={enviando} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm hover:bg-[var(--hover-solid)] disabled:opacity-50" style={{ border: "1px solid var(--line-2)", color: "var(--text-2)" }}>
          {enviando ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Send className="w-4 h-4" aria-hidden />}Enviar para o meu WhatsApp
        </button>
      ) : !aberto ? (
        <button type="button" onClick={() => setAberto(true)} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm hover:bg-[var(--hover-solid)]" style={{ border: "1px solid var(--line-2)", color: "var(--text-2)" }}>
          <Send className="w-4 h-4" aria-hidden />Enviar a um corretor
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Corretor que receberá" value={destino} onChange={(e) => { setDestino(e.target.value); setAviso(null); }} className="px-3 py-1.5 rounded-xl text-sm" style={{ background: "var(--card-2)", border: "1px solid var(--line-2)", color: "var(--text)" }}>
            <option value="">{corretores ? "Escolha o corretor" : "Carregando…"}</option>
            {(corretores || []).map((c) => <option key={c.id} value={c.id}>{c.nome || c.telefone_mascarado}</option>)}
          </select>
          <button type="button" onClick={enviar} disabled={!destino || enviando} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium disabled:opacity-50" style={{ background: "var(--chip)", color: "var(--chip-text)" }}>
            {enviando ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Send className="w-4 h-4" aria-hidden />}Enviar
          </button>
          <button type="button" onClick={() => { setAberto(false); setAviso(null); }} className="px-2 py-1.5 text-sm" style={{ color: "var(--text-3)" }}>Cancelar</button>
        </div>
      )}
      {aviso && <p role="status" className="mt-2 text-xs" style={{ color: aviso.ok ? "var(--accent-text)" : "var(--danger)" }}>{aviso.texto}</p>}
    </div>
  );
}

function Cartoes({ imoveis }: { imoveis: CartaoIA[] }) {
  return (
    <ul className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x" aria-label="Imóveis encontrados">
      {imoveis.map((i) => (
        <li key={i.codigo} className="snap-start shrink-0 w-[15.5rem] flex flex-col gap-1.5">
          <div className="flex-1">
            <CartaoImovel
              foto={i.foto_url}
              titulo={i.titulo || `${i.tipo || "Imóvel"} em ${i.bairro || "local não informado"}`}
              subtitulo={[i.bairro, i.cidade].filter(Boolean).join(" · ")}
              preco={i.valor ? `${brl(i.valor)}${i.finalidade === "aluguel" ? "/mês" : ""}` : "Sob consulta"}
              selo={i.finalidade === "aluguel" ? "Aluguel" : i.finalidade === "venda" ? "Venda" : undefined}
              codigo={i.codigo}
              quartos={i.quartos}
              vagas={i.vagas}
              area={i.area_m2 ? Math.round(i.area_m2) : null}
            />
          </div>
          {i.link && (
            <a href={i.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs hover:bg-[var(--hover-solid)]" style={{ border: "1px solid var(--line-2)", color: "var(--text-2)" }}>
              <ExternalLink className="w-3.5 h-3.5" aria-hidden />Ver no site
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function CartaoBook({ bloco, onAuthError }: { bloco: Extract<BlocoIA, { tipo: "book" }>; onAuthError: (e: unknown) => boolean }) {
  const [carregando, setCarregando] = useState<"abrir" | "baixar" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const pdf = async (modo: "abrir" | "baixar") => {
    setCarregando(modo);
    setErro(null);
    try {
      const r = await fetchApi(bloco.url);
      if (!r.ok) throw new Error("Não encontrei o arquivo deste book.");
      const endereco = URL.createObjectURL(await r.blob());
      if (modo === "abrir") window.open(endereco, "_blank", "noopener");
      else {
        const a = document.createElement("a");
        a.href = endereco;
        a.download = bloco.arquivo;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(endereco), 60000);
    } catch (e) {
      if (!onAuthError(e)) setErro(e instanceof Error ? e.message : "Não consegui abrir o PDF agora.");
    }
    setCarregando(null);
  };

  const n = bloco.imoveis.length;
  return (
    <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--line-2)" }}>
      <div className="flex items-start gap-3">
        <span className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center" style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }} aria-hidden><FileText className="w-5 h-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>{bloco.titulo}</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>Book · {n} {n === 1 ? "imóvel" : "imóveis"} · modelo {bloco.modelo}</p>
          <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--text-4)" }}>{bloco.arquivo}</p>
        </div>
        <div className="hidden sm:flex -space-x-2 shrink-0" aria-hidden>
          {bloco.imoveis.filter((i) => i.foto_url).slice(0, 3).map((i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i.codigo} src={i.foto_url!} alt="" referrerPolicy="no-referrer" className="w-11 h-11 rounded-lg object-cover" style={{ border: "2px solid var(--card)" }} />
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => pdf("abrir")} disabled={!!carregando} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium disabled:opacity-60" style={{ background: "var(--chip)", color: "var(--chip-text)" }}>
          {carregando === "abrir" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <BookOpen className="w-4 h-4" aria-hidden />}Abrir PDF
        </button>
        <button type="button" onClick={() => pdf("baixar")} disabled={!!carregando} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm hover:bg-[var(--hover-solid)] disabled:opacity-60" style={{ border: "1px solid var(--line-2)", color: "var(--text-2)" }}>
          {carregando === "baixar" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Download className="w-4 h-4" aria-hidden />}Baixar
        </button>
      </div>
      {erro && <p role="alert" className="mt-2 text-xs" style={{ color: "var(--danger)" }}>{erro}</p>}
      <EnviarAoCorretor bloco={bloco} onAuthError={onAuthError} />
    </div>
  );
}

/** Cartões de imóveis e books anexados à resposta do assistente. */
export default function BlocosResposta({ blocos, onAuthError }: { blocos: BlocoIA[]; onAuthError: (e: unknown) => boolean }) {
  if (!blocos?.length) return null;
  return (
    <div className="mt-4 space-y-4">
      {blocos.map((b, i) =>
        b.tipo === "book" ? (
          <div key={i} className="space-y-3">
            <CartaoBook bloco={b} onAuthError={onAuthError} />
            {b.imoveis.length > 0 && <Cartoes imoveis={b.imoveis} />}
          </div>
        ) : (
          <div key={i}>
            {b.titulo && <p className="text-xs mb-2" style={{ color: "var(--text-3)" }}>{b.titulo}</p>}
            <Cartoes imoveis={b.imoveis} />
            <EnviarAoCorretor bloco={b} onAuthError={onAuthError} />
          </div>
        )
      )}
    </div>
  );
}
