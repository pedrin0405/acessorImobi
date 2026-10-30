"use client";

import React, { useEffect, useState } from "react";
import { Home, RefreshCw, Search, X } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { brl, Lead, resumoPerfil } from "@/lib/crm";

interface ImovelMatch {
  codigo: number;
  tipo: string | null;
  bairro: string | null;
  quartos: number | null;
  valor: number | null;
  foto_url: string | null;
  link_anuncio: string | null;
}

const COR_TEMPERATURA: Record<string, string> = {
  quente: "bg-rose-50 text-rose-700 border-rose-200",
  morno: "bg-amber-50 text-amber-700 border-amber-200",
  frio: "bg-sky-50 text-sky-700 border-sky-200",
};

export default function Leads({ onAuthError }: { onAuthError: (e: unknown) => boolean }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [termo, setTermo] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<Lead | null>(null);
  const [imoveis, setImoveis] = useState<ImovelMatch[] | null>(null);

  const carregar = async () => {
    setLoading(true);
    setErro(null);
    try {
      const busca = termo.trim() ? `?termo=${encodeURIComponent(termo.trim())}` : "";
      const res = await fetchApi(`/admin/crm/leads${busca}`);
      if (!res.ok) throw new Error("falha");
      setLeads(await res.json());
    } catch (e) {
      if (!onAuthError(e)) setErro("Não foi possível carregar a carteira.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abrir = async (lead: Lead) => {
    setSelecionado(lead);
    setImoveis(null);
    try {
      const res = await fetchApi(`/admin/crm/leads/${lead.id}/match`);
      setImoveis(res.ok ? await res.json() : []);
    } catch (e) {
      if (!onAuthError(e)) setImoveis([]);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Carteira de clientes</h2>
          <p className="text-xs text-slate-500 mt-1">
            O que cada cliente procura, anotado pelo agente a partir das conversas com os corretores.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              carregar();
            }}
            className="relative"
          >
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Nome ou telefone"
              aria-label="Buscar cliente"
              className="pl-8 pr-3 py-2 w-52 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-slate-900"
            />
          </form>
          <button onClick={carregar} title="Atualizar" className="p-2 text-slate-400 hover:text-slate-600">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {erro && <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">{erro}</div>}

      <div className="grid lg:grid-cols-[1fr_340px]">
        <div className="p-6 overflow-x-auto">
          {leads.length === 0 && !loading ? (
            <p className="text-sm text-slate-500">
              Nenhum cliente na carteira ainda. No WhatsApp, o corretor pode dizer: &ldquo;anota a Ana, quer alugar
              apê de 2 quartos na Orla até 3 mil&rdquo;.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                  <th className="pb-2 font-medium">Cliente</th>
                  <th className="pb-2 font-medium">Procura</th>
                  <th className="pb-2 font-medium">Corretor</th>
                  <th className="pb-2 font-medium text-right">Negócios</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leads.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => abrir(l)}
                    className={`cursor-pointer hover:bg-slate-50 ${selecionado?.id === l.id ? "bg-slate-50" : ""}`}
                  >
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900">{l.nome}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${COR_TEMPERATURA[l.temperatura]}`}>
                          {l.temperatura}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 text-slate-600">{resumoPerfil(l.perfil)}</td>
                    <td className="py-2.5 text-slate-500">{l.corretor_nome ?? "—"}</td>
                    <td className="py-2.5 text-right text-slate-700">{l.negocios_abertos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Painel do cliente selecionado */}
        <aside className="border-t lg:border-t-0 lg:border-l border-slate-100 p-6 space-y-4">
          {!selecionado ? (
            <p className="text-sm text-slate-400">Selecione um cliente para ver os imóveis que combinam com ele.</p>
          ) : (
            <>
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-slate-900">{selecionado.nome}</h3>
                  <p className="text-xs text-slate-500 mt-1">{resumoPerfil(selecionado.perfil)}</p>
                  {selecionado.observacoes && <p className="text-xs text-slate-500 mt-1 italic">{selecionado.observacoes}</p>}
                </div>
                <button onClick={() => setSelecionado(null)} aria-label="Fechar" className="p-1 text-slate-400 hover:text-slate-700">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Combina com</h4>
              {imoveis === null ? (
                <p className="text-sm text-slate-400">Cruzando com a carteira…</p>
              ) : imoveis.length === 0 ? (
                <p className="text-sm text-slate-500">Nada na carteira atende a esse perfil hoje.</p>
              ) : (
                <ul className="space-y-3">
                  {imoveis.map((im) => (
                    <li key={im.codigo} className="flex gap-3">
                      {im.foto_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={im.foto_url} alt="" className="w-16 h-12 rounded-md object-cover bg-slate-100" />
                      ) : (
                        <div className="w-16 h-12 rounded-md bg-slate-100 flex items-center justify-center">
                          <Home className="w-4 h-4 text-slate-400" />
                        </div>
                      )}
                      <div className="min-w-0 text-xs">
                        <p className="font-medium text-slate-900 truncate">
                          {im.tipo} · {im.bairro}
                        </p>
                        <p className="text-slate-500">
                          {im.quartos ? `${im.quartos} quartos · ` : ""}
                          {im.valor ? brl(im.valor) : "valor sob consulta"}
                        </p>
                        {im.link_anuncio ? (
                          <a href={im.link_anuncio} target="_blank" rel="noreferrer" className="text-slate-700 underline">
                            Código {im.codigo}
                          </a>
                        ) : (
                          <span className="text-slate-500">Código {im.codigo}</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
