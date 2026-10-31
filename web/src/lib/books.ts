import { fetchApi } from "@/lib/api";

export type LayoutBook = "classico" | "galeria" | "compacto";

export interface ConfigBook {
  layout: LayoutBook;
  cor_primaria: string;
  cor_secundaria: string;
  fonte: "moderna" | "classica";
  mostrar_capa: boolean;
  titulo_capa: string;
  subtitulo_capa: string;
  mostrar_logo: boolean;
  fotos_por_imovel: number;
  mostrar_descricao: boolean;
  mostrar_caracteristicas: boolean;
  mostrar_custos: boolean;
  mostrar_endereco: boolean;
  mostrar_link: boolean;
  mostrar_contato: boolean;
  mostrar_corretor: boolean;
  rodape: string;
  mensagem_final: string;
}

export interface ModeloBook {
  id: string;
  nome: string;
  padrao: boolean;
  sistema: boolean;
  config: ConfigBook;
}

export interface LayoutInfo { id: LayoutBook; nome: string; descricao: string }

export interface ModelosBook {
  modelos: ModeloBook[];
  layouts: LayoutInfo[];
  padrao_config: ConfigBook;
}

export const ROTULO_LAYOUT: Record<string, string> = { classico: "Clássico", galeria: "Galeria", compacto: "Compacto" };

/** Pede um PDF à API (com o token) e devolve o blob. Lança Error com a mensagem do servidor. */
export async function buscarPdf(caminho: string, corpo: unknown): Promise<Blob> {
  const res = await fetchApi(caminho, { method: "POST", body: JSON.stringify(corpo) });
  if (!res.ok) {
    const d = await res.json().catch(() => null);
    throw new Error(typeof d?.detail === "string" ? d.detail : "Não consegui gerar o PDF agora.");
  }
  return res.blob();
}
