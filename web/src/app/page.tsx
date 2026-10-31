import type { Metadata } from "next";
import Menu from "@/components/divulgacao/Menu";
import Tagline from "@/components/divulgacao/Tagline";
import DemoInterativa from "@/components/divulgacao/DemoInterativa";
import BookEmLeque from "@/components/divulgacao/BookEmLeque";
import Faq from "@/components/divulgacao/Faq";
import { PERGUNTAS } from "@/components/divulgacao/perguntas";
import Heroi from "@/components/divulgacao/Heroi";
import ComoFunciona from "@/components/divulgacao/ComoFunciona";
import Recursos from "@/components/divulgacao/Recursos";
import Integracao from "@/components/divulgacao/Integracao";
import Seguranca from "@/components/divulgacao/Seguranca";
import ChamadaFinal from "@/components/divulgacao/ChamadaFinal";
import Rodape from "@/components/divulgacao/Rodape";

const descricao =
  "Assistente de IA no WhatsApp para corretores de imóveis, com um portal para a imobiliária e outro para cada corretor, integrados ao seu CRM.";
const titulo = "Acessor Imobi: peça no WhatsApp, o resto se organiza";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const base = process.env.BASE_DOMAIN;
  return {
    ...(base ? { metadataBase: new URL(`https://${base}`) } : {}),
    title: titulo,
    description: descricao,
    openGraph: { title: titulo, description: descricao, type: "website", locale: "pt_BR", siteName: "Acessor Imobi", images: [{ url: "/og.png", width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: titulo, description: descricao, images: ["/og.png"] },
  };
}

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: PERGUNTAS.map((q) => ({ "@type": "Question", name: q.p, acceptedAnswer: { "@type": "Answer", text: q.r } })),
};

export default function Home() {
  return (
    <div className="dv-raiz" style={{ background: "#040807" }}>
      <a href="#conteudo" className="dv-pular">Pular para o conteúdo</a>
      <Menu />
      <main id="conteudo">
        <Heroi />
        <ComoFunciona />
        <Tagline />
        <Recursos />
        <DemoInterativa />
        <Integracao />
        <BookEmLeque />
        <Seguranca />
        <Faq />
        <ChamadaFinal />
      </main>
      <Rodape />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </div>
  );
}
