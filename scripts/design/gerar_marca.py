"""Gera os SVGs da marca Acessor Imobi (ícone, versões horizontal/vertical, versão animada) e o módulo TS com os caminhos.

A palavra é convertida em caminhos a partir das fontes Manrope do projeto (licença OFL), então os SVGs não dependem de
fonte instalada. Uso (precisa de fontTools):  python scripts/design/gerar_marca.py
"""
import json
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

RAIZ = Path(__file__).resolve().parents[2]
FONTES = RAIZ / "app/domain/book/fonts"
SAIDA = RAIZ / "web/public/marca"
TS = RAIZ / "web/src/components/marca/caminhos.ts"

NOME_FORTE, NOME_LEVE = "Acessor", "Imobi"

# Paleta do sistema (a mesma dos tokens do app): verde de ação e tinta.
VERDE_CLARO, VERDE_ESCURO_TEMA = "#2f8460", "#5cb98d"
TINTA_CLARO, TINTA_ESCURO = "#111a1f", "#f4f6f6"

# --- Símbolo: arco com extremidades redondas e o ponto à direita --------------------------------------
ARCO = "M 40 168 L 86 74 C 98 49, 122 49, 134 74 L 180 168"
ARCO_LARGURA = 32
PONTO = (190, 44, 19)  # cx, cy, r
SIMBOLO_BOX = (8, 8, 214, 182)  # x, y, w, h do desenho (com a espessura do traço)


def texto_em_caminhos(arquivo: str, texto: str, altura_x: float, rastro: float = 0.0):
    """(d, largura, altura_de_capital) do texto, com a linha de base em y=0 e a escala pela altura da capital."""
    fonte = TTFont(FONTES / arquivo)
    gs, cmap, hmtx = fonte.getGlyphSet(), fonte.getBestCmap(), fonte["hmtx"]
    upm = fonte["head"].unitsPerEm
    cap = fonte["OS/2"].sCapHeight or 0.7 * upm
    escala = altura_x / cap
    x, partes = 0.0, []
    for ch in texto:
        nome = cmap[ord(ch)]
        pen = SVGPathPen(gs, ntos=lambda v: f"{v:.1f}".rstrip("0").rstrip("."))
        gs[nome].draw(TransformPen(pen, (escala, 0, 0, -escala, x, 0)))
        partes.append(pen.getCommands())
        x += hmtx[nome][0] * escala + rastro * upm * escala
    return " ".join(p for p in partes if p), x - rastro * upm * escala, altura_x


def montar():
    forte, w1, _ = texto_em_caminhos("Manrope-ExtraBold.ttf", NOME_FORTE, CAP, -0.012)
    leve, w2, _ = texto_em_caminhos("Manrope-Regular.ttf", NOME_LEVE, CAP, -0.012)
    return {
        "arco": ARCO, "arcoLargura": ARCO_LARGURA, "ponto": list(PONTO), "simboloBox": list(SIMBOLO_BOX),
        "forte": forte, "forteLargura": round(w1, 1), "leve": leve, "leveLargura": round(w2, 1),
    }


def svg_simbolo(c, cor_arco, cor_ponto=None, anim=False):
    cx, cy, r = c["ponto"]
    cor_ponto = cor_ponto or cor_arco
    return (
        f'<path class="m-arco" d="{c["arco"]}" fill="none" stroke="{cor_arco}" stroke-width="{c["arcoLargura"]}" '
        f'stroke-linecap="round" stroke-linejoin="round"{" pathLength=\"1\"" if anim else ""}/>'
        f'<circle class="m-ponto" cx="{cx}" cy="{cy}" r="{r}" fill="{cor_ponto}"/>'
    )


# Dimensões do bloco horizontal: símbolo à esquerda; "Acessor" (forte) acima de "Imobi" (leve) à direita.
CAP, ENTRE = 74, 18  # altura da capital das duas linhas e o vão entre elas
H_GAP = 34


def horizontal(c, verde, tinta, anim=False):
    sx, sy, sw, sh = c["simboloBox"]
    texto_x = sw + H_GAP
    largura = texto_x + max(c["forteLargura"], c["leveLargura"]) + 6
    altura = sh
    # centraliza o bloco de duas linhas na altura do símbolo
    topo = (altura - (CAP * 2 + ENTRE)) / 2 + CAP  # linha de base da 1ª linha: o bloco de texto fica centrado no símbolo
    corpo = (
        f'<g transform="translate({-sx} {-sy})">{svg_simbolo(c, verde, anim=anim)}</g>'
        f'<g transform="translate({texto_x} {topo:.1f})"><g class="m-forte"><path d="{c["forte"]}" fill="{tinta}"/></g></g>'
        f'<g transform="translate({texto_x} {topo + CAP + ENTRE:.1f})"><g class="m-leve"><path d="{c["leve"]}" fill="{tinta}"/></g></g>'
    )
    return corpo, round(largura), round(altura)


def vertical(c, verde, tinta, anim=False):
    sx, sy, sw, sh = c["simboloBox"]
    largura = max(c["forteLargura"], c["leveLargura"], sw) + 20
    altura = sh + 26 + CAP + ENTRE + CAP + 6
    cx = largura / 2
    corpo = (
        f'<g transform="translate({cx - sw / 2 - sx:.1f} {-sy})">{svg_simbolo(c, verde, anim=anim)}</g>'
        f'<g class="m-forte" transform="translate({cx - c["forteLargura"] / 2:.1f} {sh + 26 + CAP})"><path d="{c["forte"]}" fill="{tinta}"/></g>'
        f'<g class="m-leve" transform="translate({cx - c["leveLargura"] / 2:.1f} {sh + 26 + CAP + CAP + ENTRE})"><path d="{c["leve"]}" fill="{tinta}"/></g>'
    )
    return corpo, round(largura), round(altura)


