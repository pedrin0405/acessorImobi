import type { Metadata } from "next";
import Cabecalho from "@/components/divulgacao/Cabecalho";
import Heroi from "@/components/divulgacao/Heroi";
import ComoFunciona from "@/components/divulgacao/ComoFunciona";
import Recursos from "@/components/divulgacao/Recursos";
import Integracao from "@/components/divulgacao/Integracao";
import Seguranca from "@/components/divulgacao/Seguranca";
import ChamadaFinal from "@/components/divulgacao/ChamadaFinal";
import Rodape from "@/components/divulgacao/Rodape";

const descricao =
  "Assistente de IA no WhatsApp para corretores de imóveis, com um portal para a imobiliária e outro para cada corretor, integrados ao CRM Imoview.";

export const metadata: Metadata = {
  title: "Acessor Imobi — Peça no WhatsApp, o resto se organiza",
  description: descricao,
  openGraph: {
    title: "Acessor Imobi — Peça no WhatsApp, o resto se organiza",
    description: descricao,
    type: "website",
    locale: "pt_BR",
    siteName: "Acessor Imobi",
  },
};

export default function Home() {
  return (
    <div className="dv-raiz" style={{ background: "#040807" }}>
      <Cabecalho />
      <main>
        <Heroi />
        <ComoFunciona />
        <Recursos />
        <Integracao />
        <Seguranca />
        <ChamadaFinal />
      </main>
      <Rodape />
    </div>
  );
}
