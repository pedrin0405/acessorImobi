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
  imoview_estagio?: string | null;
  im_funil?: string | null;
  im_midia?: string | null;
  im_campanha?: string | null;
  im_termometro?: "Quente" | "Morno" | "Frio" | "Indefinido" | null;
  corretor_id?: string | null;
  im_corretor_nome?: string | null;
  im_ultima_interacao?: string | null;
  im_n_interacoes?: number | null;
  im_n_visitas?: number | null;
  im_n_propostas?: number | null;
  im_qualificado?: boolean | null;
  im_previsao_fechamento?: string | null;
  valor_manual?: boolean;
  im_valor_tipo?: "negocio" | "proposta" | "imovel" | "orcamento" | null;
  im_comissao?: number | null;
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
  corretor_id?: string | null;
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
  corretor_id?: string | null;
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

export interface ImovelImoview {
  codigo: number; titulo: string | null; tipo: string | null; valor: string | null; bairro: string | null; cidade: string | null;
  quartos: string | number | null; vagas: string | number | null; area: string | number | null; foto: string | null;
  /** Anúncio no site da imobiliária (montado pelo portal a partir do site configurado). */
  link?: string | null;
}

export interface AtendimentoImoview {
  codigo: number;
  finalidade: string;
  funil: string | null;
  situacao: string | null;
  situacao_tipo: "em_atendimento" | "negocio_realizado" | "descartado";
  estagio: string | null;
  fase: number | null;
  midia: string | null;
  campanha: string | null;
  termometro: string | null;
  unidade: string | null;
  corretor_nome: string | null;
  mql_nome: string | null;
  qualificado: boolean;
  entrada_em: string | null;
  primeira_resposta_em: string | null;
  ultima_interacao_em: string | null;
  previsao_fechamento_em: string | null;
  fechamento_em: string | null;
  perfil?: {
    tipos?: string[]; cidades?: string[]; bairros?: string[]; regioes?: string[];
    quartos?: number; banheiros?: number; suites?: number; vagas?: number;
    valor_de?: number; valor_ate?: number; area_de?: number; area_ate?: number;
    financiamento?: boolean; permuta?: boolean; destinacao?: string | null; extras?: string[];
  } | null;
  carrinho?: ImovelImoview[];
  visitas?: { codigo: number; em: string | null; tipo: string | null; situacao: string | null; parecer: string | null; motivo: string | null; complemento: string | null; imovel: ImovelImoview | null }[];
  propostas?: { codigo: number; situacao: string | null; valor: number | null; em: string | null; imovel: ImovelImoview | null }[];
  negocios?: { codigo: number; situacao: string | null; valor: number | null; comissao: number | null; em: string | null; imovel: ImovelImoview | null }[];
  interacoes?: { em: string | null; descricao: string; usuario: string | null }[];
}
