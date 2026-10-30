import { Atividade } from "@/lib/crm";

export interface Ativ extends Atividade {
  duracao_min?: number;
  corretor_id?: string;
  lembrete_min?: number | null;
}

export interface TipoAgenda { chave: string; nome: string; icone: string; cor: string; visivel: boolean }
export type Visao = "semana" | "dia" | "mes" | "lista";

export const ALTURA_HORA = 56;
export const COR_PADRAO = "#8A9597";

export const dia0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const somarDias = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const mesmoDia = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
export const inicioSemana = (d: Date) => somarDias(dia0(d), -d.getDay()); // semana começa no domingo, como na Kleo

export const diasEntre = (ini: Date, fim: Date) => {
  const lista: Date[] = [];
  for (let d = dia0(ini); d <= fim && lista.length < 62; d = somarDias(d, 1)) lista.push(d);
  return lista;
};

const mesCurto = (d: Date) => d.toLocaleDateString("pt-BR", { month: "short" }); // "out."
export function tituloPeriodo(dias: Date[], visao: Visao): string {
  const a = dias[0], b = dias[dias.length - 1];
  if (visao === "mes") return a.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  if (dias.length === 1) return a.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "short" });
  if (a.getMonth() === b.getMonth()) return `${a.getDate()} – ${b.getDate()} de ${mesCurto(a)}`;
  return `${a.getDate()} de ${mesCurto(a)} – ${b.getDate()} de ${mesCurto(b)}`;
}

/** Disposição lado a lado das atividades que se sobrepõem no mesmo dia. */
export function disporColunas(itens: Ativ[]): Map<string, { col: number; cols: number }> {
  const ord = [...itens].sort((x, y) => +new Date(x.inicio!) - +new Date(y.inicio!));
  const fim = (a: Ativ) => +new Date(a.inicio!) + Math.max(30, a.duracao_min || 60) * 60000;
  const out = new Map<string, { col: number; cols: number }>();
  let grupo: Ativ[] = [], fimGrupo = 0;
  const fechar = () => {
    const colunas: number[] = [];
    grupo.forEach((a) => {
      let c = colunas.findIndex((f) => f <= +new Date(a.inicio!));
      if (c < 0) { c = colunas.length; colunas.push(0); }
      colunas[c] = fim(a);
      out.set(a.id, { col: c, cols: 0 });
    });
    grupo.forEach((a) => (out.get(a.id)!.cols = colunas.length));
    grupo = [];
  };
  ord.forEach((a) => {
    if (grupo.length && +new Date(a.inicio!) >= fimGrupo) fechar();
    grupo.push(a);
    fimGrupo = Math.max(fimGrupo, fim(a));
  });
  if (grupo.length) fechar();
  return out;
}

export const fundoTipo = (cor: string) => `color-mix(in srgb, ${cor} 20%, var(--card))`;
