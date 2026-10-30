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
