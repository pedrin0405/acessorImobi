"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Eye, EyeOff, Loader2, PlugZap, RefreshCw, Unplug } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { useSincronizacao } from "@/components/crm/imoveis/useSincronizacao";
import { relativo } from "@/components/crm/imoveis/tipos";

const URL_PADRAO = "https://api.imoview.com.br";
const campo = "w-full px-4 py-2.5 rounded-xl text-sm outline-none border transition-colors focus-visible:border-[var(--accent)]";
const estiloCampo: React.CSSProperties = { background: "var(--input)", borderColor: "var(--line-2)", color: "var(--text)" };

interface ResultadoTeste {
  ok: boolean;
  mensagem: string;
  imoveis_venda?: number;
  imoveis_aluguel?: number;
}

const detalhe = (dados: { detail?: unknown }, padrao: string) => (typeof dados.detail === "string" ? dados.detail : padrao);

export default function ImoviewCard({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const { status, erro: erroStatus, aplicar, carregar, sincronizar, sincronizando } = useSincronizacao(onAuthError);
  const [url, setUrl] = useState(URL_PADRAO);
  const [chave, setChave] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [teste, setTeste] = useState<ResultadoTeste | null>(null);
  const [testando, setTestando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [limparCache, setLimparCache] = useState(false);
  const [desconectando, setDesconectando] = useState(false);

  const configurado = !!status?.configurado;
  const sync = status?.sincronizacao;

  // Preenche o endereço salvo (a chave nunca volta da API).
  useEffect(() => {
    if (status?.base_url) setUrl(status.base_url);
  }, [status?.base_url]);

  const dadosDoFormulario = () => ({ base_url: url.trim(), chave: chave.trim() });
  const faltaChave = !configurado && !chave.trim();

  const chamar = async (caminho: string, metodo: string, corpo?: object) => {
    const res = await fetchApi(`/admin/integracoes/imoview${caminho}`, { method: metodo, body: corpo ? JSON.stringify(corpo) : undefined });
    return { res, dados: await res.json().catch(() => ({})) };
  };

  const testar = async () => {
    setMensagem(null);
    setTeste(null);
    setTestando(true);
    try {
      const { res, dados } = await chamar("/testar", "POST", dadosDoFormulario());
      if (!res.ok) setTeste({ ok: false, mensagem: detalhe(dados, "Não foi possível testar agora.") });
      else setTeste(dados);
    } catch (e) {
      if (!onAuthError(e)) setTeste({ ok: false, mensagem: "Falha de conexão ao testar." });
    } finally {
      setTestando(false);
    }
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensagem(null);
    setSalvando(true);
    try {
      const { res, dados } = await chamar("", "PUT", dadosDoFormulario());
      if (!res.ok) {
        setMensagem({ tipo: "erro", texto: detalhe(dados, "Não foi possível salvar.") });
        return;
      }
      aplicar(dados);
      setChave("");
      setTeste(null);
      setMensagem({ tipo: "ok", texto: "Conexão confirmada e salva. Os imóveis estão sendo sincronizados." });
    } catch (err) {
      if (!onAuthError(err)) setMensagem({ tipo: "erro", texto: "Falha de conexão ao salvar." });
    } finally {
      setSalvando(false);
    }
  };

  const pedirSync = async () => {
    setMensagem(null);
    const falha = await sincronizar();
    if (falha) setMensagem({ tipo: "erro", texto: falha });
  };

  const desconectar = async () => {
    setDesconectando(true);
    setMensagem(null);
    try {
      const { res, dados } = await chamar(`?limpar_cache=${limparCache}`, "DELETE");
      if (!res.ok) {
        setMensagem({ tipo: "erro", texto: detalhe(dados, "Não foi possível desconectar.") });
        return;
      }
      aplicar(dados);
      setConfirmando(false);
      setLimparCache(false);
      setUrl(URL_PADRAO);
      setMensagem({ tipo: "ok", texto: "Integração desconectada. A chave foi apagada." });
    } catch (e) {
      if (!onAuthError(e)) setMensagem({ tipo: "erro", texto: "Falha de conexão ao desconectar." });
    } finally {
      setDesconectando(false);
    }
  };

  const pill = !status
    ? null
    : sync?.estado === "erro" && configurado
      ? { texto: "Com erro", cor: "var(--danger)" }
      : sincronizando
        ? { texto: "Sincronizando", cor: "var(--info)" }
        : configurado
          ? { texto: "Conectado", cor: "var(--accent-text)" }
          : { texto: "Não configurado", cor: "var(--text-3)" };

  const progresso = sync && sync.total_remoto > 0 ? Math.min(100, Math.round((sync.processados / sync.total_remoto) * 100)) : 0;

  return (
    <section aria-labelledby="titulo-imoview" className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h3 id="titulo-imoview" className="text-base font-semibold" style={{ color: "var(--text)" }}>Imoview</h3>
            {pill && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: pill.cor }}>
                <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: pill.cor }} />
                {pill.texto}
              </span>
            )}
          </div>
          <p className="mt-1 max-w-xl text-sm" style={{ color: "var(--text-3)" }}>
            Traz a carteira de imóveis do seu CRM Imoview para o Acessor. O agente e a página Imóveis consultam uma cópia local, por isso respondem rápido.
          </p>
        </div>
        {configurado && (
          <button type="button" onClick={pedirSync} disabled={sincronizando} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium disabled:opacity-60 hover:bg-[var(--hover-solid)]" style={{ border: "1px solid var(--line-2)", color: "var(--text)" }}>
            <RefreshCw className={`w-4 h-4 ${sincronizando ? "animate-spin" : ""}`} aria-hidden />
            {sincronizando ? "Sincronizando" : "Sincronizar agora"}
          </button>
        )}
      </header>

      {erroStatus && (
        <p role="alert" className="flex items-center justify-between gap-3 text-sm" style={{ color: "var(--danger)" }}>
          {erroStatus}
          <button type="button" onClick={carregar} className="underline underline-offset-2">Tentar de novo</button>
        </p>
      )}

      {/* Andamento / resultado da sincronização */}
      {configurado && sync && (
        <div aria-live="polite" className="space-y-2">
          {sincronizando ? (
            <>
              <p className="text-sm tabular-nums" style={{ color: "var(--text-2)" }}>
                {sync.estado === "na_fila" ? "Na fila para sincronizar…" : `${sync.etapa ? sync.etapa.charAt(0).toUpperCase() + sync.etapa.slice(1) : "Sincronizando"} · ${sync.processados} de ${sync.total_remoto || "…"} imóveis`}
              </p>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--card-2)" }} role="progressbar" aria-valuenow={progresso} aria-valuemin={0} aria-valuemax={100} aria-label="Andamento da sincronização">
                <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(progresso, 4)}%`, background: "var(--accent)" }} />
              </div>
            </>
          ) : sync.estado === "erro" && sync.erro ? (
            <p role="alert" className="flex items-start gap-2 text-sm" style={{ color: "var(--danger)" }}>
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
              <span>A última sincronização falhou: {sync.erro}{sync.ultimo_sucesso_em ? ` Os imóveis seguem os da leitura de ${relativo(sync.ultimo_sucesso_em)}.` : ""}</span>
            </p>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-2)" }}>
              Última sincronização {relativo(sync.ultimo_sucesso_em)}
              {sync.ultimo_sucesso_em && (
                <span style={{ color: "var(--text-3)" }}> · {new Intl.NumberFormat("pt-BR").format(sync.imoveis_ativos)} imóveis disponíveis{sync.imoveis_inativos ? `, ${sync.imoveis_inativos} fora do Imoview` : ""}</span>
              )}
            </p>
          )}
          {sync.estado === "ok" && sync.aviso && <p role="status" className="text-xs" style={{ color: "var(--warn)" }}>{sync.aviso}</p>}
          {sync.estado === "ok" && sync.concluido_em && (sync.novos > 0 || sync.atualizados > 0 || sync.desativados > 0) && (
            <p className="text-xs tabular-nums" style={{ color: "var(--text-3)" }}>Na última leitura: {sync.novos} novos · {sync.atualizados} atualizados · {sync.desativados} desativados</p>
          )}
          <p className="text-xs" style={{ color: "var(--text-4)" }}>O cache também é atualizado sozinho a cada 30 minutos.</p>
        </div>
      )}

      <form onSubmit={salvar} className="space-y-4 max-w-xl" aria-label="Credenciais do Imoview">
        <div>
          <label htmlFor="imoview-url" className="block text-sm font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Endereço da API</label>
          <input id="imoview-url" type="url" inputMode="url" autoComplete="off" spellCheck={false} value={url} onChange={(e) => { setUrl(e.target.value); setTeste(null); }} className={campo} style={estiloCampo} placeholder={URL_PADRAO} aria-describedby="imoview-url-ajuda" />
          <p id="imoview-url-ajuda" className="mt-1 text-xs" style={{ color: "var(--text-4)" }}>Só o endereço, com HTTPS. Em geral é {URL_PADRAO}.</p>
        </div>

        <div>
          <label htmlFor="imoview-chave" className="block text-sm font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Chave de acesso (API key)</label>
          <div className="relative">
            <input
              id="imoview-chave"
              type={mostrar ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              value={chave}
              onChange={(e) => { setChave(e.target.value); setTeste(null); }}
              className={`${campo} pr-12`}
              style={estiloCampo}
              placeholder={configurado ? `Salva (${status?.chave_mascarada}). Deixe em branco para manter.` : "Chave enviada pelo Imoview"}
              aria-describedby="imoview-chave-ajuda"
            />
            <button type="button" onClick={() => setMostrar((v) => !v)} aria-label={mostrar ? "Ocultar chave" : "Mostrar chave"} aria-pressed={mostrar} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg hover:bg-[var(--hover-solid)]" style={{ color: "var(--text-3)" }}>
              {mostrar ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p id="imoview-chave-ajuda" className="mt-1 text-xs" style={{ color: "var(--text-4)" }}>Guardada cifrada. Por segurança, ela nunca é exibida de novo depois de salva.</p>
        </div>

        {teste && (
          <p role="status" className="flex items-start gap-2 text-sm" style={{ color: teste.ok ? "var(--accent-text)" : "var(--danger)" }}>
            {teste.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" aria-hidden /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />}
            <span>
              {teste.mensagem}
              {teste.ok && <span style={{ color: "var(--text-3)" }}> {new Intl.NumberFormat("pt-BR").format(teste.imoveis_venda || 0)} à venda e {new Intl.NumberFormat("pt-BR").format(teste.imoveis_aluguel || 0)} para aluguel disponíveis.</span>}
            </span>
          </p>
        )}
        {mensagem && (
          <p role={mensagem.tipo === "erro" ? "alert" : "status"} className="flex items-start gap-2 text-sm" style={{ color: mensagem.tipo === "ok" ? "var(--accent-text)" : "var(--danger)" }}>
            {mensagem.tipo === "ok" ? <Check className="w-4 h-4 mt-0.5 shrink-0" aria-hidden /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />}
            {mensagem.texto}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" onClick={testar} disabled={testando || salvando || !url.trim() || faltaChave} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium disabled:opacity-50 hover:bg-[var(--hover-solid)]" style={{ border: "1px solid var(--line-2)", color: "var(--text)" }}>
            {testando ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <PlugZap className="w-4 h-4" aria-hidden />}
            Testar conexão
          </button>
          <button type="submit" disabled={salvando || testando || !url.trim() || faltaChave} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium disabled:opacity-50 hover:brightness-110" style={{ background: "var(--chip)", color: "var(--chip-text)" }}>
            {salvando && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
            {configurado ? "Salvar alterações" : "Conectar e salvar"}
          </button>
        </div>
      </form>

      {configurado && (
        <div className="pt-5 max-w-xl" style={{ borderTop: "1px solid var(--line)" }}>
          {!confirmando ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm" style={{ color: "var(--text-3)" }}>Desconectar apaga a chave deste portal. O agente deixa de atualizar os imóveis.</p>
              <button type="button" onClick={() => setConfirmando(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm hover:bg-[var(--hover-solid)]" style={{ color: "var(--danger)", border: "1px solid color-mix(in srgb, var(--danger) 40%, transparent)" }}>
                <Unplug className="w-4 h-4" aria-hidden /> Desconectar
              </button>
            </div>
          ) : (
            <div role="alertdialog" aria-labelledby="desconectar-titulo" className="assist-pop space-y-3">
              <p id="desconectar-titulo" className="text-sm font-medium" style={{ color: "var(--text)" }}>Desconectar o Imoview?</p>
              <p className="text-sm" style={{ color: "var(--text-3)" }}>A chave será apagada. Os imóveis já guardados continuam disponíveis, a menos que você marque a opção abaixo.</p>
              <label className="flex items-center gap-2.5 text-sm cursor-pointer" style={{ color: "var(--text-2)" }}>
                <input type="checkbox" checked={limparCache} onChange={(e) => setLimparCache(e.target.checked)} className="w-4 h-4 accent-[var(--accent)]" />
                Apagar também os imóveis guardados
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setConfirmando(false); setLimparCache(false); }} className="px-4 py-2 rounded-full text-sm hover:bg-[var(--hover-solid)]" style={{ border: "1px solid var(--line-2)", color: "var(--text-2)" }}>Cancelar</button>
                <button type="button" onClick={desconectar} disabled={desconectando} className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium disabled:opacity-60" style={{ background: "color-mix(in srgb, var(--danger) 22%, transparent)", color: "var(--danger)" }}>
                  {desconectando && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                  Desconectar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
