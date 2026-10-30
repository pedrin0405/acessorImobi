export interface ImovelResumo {
  codigo: number;
  titulo: string | null;
  finalidade: "aluguel" | "venda" | string;
  tipo: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  valor: number | null;
  valor_condominio: number | null;
  quartos: number | null;
  suites: number | null;
  banheiros: number | null;
  vagas: number | null;
  area_m2: number | null;
  situacao: string | null;
  destaque: boolean;
  ativo: boolean;
  link: string | null;
  foto_url: string | null;
}

export interface Faceta {
  valor: string;
  quantidade: number;
}

export interface Facetas {
  finalidade: Faceta[];
  tipo: Faceta[];
  bairro: Faceta[];
  cidade: Faceta[];
  faixas: { valor_min: number | null; valor_max: number | null; area_min: number | null; area_max: number | null };
}

export interface StatusSync {
  estado: "ocioso" | "na_fila" | "executando" | "ok" | "erro";
  origem: string | null;
  etapa: string | null;
  iniciado_em: string | null;
  concluido_em: string | null;
  ultimo_sucesso_em: string | null;
  total_remoto: number;
  processados: number;
  novos: number;
  atualizados: number;
  desativados: number;
  erro: string | null;
  aviso: string | null;
  imoveis_ativos: number;
  imoveis_inativos: number;
  ultima_leitura: string | null;
}

export interface ListaImoveis {
  itens: ImovelResumo[];
  total: number;
  pagina: number;
  por_pagina: number;
  paginas: number;
  facetas?: Facetas;
  integracao: { configurada: boolean; sincronizacao: StatusSync };
}

export interface ImovelDetalhe extends ImovelResumo {
  descricao?: string;
  fotos: { url: string; descricao: string }[];
  endereco: Record<string, string>;
  caracteristicas: string[];
  extras: string[];
  salas?: number;
  varandas?: number;
  andar?: number;
  ano_construcao?: number;
  tipo_vagas?: string;
  valor_iptu?: number;
  valor_m2?: number;
  aceita_financiamento: boolean;
  aceita_permuta: boolean;
  exclusivo: boolean;
  destinacao?: string;
  area_lote?: number;
  url_video?: string;
  latitude?: number;
  longitude?: number;
  cadastrado_em?: string;
  alterado_em?: string;
  sincronizado_em: string | null;
  texto_compartilhar: string;
}

export interface Filtros {
  busca: string;
  finalidade: string;
  tipo: string[];
  bairro: string[];
  cidade: string[];
  quartos_min: number | null;
  vagas_min: number | null;
  banheiros_min: number | null;
  valor_min: string;
  valor_max: string;
  area_min: string;
  area_max: string;
  destaque: boolean;
  incluir_inativos: boolean;
}

export const FILTROS_VAZIOS: Filtros = {
  busca: "", finalidade: "", tipo: [], bairro: [], cidade: [], quartos_min: null, vagas_min: null,
  banheiros_min: null, valor_min: "", valor_max: "", area_min: "", area_max: "", destaque: false, incluir_inativos: false,
};

export const ORDENACOES = [
  { id: "recentes", rotulo: "Mais recentes" },
  { id: "valor_asc", rotulo: "Menor valor" },
  { id: "valor_desc", rotulo: "Maior valor" },
  { id: "area_desc", rotulo: "Maior área" },
  { id: "codigo_desc", rotulo: "Código (maior)" },
];

export const reais = (valor: number | null | undefined, sufixo = "") =>
  valor === null || valor === undefined
    ? "Sob consulta"
    : `${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(valor)}${sufixo}`;

export const precoDoImovel = (i: Pick<ImovelResumo, "valor" | "finalidade">) => reais(i.valor, i.finalidade === "aluguel" ? "/mês" : "");

export const rotuloFinalidade = (f: string) => (f === "aluguel" ? "Aluguel" : f === "venda" ? "Venda" : f);

export const numero = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(v);

export function relativo(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  if (min < 60 * 24) return `há ${Math.floor(min / 60)} h`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Parâmetros da API a partir do estado dos filtros (só o que está preenchido). */
export function paraParametros(f: Filtros, ordem: string, pagina: number, porPagina: number, facetas: boolean): URLSearchParams {
  const p = new URLSearchParams();
  const pôr = (k: string, v: string | number | null | undefined | boolean) => {
    if (v !== null && v !== undefined && v !== "" && v !== false) p.set(k, String(v));
  };
  pôr("busca", f.busca.trim());
  pôr("finalidade", f.finalidade);
  if (f.tipo.length) p.set("tipo", f.tipo.join(","));
  if (f.bairro.length) p.set("bairro", f.bairro.join(","));
  if (f.cidade.length) p.set("cidade", f.cidade.join(","));
  pôr("quartos_min", f.quartos_min);
  pôr("vagas_min", f.vagas_min);
  pôr("banheiros_min", f.banheiros_min);
  pôr("valor_min", f.valor_min.replace(/\D/g, ""));
  pôr("valor_max", f.valor_max.replace(/\D/g, ""));
  pôr("area_min", f.area_min.replace(/\D/g, ""));
  pôr("area_max", f.area_max.replace(/\D/g, ""));
  pôr("destaque", f.destaque);
  pôr("incluir_inativos", f.incluir_inativos);
  p.set("ordem", ordem);
  p.set("pagina", String(pagina));
  p.set("por_pagina", String(porPagina));
  p.set("facetas", String(facetas));
  return p;
}