CSS_ANIM = """
<style>
  .m-arco{stroke-dasharray:1;stroke-dashoffset:0;animation:m-trace 1s cubic-bezier(.65,0,.25,1) both}
  .m-ponto{transform-box:fill-box;transform-origin:center;animation:m-pop .55s cubic-bezier(.3,1.6,.5,1) .78s both,m-flutua 3.4s ease-in-out 1.6s infinite}
  .m-forte{animation:m-sobe .6s cubic-bezier(.22,1,.36,1) .85s both}
  .m-leve{animation:m-sobe .6s cubic-bezier(.22,1,.36,1) 1.05s both}
  @keyframes m-trace{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
  @keyframes m-pop{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}
  @keyframes m-flutua{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
  @keyframes m-sobe{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){.m-arco,.m-ponto,.m-forte,.m-leve{animation:none!important}}
</style>
"""


def arquivo_svg(corpo, w, h, titulo, anim=False, fundo=None, extra=""):
    bg = f'<rect width="{w}" height="{h}" fill="{fundo}"/>' if fundo else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{titulo}">'
        f"<title>{titulo}</title>{CSS_ANIM if anim else ''}{extra}{bg}{corpo}</svg>\n"
    )


def main():
    c = montar()
    SAIDA.mkdir(parents=True, exist_ok=True)
    titulo = f"{NOME_FORTE} {NOME_LEVE}"
    sx, sy, sw, sh = c["simboloBox"]
    escrever = lambda nome, conteudo: (SAIDA / nome).write_text(conteudo, encoding="utf-8")

    # Símbolo e ícone de aplicativo (quadrado arredondado com o símbolo branco)
    sim = f'<g transform="translate({-sx} {-sy})">{svg_simbolo(c, VERDE_CLARO)}</g>'
    escrever("marca-simbolo.svg", arquivo_svg(sim, sw, sh, titulo))
    escrever("marca-simbolo-escuro.svg", arquivo_svg(f'<g transform="translate({-sx} {-sy})">{svg_simbolo(c, VERDE_ESCURO_TEMA)}</g>', sw, sh, titulo))
    esc = 0.62
    icone = (
        f'<rect width="256" height="256" rx="58" fill="{VERDE_CLARO}"/>'
        f'<g transform="translate({(256 - sw * esc) / 2 - sx * esc:.1f} {(256 - sh * esc) / 2 - sy * esc + 4:.1f}) scale({esc})">{svg_simbolo(c, "#ffffff")}</g>'
    )
    escrever("marca-icone-app.svg", arquivo_svg(icone, 256, 256, titulo))
    escrever("favicon.svg", arquivo_svg(icone, 256, 256, titulo))
    # Ícone de tela de início (iOS): quadrado cheio, o sistema arredonda os cantos
    quadrado = icone.replace('rx="58"', 'rx="0"')
    escrever("apple-touch.svg", arquivo_svg(quadrado, 256, 256, titulo))

    # Horizontais e vertical, claro e escuro
    for nome, verde, tinta in (("claro", VERDE_CLARO, TINTA_CLARO), ("escuro", VERDE_ESCURO_TEMA, TINTA_ESCURO)):
        corpo, w, h = horizontal(c, verde, tinta)
        escrever(f"marca-horizontal-{nome}.svg", arquivo_svg(corpo, w, h, titulo))
        corpo, w, h = vertical(c, verde, tinta)
        escrever(f"marca-vertical-{nome}.svg", arquivo_svg(corpo, w, h, titulo))
        # Versões animadas (entrada: o arco se desenha, o ponto salta, o nome sobe; depois o ponto flutua)
        corpo, w, h = horizontal(c, verde, tinta, anim=True)
        escrever(f"marca-animada-{nome}.svg", arquivo_svg(corpo, w, h, titulo, anim=True))
        corpo, w, h = vertical(c, verde, tinta, anim=True)
        escrever(f"marca-animada-vertical-{nome}.svg", arquivo_svg(corpo, w, h, titulo, anim=True))

    # Módulo TS para os componentes React (SVG em linha, cores pelas variáveis do tema)
    caixa_h = horizontal(c, "x", "x")[1:]
    caixa_v = vertical(c, "x", "x")[1:]
    TS.parent.mkdir(parents=True, exist_ok=True)
    TS.write_text(
        "// Gerado por scripts/design/gerar_marca.py — não edite à mão.\n"
        f"export const MARCA = {json.dumps({**c, 'horizontal': {'w': caixa_h[0], 'h': caixa_h[1], 'textoX': sw + H_GAP, 'topo': round((sh - (CAP * 2 + ENTRE)) / 2 + CAP, 1), 'linha2': CAP + ENTRE}, 'vertical': {'w': caixa_v[0], 'h': caixa_v[1]}}, ensure_ascii=False, indent=1)} as const;\n",
        encoding="utf-8",
    )
    print("ok", SAIDA)


if __name__ == "__main__":
    main()
