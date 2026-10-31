"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Columns3, List, ListChecks, ListFilter, PanelLeft, Plus, Rows3, Search, X } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { CorretorOpcao, corretoresAtivos } from "@/lib/crm";
import { useEhCorretor } from "@/components/portal/papel";
import { Aviso, Seletor, useApi, useRecado } from "@/components/configuracoes/ui";
import { ICONES_ATIVIDADE } from "@/components/configuracoes/secoes/Personalizacao";
import MiniCalendario from "./agenda/MiniCalendario";
import Grade from "./agenda/Grade";
import Mes from "./agenda/Mes";
import Lista from "./agenda/Lista";
import Detalhe from "./agenda/Detalhe";
import NovaAtividade, { Preenchimento } from "./agenda/NovaAtividade";
import { Ativ, COR_PADRAO, TipoAgenda, Visao, dia0, diasEntre, inicioSemana, iso, somarDias, tituloPeriodo } from "./agenda/util";

const TIPOS_PADRAO: TipoAgenda[] = [
  { chave: "visita", nome: "Visita", icone: "calendar", cor: "#E9A23B", visivel: true },
  { chave: "reuniao", nome: "Reunião", icone: "users", cor: "#7B8FB5", visivel: true },
  { chave: "ligacao", nome: "Ligação", icone: "phone", cor: "#4E80EE", visivel: true },
  { chave: "follow_up", nome: "Follow-up", icone: "clock", cor: "#C58BD9", visivel: true },
  { chave: "whatsapp", nome: "WhatsApp", icone: "message", cor: "#65D072", visivel: true },
  { chave: "tarefa", nome: "Tarefa", icone: "list", cor: "#8A9597", visivel: true },
  { chave: "email", nome: "E-mail", icone: "mail", cor: "#D88A5A", visivel: true },
  { chave: "documento", nome: "Documento", icone: "file", cor: "#5FB3B3", visivel: true },
];

const VISOES: { id: Visao; rotulo: string; Icone: React.ComponentType<{ className?: string }> }[] = [
  { id: "dia", rotulo: "Dia", Icone: Rows3 },
  { id: "semana", rotulo: "Semana", Icone: Columns3 },
  { id: "mes", rotulo: "Mês", Icone: CalendarDays },
  { id: "lista", rotulo: "Lista", Icone: List },
];

const btnIcone = "w-9 h-9 rounded-full inline-flex items-center justify-center hover:bg-[var(--hover-solid)] transition-colors";

