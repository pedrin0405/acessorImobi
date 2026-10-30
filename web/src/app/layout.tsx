import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "acessorImobi — Plataforma de Assistente Imobiliário",
  description: "Suporte operacional para corretores e imobiliárias com IA e Imoview",
  icons: {
    icon: [{ url: "/logo-acessorimobi.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
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
