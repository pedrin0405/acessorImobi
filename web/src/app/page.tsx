import Link from "next/link";
import { Building2, Shield, UserCheck, MessageSquare } from "lucide-react";
import LogoAcessor from "@/components/shell/LogoAcessor";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-slate-900 text-white">
      <div className="max-w-4xl w-full text-center space-y-8">
        <div className="space-y-4">
          <LogoAcessor className="w-24 h-24 mx-auto" alt="acessorImobi" />
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-sky-500/10 border border-sky-500/20 rounded-full text-sky-400 text-sm font-medium">
            <MessageSquare className="w-4 h-4" /> acessorImobi v2
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
            Plataforma do Assistente Imobiliário com IA
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Camada inteligente conectada ao CRM Imoview e WhatsApp para suporte de alta performance à equipe de corretores.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          <Link
            href="/admin"
            className="p-6 rounded-2xl bg-slate-800/60 border border-slate-700/60 hover:border-sky-500/50 transition-all group"
          >
            <div className="w-12 h-12 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-400 mb-4 group-hover:scale-105 transition-transform">
              <Shield className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold mb-2 text-white">Painel do Desenvolvedor</h2>
            <p className="text-slate-400 text-sm">
              Provisione novos tenants, monitore instâncias WhatsApp, saúde da infraestrutura e métricas globais.
            </p>
          </Link>

          <Link
            href="/tenant"
            className="p-6 rounded-2xl bg-slate-800/60 border border-slate-700/60 hover:border-emerald-500/50 transition-all group"
          >
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 mb-4 group-hover:scale-105 transition-transform">
              <Building2 className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold mb-2 text-white">Portal da Imobiliária</h2>
            <p className="text-slate-400 text-sm">
              Aprovação de corretores, configuração de persona do agente, auditoria e acompanhamento de pendências.
            </p>
          </Link>

          <Link
            href="/corretor"
            className="p-6 rounded-2xl bg-slate-800/60 border border-slate-700/60 hover:border-amber-500/50 transition-all group"
          >
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400 mb-4 group-hover:scale-105 transition-transform">
              <UserCheck className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold mb-2 text-white">Portal do Corretor</h2>
            <p className="text-slate-400 text-sm">
              Consulta de imóveis com resumos para clientes, carteira de clientes e histórico de interações.
            </p>
          </Link>
        </div>

        <div className="pt-6 border-t border-slate-800 text-xs text-slate-500">
          Isolamento Multi-tenant • Criptografia AES-256 • Conformidade LGPD
        </div>
      </div>
    </main>
  );
}