export default function Agenda({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const ehCorretor = useEhCorretor();  // a agenda do corretor é só dele: sem filtro por corretor
  const api = useApi(onAuthError);
  const [visao, setVisao] = useState<Visao>("semana");
  const [ancora, setAncora] = useState(() => dia0(new Date()));
  const [intervalo, setIntervalo] = useState<{ ini: Date; fim: Date } | null>(null);
  const [mesMini, setMesMini] = useState(() => dia0(new Date()));
  const [tipos, setTipos] = useState<TipoAgenda[]>(TIPOS_PADRAO);
  const [ocultos, setOcultos] = useState<Set<string>>(new Set());
  const [atividades, setAtividades] = useState<Ativ[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, mostrar] = useRecado(4000);
  const [painel, setPainel] = useState(true);
  const [gaveta, setGaveta] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [busca, setBusca] = useState("");
  const [corretores, setCorretores] = useState<CorretorOpcao[]>([]);
  const [corretor, setCorretor] = useState("");
  const [filtroAberto, setFiltroAberto] = useState(false);
  const [soAtrasadas, setSoAtrasadas] = useState(false);
  const [menuTipos, setMenuTipos] = useState(false);
  const [nova, setNova] = useState<Preenchimento | null>(null);
  const [aberta, setAberta] = useState<Ativ | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) setPainel(false);
    (async () => {
      const r = await api<TipoAgenda[]>("/admin/configuracoes/tipos-atividade");
      if (r.ok && r.dados?.length) setTipos(r.dados.filter((t) => t.visivel));
      try { setCorretores(await corretoresAtivos(fetchApi)); } catch { /* o filtro some sem a lista */ }
    })();
  }, [api]);

  const mapaTipos = useMemo(() => new Map(tipos.map((t) => [t.chave, t])), [tipos]);

  const dias = useMemo(() => {
    if (visao === "mes") { const p = new Date(ancora.getFullYear(), ancora.getMonth(), 1); const i = somarDias(p, -p.getDay()); return diasEntre(i, somarDias(i, 41)); }
    if (visao === "lista") return diasEntre(ancora, somarDias(ancora, 29));
    if (intervalo && visao !== "dia") return diasEntre(intervalo.ini, intervalo.fim);
    if (visao === "dia") return [ancora];
    const i = inicioSemana(ancora);
    return diasEntre(i, somarDias(i, 6));
  }, [visao, ancora, intervalo]);
  const de = iso(dias[0]), ate = iso(dias[dias.length - 1]);

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
    const r = await api<Ativ[]>(`/admin/crm/agenda?de=${de}&ate=${ate}`);
    setCarregando(false);
    if (r.ok && r.dados) { setAtividades(r.dados); setErro(null); } else if (r.erro) setErro("Não foi possível carregar a agenda.");
  }, [api, de, ate]);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { const t = setInterval(() => carregar(true), 60000); return () => clearInterval(t); }, [carregar]);
  useEffect(() => setMesMini(ancora), [ancora]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return atividades.filter((a) =>
      !ocultos.has(a.tipo) && (!corretor || a.corretor_id === corretor) &&
      (!q || [a.titulo, a.lead_nome, a.corretor_nome, a.local].some((v) => (v || "").toLowerCase().includes(q))));
  }, [atividades, ocultos, corretor, busca]);
  const atrasadas = atividades.filter((a) => a.atrasada).length;

  const mover = (sentido: 1 | -1) => {
    if (visao === "mes") return setAncora(new Date(ancora.getFullYear(), ancora.getMonth() + sentido, 1));
    const passo = visao === "dia" ? 1 : visao === "lista" ? 7 : intervalo ? dias.length : 7;
    setIntervalo(null);
    setAncora(somarDias(visao === "semana" || visao === "lista" ? (intervalo ? intervalo.ini : ancora) : ancora, sentido * passo));
  };
  const irPara = (d: Date, v: Visao = visao) => { setIntervalo(null); setAncora(dia0(d)); setVisao(v); };
  const trocarVisao = (v: Visao) => { setSoAtrasadas(false); if (v === "mes" || v === "lista") setIntervalo(null); setVisao(v); };

  const mudarStatus = async (a: Ativ, status: "concluida" | "cancelada") => {
    const r = await api(`/admin/crm/atividades/${a.id}`, { method: "PATCH", corpo: { status } });
    if (!r.ok) return setErro(r.erro);
    setAtividades((l) => l.filter((x) => x.id !== a.id)); setAberta(null);
    mostrar(status === "concluida" ? "Atividade concluída." : "Atividade cancelada.");
  };
  const remarcar = async (a: Ativ, data: string, hora: string) => {
    const r = await api(`/admin/crm/atividades/${a.id}`, { method: "PATCH", corpo: { data, hora } });
    if (!r.ok) return setErro(r.erro);
    setAberta(null); mostrar("Atividade remarcada."); carregar(true);
  };
  const criar = (d: Date, hora: string, tipo?: string) => setNova({ data: iso(d), hora, tipo });

  const titulo = tituloPeriodo(visao === "lista" ? [ancora] : dias, visao === "lista" ? "dia" : visao);
  const tituloExibido = visao === "lista" ? "Próximos 30 dias" : titulo;

  const painelEsquerdo = (
    <div className="p-5 pt-14 lg:pt-5 space-y-6 overflow-y-auto h-full">
      <div className="relative">
        <div className="flex rounded-full overflow-hidden text-white" style={{ background: "linear-gradient(135deg, var(--accent-strong), color-mix(in srgb, var(--accent-strong) 70%, #000))" }}>
          <button type="button" onClick={() => { setNova({}); setGaveta(false); }} className="flex-1 flex items-center gap-2.5 pl-3 pr-4 py-2.5 text-[15px] font-medium hover:brightness-110"><span className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center"><Plus className="w-4 h-4" aria-hidden /></span>Nova atividade</button>
          <button type="button" aria-label="Escolher o tipo da atividade" aria-expanded={menuTipos} onClick={() => setMenuTipos((v) => !v)} className="px-3.5 hover:brightness-110" style={{ borderLeft: "1px solid rgba(255,255,255,.25)" }}><ChevronDown className="w-4 h-4" /></button>
        </div>
        {menuTipos && (
          <ul role="menu" className="absolute z-30 mt-2 w-full rounded-2xl p-1.5 shadow-xl" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
            {tipos.map((t) => { const Ic = ICONES_ATIVIDADE[t.icone] || ListChecks; return (
              <li key={t.chave} role="none"><button role="menuitem" type="button" onClick={() => { setMenuTipos(false); setNova({ tipo: t.chave }); setGaveta(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm hover:bg-[var(--hover-solid)]" style={{ color: "var(--text)" }}><Ic className="w-4 h-4" style={{ color: t.cor }} />{t.nome}</button></li>
            ); })}
          </ul>
        )}
      </div>

      <MiniCalendario mes={mesMini} onMes={setMesMini} visiveis={visao === "lista" || visao === "mes" ? [] : dias}
        onEscolher={(a, b) => { if (+a === +b) return irPara(a, visao === "mes" || visao === "lista" ? "semana" : visao); setIntervalo({ ini: a, fim: somarDias(a, Math.min(13, Math.round((+b - +a) / 864e5))) }); setAncora(a); setVisao("semana"); setGaveta(false); }} />

      <div>
        <h3 className="text-xs font-semibold tracking-wide uppercase mb-3" style={{ color: "var(--text-3)" }}>Tipos</h3>
        <ul className="space-y-1">
          {tipos.map((t) => {
            const Ic = ICONES_ATIVIDADE[t.icone] || ListChecks; const marcado = !ocultos.has(t.chave);
            return (
              <li key={t.chave}>
                <label className="flex items-center gap-3 py-1.5 cursor-pointer text-[15px]" style={{ color: "var(--text)" }}>
                  <input type="checkbox" className="sr-only peer" checked={marcado} onChange={() => setOcultos((o) => { const x = new Set(o); if (x.has(t.chave)) x.delete(t.chave); else x.add(t.chave); return x; })} />
                  <span aria-hidden className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2" style={{ background: marcado ? t.cor : "transparent", border: `1.5px solid ${marcado ? t.cor : "var(--line-2)"}`, outlineColor: t.cor }}>{marcado && <Check className="w-3 h-3 text-black/70" strokeWidth={3} />}</span>
                  <Ic className="w-[18px] h-[18px]" style={{ color: "var(--text-2)" }} />{t.nome}
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 relative">
      {gaveta && <button type="button" aria-label="Fechar painel" className="lg:hidden fixed inset-0 z-30" style={{ background: "rgba(0,0,0,.5)" }} onClick={() => setGaveta(false)} />}
      <aside aria-label="Calendário e tipos" className={`${gaveta ? "fixed" : "hidden"} inset-y-0 left-0 z-40 w-[20rem] max-w-[88vw] lg:static lg:z-auto ${painel ? "lg:block" : "lg:hidden"} lg:w-[20rem] shrink-0`} style={{ background: "var(--bg)", borderRight: "1px solid var(--line)" }}>
        {gaveta && <button type="button" onClick={() => setGaveta(false)} aria-label="Fechar" className="lg:hidden absolute top-3 right-3 p-2 rounded-lg" style={{ color: "var(--text-3)" }}><X className="w-4 h-4" /></button>}
        {painelEsquerdo}
      </aside>

      <section className="flex-1 min-w-0 flex flex-col" aria-label="Agenda">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-3 sm:px-4 py-3" style={{ borderBottom: "1px solid var(--line)" }}>
          <button type="button" onClick={() => (window.matchMedia("(min-width: 1024px)").matches ? setPainel((v) => !v) : setGaveta(true))} aria-label="Alternar painel do calendário" className={btnIcone} style={{ color: "var(--text-2)" }}><PanelLeft className="w-[18px] h-[18px]" /></button>
          <button type="button" onClick={() => irPara(new Date())} className="px-4 h-9 rounded-full text-sm hover:bg-[var(--hover-solid)]" style={{ background: "var(--card)", color: "var(--text)" }}>Hoje</button>
          <button type="button" onClick={() => mover(-1)} aria-label="Anterior" className={btnIcone} style={{ color: "var(--text-2)" }}><ChevronLeft className="w-5 h-5" /></button>
          <button type="button" onClick={() => mover(1)} aria-label="Próximo" className={btnIcone} style={{ color: "var(--text-2)" }}><ChevronRight className="w-5 h-5" /></button>
          <h1 className="text-xl sm:text-2xl font-medium tracking-tight first-letter:uppercase mr-auto" style={{ color: "var(--text)" }}>{tituloExibido}</h1>

          {buscando ? (
            <label className="relative"><span className="sr-only">Buscar atividades</span><input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} onBlur={() => !busca && setBuscando(false)} placeholder="Título, cliente ou corretor" className="h-9 w-48 sm:w-60 rounded-full pl-4 pr-9 text-sm outline-none" style={{ background: "var(--card)", border: "1px solid var(--line)", color: "var(--text)" }} />{busca && <button type="button" aria-label="Limpar busca" onClick={() => { setBusca(""); setBuscando(false); }} className="absolute right-2 top-1/2 -translate-y-1/2 p-1" style={{ color: "var(--text-3)" }}><X className="w-3.5 h-3.5" /></button>}</label>
          ) : <button type="button" onClick={() => setBuscando(true)} aria-label="Buscar atividades" className={btnIcone} style={{ background: "var(--card)", color: "var(--text-2)" }}><Search className="w-[18px] h-[18px]" /></button>}
          <button type="button" onClick={() => { setSoAtrasadas((v) => !v); setVisao("lista"); setIntervalo(null); }} aria-pressed={soAtrasadas} title="Atividades atrasadas" className="h-9 px-3 rounded-full inline-flex items-center gap-1.5 text-sm tabular-nums" style={{ background: soAtrasadas ? "var(--accent-soft)" : "var(--card)", color: atrasadas ? "var(--danger)" : "var(--text-2)" }}><CircleAlert className="w-4 h-4" aria-hidden />{atrasadas}<span className="sr-only"> atrasadas</span></button>
          {!ehCorretor && (
          <div className="relative">
            <button type="button" onClick={() => setFiltroAberto((v) => !v)} aria-label="Filtrar por corretor" aria-expanded={filtroAberto} className={btnIcone} style={{ background: corretor ? "var(--accent-soft)" : "var(--card)", color: corretor ? "var(--accent-text)" : "var(--text-2)" }}><ListFilter className="w-[18px] h-[18px]" /></button>
            {filtroAberto && (
              <div className="absolute right-0 mt-2 z-30 w-64 rounded-2xl p-3 shadow-xl space-y-2" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
                <label className="text-xs block space-y-1" style={{ color: "var(--text-3)" }}>Corretor<Seletor value={corretor} onChange={(e) => { setCorretor(e.target.value); setFiltroAberto(false); }}><option value="">Toda a equipe</option>{corretores.map((c) => <option key={c.id} value={c.id}>{c.nome || c.telefone_mascarado}</option>)}</Seletor></label>
              </div>
            )}
          </div>
          )}
          <div role="group" aria-label="Visualização" className="inline-flex rounded-full p-1" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
            {VISOES.map(({ id, rotulo, Icone }) => (
              <button key={id} type="button" onClick={() => trocarVisao(id)} aria-pressed={visao === id} aria-label={rotulo} title={rotulo} className="w-9 h-8 rounded-full inline-flex items-center justify-center transition-colors" style={{ background: visao === id ? "var(--hover-solid)" : "transparent", color: visao === id ? "var(--text)" : "var(--text-3)" }}><Icone className="w-4 h-4" /></button>
            ))}
          </div>
        </div>

        {(erro || recado) && <div className="px-4 pt-3">{erro ? <Aviso tom="erro">{erro}</Aviso> : <Aviso tom="ok">{recado}</Aviso>}</div>}

        <div className="flex-1 min-h-0 flex flex-col" aria-busy={carregando} style={{ opacity: carregando ? 0.7 : 1, transition: "opacity .15s" }}>
          {visao === "lista" ? <Lista atividades={visiveis} tipos={mapaTipos} onAbrir={setAberta} onStatus={mudarStatus} apenasAtrasadas={soAtrasadas} />
            : visao === "mes" ? <Mes mes={ancora} atividades={visiveis} tipos={mapaTipos} onAbrir={setAberta} onDia={(d) => irPara(d, "dia")} onCriar={(d, h) => criar(d, h)} />
            : <Grade key={visao + dias.length} dias={dias} atividades={visiveis} tipos={mapaTipos} onAbrir={setAberta} onCriar={(d, h) => criar(d, h)} />}
        </div>
      </section>

      {nova && <NovaAtividade inicial={nova} tipos={tipos} onAuthError={onAuthError} onFechar={() => setNova(null)} onCriada={() => { setNova(null); mostrar("Atividade agendada."); carregar(true); }} />}
      {aberta && <Detalhe a={aberta} tipo={mapaTipos.get(aberta.tipo) || { chave: aberta.tipo, nome: aberta.tipo, icone: "list", cor: COR_PADRAO, visivel: true }} onFechar={() => setAberta(null)} onStatus={mudarStatus} onRemarcar={remarcar} />}
    </div>
  );
}
