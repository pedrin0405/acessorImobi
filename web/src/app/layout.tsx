import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Acessor Imobi — Plataforma de Assistente Imobiliário",
  description: "Suporte operacional para corretores e imobiliárias com IA e Imoview",
  icons: {
    // A versão na URL força o navegador a trocar o favicon antigo em cache.
    icon: [{ url: "/marca/favicon.svg?v=2", type: "image/svg+xml" }],
    shortcut: [{ url: "/marca/favicon.svg?v=2", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png?v=2", sizes: "180x180", type: "image/png" }],
  },};

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
