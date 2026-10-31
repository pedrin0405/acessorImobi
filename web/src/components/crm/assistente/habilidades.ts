import type { LucideIcon } from "lucide-react";
import {
  BarChart3, BookOpen, Bot, CircleHelp, FileText, Home, Languages, Link2, MessageSquareText, Search, ShieldQuestion, Sunrise, Target, TrendingUp,
} from "lucide-react";

export interface Habilidade {
  id: string;
  grupo: string;
  titulo: string;
  descricao: string;
  /** Texto que preenche a caixa; termina em espaço quando falta o nome/assunto. */
  prompt: string;
  icone: LucideIcon;
  selo?: string;
  emBreve?: boolean;
}

export const HABILIDADES: Habilidade[] = [
  {
    id: "briefing", grupo: "Rotina", titulo: "Briefing do dia", selo: "Mais usado",
    descricao: "Resumo dos leads quentes, follow-ups e negócios em risco.",
    prompt: "Gere o briefing do dia: agenda, atividades atrasadas, negócios travados, leads quentes e conversas esperando resposta.",
    icone: Sunrise,
  },
  {
    id: "proxima-acao", grupo: "Leads", titulo: "Próxima ação por lead",
    descricao: "Explico a situação do cliente e sugiro o melhor próximo passo.",
    prompt: "Qual é a melhor próxima ação para o cliente ", icone: Target,
  },
  {
    id: "busca-natural", grupo: "Leads", titulo: "Busca em linguagem natural",
    descricao: "Pergunte do seu jeito: \"quem procura apê de 2 quartos na Orla?\".",
    prompt: "Quais clientes da carteira procuram ", icone: Search,
  },
  {
    id: "match", grupo: "Imóveis", titulo: "Match imóvel ↔ lead",
    descricao: "Cruzo o perfil do cliente com a carteira de imóveis em segundos.",
    prompt: "Quais imóveis combinam com o cliente ", icone: Link2,
  },
  {
    id: "opcoes-imoveis", grupo: "Imóveis", titulo: "Opções de imóveis com foto",
    descricao: "Cartões com foto, dados e link do anúncio, prontos para enviar a um corretor.",
    prompt: "Me dê 3 opções de imóveis para venda na Orla", icone: Home,
  },
  {
    id: "book-imoveis", grupo: "Imóveis", titulo: "Book de imóveis em PDF",
    descricao: "PDF profissional com fotos e dados dos imóveis, para baixar ou enviar.",
    prompt: "Monte um book em PDF de 5 imóveis para venda na ", icone: BookOpen,
  },
  {
    id: "descricao-imovel", grupo: "Imóveis", titulo: "Descrição de imóvel",
    descricao: "Texto de anúncio a partir das especificações.",
    prompt: "Escreva uma descrição de anúncio, atraente e honesta, para este imóvel: ", icone: FileText,
  },
  {
    id: "resposta-whatsapp", grupo: "Comunicação", titulo: "Resposta no WhatsApp",
    descricao: "Rascunho pronto para copiar, com o tom da imobiliária.",
    prompt: "Escreva uma resposta de WhatsApp para o cliente que disse: ", icone: MessageSquareText,
  },
  {
    id: "objecao", grupo: "Comunicação", titulo: "Coach de objeção",
    descricao: "Respostas para preço, financiamento, vizinhança e outras objeções.",
    prompt: "Me ajude a contornar esta objeção do cliente: ", icone: ShieldQuestion,
  },
  {
    id: "bilingue", grupo: "Comunicação", titulo: "Atendimento bilíngue",
    descricao: "Traduzo conversas EN/ES e ajusto a formalidade.",
    prompt: "Traduza para o inglês, em tom profissional e cordial: ", icone: Languages,
  },
  {
    id: "pipeline", grupo: "Análise", titulo: "Diagnóstico do funil",
    descricao: "Encontro gargalos, negócios travados e a previsão.",
    prompt: "Faça o diagnóstico do funil de vendas: gargalos, negócios travados e o que fazer primeiro.",
    icone: BarChart3,
  },
  {
    id: "previsao", grupo: "Análise", titulo: "Previsão de receita",
    descricao: "Quanto está previsto fechar, por etapa do funil.",
    prompt: "Quanto está previsto fechar nos negócios abertos? Mostre por etapa.", icone: TrendingUp,
  },
  {
    id: "ajuda", grupo: "Usar a plataforma", titulo: "Como usar o Acessor",
    descricao: "Respondo dúvidas sobre o portal e o agente do WhatsApp.",
    prompt: "Como eu uso o portal e o agente do WhatsApp? Me explique as principais telas.", icone: CircleHelp,
  },
  {
    id: "autonomo", grupo: "Usar a plataforma", titulo: "Acessor autônomo", selo: "EM BREVE", emBreve: true,
    descricao: "Follow-ups, qualificação e visitas no automático, enquanto você foca em fechar.",
    prompt: "", icone: Bot,
  },
];

export const sugestoes = (filtro: string): Habilidade[] => {
  const q = filtro.trim().toLowerCase();
  if (!q) return HABILIDADES;
  return HABILIDADES.filter((h) => `${h.titulo} ${h.descricao} ${h.grupo}`.toLowerCase().includes(q));
};
