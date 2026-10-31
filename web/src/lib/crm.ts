// Tipos e formatação do CRM (carteira, funil e agenda), espelhando /admin/crm.

export interface Etapa {
  id: string;
  nome: string;
  ordem: number;
  probabilidade: number;
  alerta_dias: number | null;
  cor: string;
}

export interface Negocio {
  id: string;
  lead_id: string;
  etapa_id: string;
  etapa_nome: string;
  etapa_cor: string;
  probabilidade: number;
  titulo: string | null;
  valor: number;
  esperado: number;
  status: "aberto" | "ganho" | "perdido";
  motivo_perda: string | null;
  fechamento_previsto: string | null;
  imovel_codigo: number | null;
  lead_nome: string;
  lead_telefone?: string | null;
  lead_email?: string | null;
  lead_origem?: string;
  lead_temperatura?: "quente" | "morno" | "frio";
  automatico?: boolean;
  imoview_fase?: number | null;
  imoview_situacao?: "em_atendimento" | "negocio_realizado" | "descartado" | null;
  corretor_nome: string | null;
  dias_na_etapa: number;
  travado: boolean;
  updated_at: string;
}

export interface Forecast {
  etapas: {
    etapa_id: string;
    etapa: string;
    cor: string;
    probabilidade: number;
    quantidade: number;
    travados: number;
    total: number;
    esperado: number;
  }[];
  total: number;
  esperado: number;
  quantidade: number;
}

export interface FunilEtapa {
  etapa_id: string;
  etapa: string;
  cor: string;
  probabilidade: number;
  quantidade: number;
  travados: number;
  total: number;
  esperado: number;
  negocios: Negocio[];
}

export interface Funil {
  etapas: FunilEtapa[];
  totais: { quantidade: number; total: number; esperado: number; travados: number };
}

export interface Perfil {
  interesse?: string[];
  tipos?: string[];
  bairros?: string[];
  quartos_min?: number;
  vagas_min?: number;
  valor_max?: number;
  area_min?: number;
  prazo?: string;
}

export interface Lead {
  id: string;
  nome: string;
  telefone: string | null;
  temperatura: "quente" | "morno" | "frio";
  status: string;
  perfil: Perfil;
  observacoes: string | null;
  corretor_nome: string | null;
  negocios_abertos: number;
  updated_at: string;
}

export interface Atividade {
  id: string;
  tipo: string;
  titulo: string;
  inicio: string | null;
  local: string | null;
  imovel_codigo: number | null;
  lead_nome: string | null;
  corretor_nome: string | null;
  atrasada: boolean;
}

export const brl = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

// Cores por etapa e por tipo, em classes do Tailwind (fundo suave + texto).
export const COR_ETAPA: Record<string, string> = {
  slate: "bg-slate-400",
  sky: "bg-sky-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
};

export const ROTULO_TIPO: Record<string, string> = {
  visita: "Visita",
  reuniao: "Reunião",
  ligacao: "Ligação",
  follow_up: "Follow-up",
  whatsapp: "WhatsApp",
  tarefa: "Tarefa",
  email: "E-mail",
  documento: "Documento",
};

const VERBO: Record<string, string> = { comprar: "compra", alugar: "aluga", vender: "vende" };

const PRAZO: Record<string, string> = {
  imediato: "imediato",
  "3_meses": "até 3 meses",
  "6_meses": "até 6 meses",
  sem_pressa: "sem pressa",
};

export function resumoPerfil(perfil: Perfil | null | undefined): string {
  if (!perfil) return "sem perfil de busca";
  const partes: string[] = [];
  if (perfil.interesse?.length) partes.push(perfil.interesse.map((i) => VERBO[i] ?? i).join("/"));
  if (perfil.tipos?.length) partes.push(perfil.tipos.join("/"));
  if (perfil.quartos_min) partes.push(`${perfil.quartos_min}+ quartos`);
  if (perfil.vagas_min) partes.push(`${perfil.vagas_min}+ vagas`);
  if (perfil.bairros?.length) partes.push(perfil.bairros.join(", "));
  if (perfil.valor_max) partes.push(`até ${brl(perfil.valor_max)}`);
  if (perfil.prazo) partes.push(PRAZO[perfil.prazo] ?? perfil.prazo);
  return partes.join(" · ") || "sem perfil de busca";
}

export function dataHora(iso: string | null): string {
  if (!iso) return "Sem data";
  return new Date(iso).toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface CorretorOpcao {
  id: string;
  nome: string | null;
  telefone_mascarado: string;
  status: string;
}

// Corretores que podem receber negócios e atividades criados pelo portal.
export async function corretoresAtivos(
  fetcher: (path: string) => Promise<Response>
): Promise<CorretorOpcao[]> {
  const res = await fetcher("/admin/corretores");
  if (!res.ok) return [];
  const lista: CorretorOpcao[] = await res.json();
  return lista.filter((c) => c.status === "active");
}
