import React from "react";

// Subconjunto de Markdown que o assistente usa: títulos, listas, negrito, itálico, código e links.
// Monta elementos React (nunca HTML cru), então o texto da IA não injeta nada na página.
const INLINE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;

function inline(texto: string, chave: string): React.ReactNode[] {
  return texto.split(INLINE).map((parte, i) => {
    const k = `${chave}-${i}`;
    if (parte.startsWith("**") && parte.endsWith("**") && parte.length > 4) return <strong key={k} className="font-semibold" style={{ color: "var(--text)" }}>{parte.slice(2, -2)}</strong>;
    if (parte.startsWith("`") && parte.endsWith("`") && parte.length > 2)
      return <code key={k} className="px-1 py-0.5 rounded font-mono text-[13px]" style={{ background: "var(--card-2)" }}>{parte.slice(1, -1)}</code>;
    if (parte.startsWith("*") && parte.endsWith("*") && parte.length > 2) return <em key={k}>{parte.slice(1, -1)}</em>;
    const link = parte.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link)
      return <a key={k} href={link[2]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2" style={{ color: "var(--accent-text)" }}>{link[1]}</a>;
    return <React.Fragment key={k}>{parte}</React.Fragment>;
  });
}

type Bloco =
  | { tipo: "titulo"; texto: string }
  | { tipo: "lista"; ordenada: boolean; itens: string[] }
  | { tipo: "paragrafo"; linhas: string[] };

function blocos(texto: string): Bloco[] {
  const saida: Bloco[] = [];
  for (const bruta of texto.replace(/\r/g, "").split("\n")) {
    const linha = bruta.trimEnd();
    const ultimo = saida[saida.length - 1];
    const titulo = linha.match(/^#{1,4}\s+(.+)$/);
    const marcador = linha.match(/^\s*[-*•]\s+(.+)$/);
    const numerado = linha.match(/^\s*\d+[.)]\s+(.+)$/);
    if (!linha.trim()) {
      saida.push({ tipo: "paragrafo", linhas: [] });
    } else if (titulo) {
      saida.push({ tipo: "titulo", texto: titulo[1] });
    } else if (marcador || numerado) {
      const ordenada = !!numerado;
      const item = (marcador || numerado)![1];
      if (ultimo && ultimo.tipo === "lista" && ultimo.ordenada === ordenada) ultimo.itens.push(item);
      else saida.push({ tipo: "lista", ordenada, itens: [item] });
    } else if (ultimo && ultimo.tipo === "paragrafo" && ultimo.linhas.length) {
      ultimo.linhas.push(linha);
    } else if (ultimo && ultimo.tipo === "paragrafo") {
      ultimo.linhas = [linha];
    } else {
      saida.push({ tipo: "paragrafo", linhas: [linha] });
    }
  }
  return saida.filter((b) => b.tipo !== "paragrafo" || b.linhas.length);
}

export default function Markdown({ texto }: { texto: string }) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed break-words" style={{ color: "var(--text-2)" }}>
      {blocos(texto).map((b, i) => {
        if (b.tipo === "titulo")
          return <h3 key={i} className="text-base font-semibold pt-1" style={{ color: "var(--text)" }}>{inline(b.texto, `t${i}`)}</h3>;
        if (b.tipo === "lista") {
          const Tag = b.ordenada ? "ol" : "ul";
          return (
            <Tag key={i} className={`${b.ordenada ? "list-decimal" : "list-disc"} pl-5 space-y-1 marker:text-[var(--text-4)]`}>
              {b.itens.map((it, j) => <li key={j}>{inline(it, `l${i}-${j}`)}</li>)}
            </Tag>
          );
        }
        return (
          <p key={i}>
            {b.linhas.map((l, j) => (
              <React.Fragment key={j}>{j > 0 && <br />}{inline(l, `p${i}-${j}`)}</React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
