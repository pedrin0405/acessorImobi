import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "acessorImobi — Plataforma de Assistente Imobiliário",
  description: "Suporte operacional para corretores e imobiliárias com IA e Imoview",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
