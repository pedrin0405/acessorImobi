export interface ConversaResumo {
  corretor_id: string;
  corretor_nome: string | null;
  telefone_mascarado: string;
  corretor_status: string;
  ultima_mensagem: string | null;
  ultima_direcao: "inbound" | "outbound" | string;
  ultimo_tipo: string;
  ultima_em: string | null;
  nao_respondidas: number;
}

/* ---------- Atendimentos: as conversas do corretor com os clientes no WhatsApp pessoal ---------- */

export interface AtendimentoItem {
  id: string;
  nome: string | null;
  telefone_cliente: string;
  lead_id: string | null;
  imobiliario: boolean | null;
  aguardando_corretor: boolean;
  ultima_mensagem_em: string | null;
  ultima_do_cliente_em: string | null;
  analisado_em: string | null;
  resumo: string | null;
  temperatura: "quente" | "morno" | "frio" | string | null;
  ultima_autor: "corretor" | "cliente" | string | null;
  ultima_tipo: string | null;
  ultima_texto: string | null;
  nao_respondidas: number;
}

export interface AtendimentoDetalhe {
  id: string;
  nome: string | null;
  telefone_cliente: string;
  lead_id: string | null;
  imobiliario: boolean | null;
  aguardando_corretor: boolean;
  analise: Record<string, unknown> | null;
  analisado_em: string | null;
  ultima_mensagem_em: string | null;
  mensagens: { id: string; autor: "corretor" | "cliente" | string; tipo: string; conteudo: string | null; transcricao: string | null; created_at: string }[];
}

/** O atendimento no formato da lista de Conversas: o id do atendimento ocupa o lugar do id do corretor. */
export function atendimentoParaConversa(a: AtendimentoItem): ConversaResumo {
  return {
    corretor_id: a.id,
    corretor_nome: a.nome,
    telefone_mascarado: a.telefone_cliente,
    corretor_status: "active",
    ultima_mensagem: a.ultima_texto,
    ultima_direcao: a.ultima_autor === "corretor" ? "outbound" : "inbound",
    ultimo_tipo: a.ultima_tipo || "text",
    ultima_em: a.ultima_mensagem_em,
    nao_respondidas: a.nao_respondidas,
  };
}
