"""
Desenho do book em PDF (reportlab). Sem acesso a rede nem banco: recebe imóveis, fotos já baixadas e os
dados da imobiliária, e devolve os bytes do arquivo.

Três mundos visuais, cada um com a sua tipografia e a sua grade (fontes Instrument Serif e Manrope, OFL, embutidas):
- classico  (Editorial): revista de arquitetura. Papel quente, título em serifa sobre a foto, tabela de dados e texto em duas colunas.
- galeria   (Vitrine):   cinema. Fundo escuro, fotos de sangria total, título e valor sobre a imagem.
- compacto  (Ficha):     folha técnica suíça. Índice da seleção e dois imóveis por página, dados em tabela.
"""
import io
import re
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image
from reportlab.lib.colors import Color, HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

LARG, ALT = A4
M = 40.0
FONT_DIR = Path(__file__).parent / "fonts"
_FONTES = {
    "Serif": "InstrumentSerif-Regular.ttf", "SerifIt": "InstrumentSerif-Italic.ttf",
    "Reg": "Manrope-Regular.ttf", "Med": "Manrope-Medium.ttf", "Semi": "Manrope-SemiBold.ttf",
    "Bold": "Manrope-Bold.ttf", "Black": "Manrope-ExtraBold.ttf",
}
_registradas = False


def _registrar() -> None:
    global _registradas
    if not _registradas:
        for nome, arquivo in _FONTES.items():
            pdfmetrics.registerFont(TTFont(f"AC-{nome}", str(FONT_DIR / arquivo)))
        _registradas = True


# --- Utilidades de texto ------------------------------------------------------------

def _t(valor: Any, fonte: str = "AC-Reg") -> str:
    """Texto limpo; o que a fonte não tem (emoji, ideogramas) vira '?' em vez de um quadrado."""
    s = re.sub(r"[\r\n\t]+", " ", str(valor or ""))
    cmap = pdfmetrics.getFont(fonte).face.charToGlyph
    saida = []
    for ch in s:
        if ord(ch) in cmap or ch == " ":
            saida.append(ch)
            continue
        base = unicodedata.normalize("NFKD", ch)  # '²' -> '2' quando a fonte não tem o expoente
        saida.append(base if base and all(ord(c) in cmap for c in base) else "?")
    return "".join(saida)


def reais(valor: Any) -> str:
    try:
        n = float(valor)
    except (TypeError, ValueError):
        return ""
    return "R$ " + f"{n:,.0f}".replace(",", ".") if n else ""


def _numero(valor: Any) -> str:
    return f"{float(valor):,.0f}".replace(",", ".")


def _area(valor: Any) -> str:
    try:
        return f"{_numero(valor)} m²" if float(valor) else ""
    except (TypeError, ValueError):
        return ""


def _caixa_baixa(s: str) -> str:
    """'GALPÃO COMERCIAL 4.100 M²' -> 'Galpão comercial 4.100 m²' (títulos do Imoview costumam vir gritando)."""
    letras = [c for c in s if c.isalpha()]
    if letras and sum(c.isupper() for c in letras) / len(letras) > 0.6:
        s = s.lower()
    s = " ".join(s.split())
    return s[:1].upper() + s[1:]


def titulo_do_imovel(im: Dict[str, Any]) -> Tuple[str, str]:
    """(título principal, complemento). O título do anúncio costuma ser 'Tipo | detalhe | detalhe': o primeiro trecho manda."""
    bruto = str(im.get("titulo") or "").strip()
    partes = [p.strip() for p in bruto.split("|") if p.strip()]
    if not partes:
        return f"{im.get('tipo') or 'Imóvel'} em {im.get('bairro') or 'local não informado'}", ""
    principal = _caixa_baixa(partes[0])
    resto = [_caixa_baixa(p) for p in partes[1:]]
    if len(principal) < 22 and resto:
        principal += " · " + resto.pop(0).lower()
    return principal, "  ·  ".join(resto)


def local_do_imovel(im: Dict[str, Any]) -> str:
    return " · ".join(p for p in (im.get("bairro"), im.get("cidade")) if p)


def _luma(cor: Color) -> float:
    return 0.2126 * cor.red + 0.7152 * cor.green + 0.0722 * cor.blue


def _mistura(a: Color, b: Color, t: float) -> Color:
    return Color(a.red + (b.red - a.red) * t, a.green + (b.green - a.green) * t, a.blue + (b.blue - a.blue) * t)


def linhas_de_dados(im: Dict[str, Any], custos: bool) -> List[Tuple[str, str]]:
    itens = [("Quartos", im.get("quartos")), ("Suítes", im.get("suites")), ("Banheiros", im.get("banheiros")),
             ("Vagas", im.get("vagas")), ("Área", _area(im.get("area_m2")) or None)]
    if custos:
        itens += [("Condomínio", reais(im.get("valor_condominio")) or None), ("IPTU", reais(im.get("valor_iptu")) or None)]
    return [(r, str(v)) for r, v in itens if v]


# --- Imagens -----------------------------------------------------------------------

def _recortar(dados: Optional[bytes], largura: float, altura: float, escuro: Optional[Tuple[Color, str, float, float]] = None) -> Optional[io.BytesIO]:
    """Corta a foto na proporção da caixa ('cover') a ~170 dpi. `escuro` = (cor, lado, fração da altura, opacidade máxima)."""
    if not dados:
        return None
    try:
        img = Image.open(io.BytesIO(dados)).convert("RGB")
    except Exception:  # noqa: BLE001 - foto corrompida: o book segue sem ela
        return None
    alvo = largura / altura
    w, h = img.size
    if w / h > alvo:
        novo = int(h * alvo)
        img = img.crop(((w - novo) // 2, 0, (w - novo) // 2 + novo, h))
    else:
        novo = int(w / alvo)
        img = img.crop((0, (h - novo) // 2, w, (h - novo) // 2 + novo))
    px = int(largura * 170 / 72)
    if img.width > px:
        img = img.resize((px, max(1, int(px / alvo))), Image.LANCZOS)
    if escuro:
        cor, lado, fracao, forca = escuro
        faixa = max(2, int(img.height * fracao))
        degrade = Image.linear_gradient("L").resize((img.width, faixa))
        if lado == "cima":
            degrade = degrade.transpose(Image.FLIP_TOP_BOTTOM)
        degrade = degrade.point(lambda v: int(((v / 255) ** 1.6) * 255 * forca))
        mascara = Image.new("L", img.size, 0)
        mascara.paste(degrade, (0, 0 if lado == "cima" else img.height - faixa))
        tinta = Image.new("RGB", img.size, (int(cor.red * 255), int(cor.green * 255), int(cor.blue * 255)))
        img = Image.composite(tinta, img, mascara)
    saida = io.BytesIO()
    img.save(saida, "JPEG", quality=84)
    saida.seek(0)
    return saida


class _Base:
    def __init__(self, config: Dict[str, Any], empresa: Dict[str, Any], corretor: Optional[Dict[str, Any]], titulo: Optional[str]):
        _registrar()
        self.cfg, self.empresa, self.corretor, self.titulo = config, empresa, corretor, titulo
        self.buf = io.BytesIO()
        self.c = canvas.Canvas(self.buf, pagesize=A4)
        self.c.setTitle(_t(titulo or config.get("titulo_capa") or "Book de imóveis"))
        self.c.setAuthor(_t(empresa.get("nome") or ""))
        self.pri, self.sec = HexColor(config["cor_primaria"]), HexColor(config["cor_secundaria"])
        self.serifa = config.get("fonte") == "classica"
        self.pagina = 0
        self.fundo = white
        self.tinta = HexColor("#16181d")
        self.suave = HexColor("#6b7078")
        self.linha = HexColor("#d8d5cf")

    # Coordenadas medidas do topo da página (y cresce para baixo), como num layout de revista.
    def _y(self, y: float) -> float:
        return ALT - y

    def pintar(self, cor: Color, x: float, y: float, w: float, h: float) -> None:
        self.c.setFillColor(cor)
        self.c.rect(x, self._y(y + h), w, h, stroke=0, fill=1)

    def fundo_pagina(self) -> None:
        self.pintar(self.fundo, 0, 0, LARG, ALT)

    def fio(self, x1: float, y: float, x2: float, cor: Optional[Color] = None, espessura: float = 0.5) -> None:
        self.c.setStrokeColor(cor or self.linha)
        self.c.setLineWidth(espessura)
        self.c.line(x1, self._y(y), x2, self._y(y))

    def foto(self, dados: Optional[bytes], x: float, y: float, w: float, h: float, escuro=None) -> None:
        recorte = _recortar(dados, w, h, escuro)
        if recorte:
            self.c.drawImage(ImageReader(recorte), x, self._y(y + h), w, h)
        else:
            self.pintar(_mistura(self.fundo, self.tinta, 0.08), x, y, w, h)
            self.txt(x + w / 2, y + h / 2 + 3, "Sem foto", "AC-Med", 8, self.suave, "c", 0.6)

    def txt(self, x: float, y: float, s: Any, fonte: str = "AC-Reg", tam: float = 10, cor: Optional[Color] = None, alinhar: str = "e", espaco: float = 0) -> float:
        """Escreve uma linha com a linha de base em y (do topo). Devolve a largura."""
        s = _t(s, fonte)
        larg = pdfmetrics.stringWidth(s, fonte, tam) + espaco * max(0, len(s) - 1)
        x0 = x - larg if alinhar == "d" else x - larg / 2 if alinhar == "c" else x
        t = self.c.beginText(x0, self._y(y))
        t.setFont(fonte, tam)
        t.setFillColor(cor or self.tinta)
        t.setCharSpace(espaco)  # o espaçamento faz parte do estado gráfico: sempre redefinido
        t.textOut(s)
        self.c.drawText(t)
        return larg

    def link(self, x: float, y: float, url: str, cor: Color, tam: float = 8.5) -> None:
        """'Ver anúncio no site' + endereço curto, clicável no PDF (abre a página do imóvel no site da imobiliária)."""
        url = str(url)
        curto = re.sub(r"^https?://(www\.)?", "", url)
        curto = re.sub(r"/imovel/[^/]+/", "/imovel/…/", curto)
        rotulo = "Ver anúncio no site"
        larg1 = self.txt(x, y, rotulo, "AC-Bold", tam, cor)
        larg2 = self.txt(x + larg1 + 7, y, curto[:48], "AC-Reg", tam - 0.5, cor)
        self.c.linkURL(url, (x, self._y(y + tam * 0.3), x + larg1 + 7 + larg2, self._y(y - tam)), relative=0)
        self.c.setStrokeColor(cor)
        self.c.setLineWidth(0.5)
        self.c.line(x, self._y(y + 2), x + larg1, self._y(y + 2))

    def quebrar(self, s: Any, fonte: str, tam: float, largura: float) -> List[str]:
        return simpleSplit(_t(s, fonte), fonte, tam, largura)

    def bloco(self, x: float, y: float, s: Any, largura: float, fonte: str, tam: float, entrelinha: float, cor: Optional[Color] = None,
              max_linhas: int = 99, espaco: float = 0) -> float:
        """Parágrafo com a primeira linha de base em y; devolve a linha de base seguinte."""
        linhas = self.quebrar(s, fonte, tam, largura)
        if len(linhas) > max_linhas:
            linhas = linhas[:max_linhas]
            linhas[-1] = linhas[-1].rstrip(" .,;:-|") + "…"
        for linha in linhas:
            self.txt(x, y, linha, fonte, tam, cor, "e", espaco)
            y += entrelinha
        return y

    def display(self) -> str:
        return "AC-Serif" if self.serifa else "AC-Black"

    def logo(self, x: float, y: float, h: float, sobre_foto: bool = False) -> float:
        """Logo da imobiliária (em plaquinha clara se estiver sobre foto) ou o nome em texto. Devolve a largura usada."""
        if not self.cfg.get("mostrar_logo"):
            return 0
        dados = self.empresa.get("logo")
        if dados:
            try:
                img = Image.open(io.BytesIO(dados)).convert("RGBA")
                razao = img.width / img.height
                w = min(h * razao, 150)
                h2 = w / razao
                pad = 7 if sobre_foto else 0
                if sobre_foto:
                    self.pintar(white, x, y, w + 2 * pad, h2 + 2 * pad)
                fundo = Image.new("RGBA", img.size, (255, 255, 255, 255))
                fundo.alpha_composite(img)
                saida = io.BytesIO()
                fundo.convert("RGB").save(saida, "PNG")
                saida.seek(0)
                self.c.drawImage(ImageReader(saida), x + pad, self._y(y + pad + h2), w, h2)
                return w + 2 * pad
            except Exception:  # noqa: BLE001
                pass
        nome = self.empresa.get("nome") or ""
        if nome:
            cor = white if sobre_foto else self.tinta
            return self.txt(x, y + h * 0.72, nome.upper()[:32], "AC-Bold", 8.5, cor, "e", 1.6)
        return 0

    def rodape_simples(self, cor: Color, esquerda: str, mostrar_numero: bool = True) -> None:
        self.pagina += 1
        self.txt(M, ALT - 24, esquerda[:80], "AC-Med", 7, cor, "e", 0.4)
        if mostrar_numero:
            self.txt(LARG - M, ALT - 24, f"{self.pagina:02d}", "AC-SerifIt" if self.serifa else "AC-Semi", 9, cor, "d")

    def proxima(self) -> None:
        self.c.showPage()

    def preco_texto(self, im: Dict[str, Any]) -> Tuple[str, str]:
        valor = _numero(im.get("valor")) if im.get("valor") else ""
        sufixo = "por mês" if im.get("finalidade") == "aluguel" else "à venda"
        return valor, sufixo

    def contato_linhas(self) -> List[str]:
        e = self.empresa
        return [x for x in (e.get("telefone"), e.get("email"), e.get("site"), f"CRECI {e['creci']}" if e.get("creci") else None) if x]

    def corretor_linhas(self) -> List[str]:
        if self.cfg.get("mostrar_corretor") and self.corretor and self.corretor.get("nome"):
            return [x for x in (self.corretor["nome"], self.corretor.get("telefone")) if x]
        return []

    def contracapa_base(self) -> bool:
        return bool(self.cfg["mostrar_capa"] or self.cfg["mostrar_contato"] or self.cfg["mensagem_final"])


# ======================================================================================
# EDITORIAL
# ======================================================================================

class Editorial(_Base):
    def __init__(self, *a):
        super().__init__(*a)
        self.fundo = _mistura(HexColor("#f6f2ea"), self.pri, 0.04)
        self.tinta = _mistura(HexColor("#17140f"), self.pri, 0.14)
        self.suave = _mistura(HexColor("#7a746a"), self.pri, 0.10)
        self.linha = _mistura(self.fundo, self.tinta, 0.2)
        self.D = "AC-Serif" if self.serifa else "AC-Black"

    def capa(self, imoveis) -> None:
        self.fundo_pagina()
        hero = (imoveis[0].get("_fotos") or [None])[0] if imoveis else None
        self.foto(hero, 0, 0, LARG, 520, (Color(0, 0, 0), "cima", 0.28, 0.55))
        self.logo(M, M, 30, sobre_foto=True)
        self.pintar(self.sec, M, 560, 46, 4)
        y = 618
        tam = 54 if self.serifa else 40
        for linha in self.quebrar(self.titulo or self.cfg.get("titulo_capa") or "Seleção de imóveis", self.D, tam, LARG - 2 * M)[:3]:
            self.txt(M, y, linha, self.D, tam, self.tinta)
            y += tam * 1.02
        if self.cfg.get("subtitulo_capa"):
            self.bloco(M, y + 10, self.cfg["subtitulo_capa"], 380, "AC-SerifIt" if self.serifa else "AC-Med", 17 if self.serifa else 11.5, 22, self.suave, 2)
        self.fio(M, 770, LARG - M, self.tinta, 0.6)
        n = len(imoveis)
        self.txt(M, 792, f"{n} {'imóvel' if n == 1 else 'imóveis'} · {datetime.now().strftime('%d/%m/%Y')}", "AC-Semi", 8.5, self.tinta, "e", 0.3)
        for i, l in enumerate(self.corretor_linhas()):
            self.txt(LARG - M, 792 + i * 12, l, "AC-Semi" if i == 0 else "AC-Reg", 8.5, self.tinta if i == 0 else self.suave, "d")
        self.proxima()

    def pagina_imovel(self, im) -> None:
        cfg = self.cfg
        self.fundo_pagina()
        fotos = (im.get("_fotos") or [])[: cfg["fotos_por_imovel"]]
        self.foto(fotos[0] if fotos else None, 0, 0, LARG, 392)
        self.pintar(self.fundo, 0, 330, 392, 130)
        principal, complemento = titulo_do_imovel(im)
        tam = 29 if self.serifa else 22
        y = 368
        for linha in self.quebrar(principal, self.D, tam, 330)[:2]:
            self.txt(M, y, linha, self.D, tam, self.tinta)
            y += tam * 1.08
        sub = " · ".join(p for p in (local_do_imovel(im), complemento[:60] if complemento else "") if p)
        if sub:
            self.bloco(M, y + 6, sub, 330, "AC-Med", 8.5, 12, self.suave, 2)
        topo = 470
        # coluna esquerda: valor e tabela
        valor, sufixo = self.preco_texto(im)
        if valor:
            self.txt(M, topo, sufixo, "AC-Semi", 7.5, self.suave, "e", 0.8)
            larg_rs = self.txt(M, topo + 34, "R$", "AC-Semi", 10, self.suave)
            self.txt(M + larg_rs + 4, topo + 34, valor, self.D, 33 if self.serifa else 25, self.tinta)
        else:
            self.txt(M, topo + 28, "Valor sob consulta", self.D, 18, self.tinta)
        y = topo + 56
        for rotulo, v in linhas_de_dados(im, cfg["mostrar_custos"])[:7]:
            self.fio(M, y, M + 156)
            self.txt(M, y + 17, rotulo, "AC-Med", 8, self.suave)
            self.txt(M + 156, y + 18, v, self.D if self.serifa else "AC-Bold", 17 if self.serifa else 11, self.tinta, "d")
            y += 26
        self.fio(M, y, M + 156)
        fim_esq = y
        # coluna direita: texto
        x2, l2 = 236, LARG - M - 236
        yt = topo + 10
        descricao = " ".join(str(im.get("descricao") or "").split()) if cfg["mostrar_descricao"] else ""
        extras = fotos[1:4]
        limite = (690 if extras else 770) - 6
        if descricao:
            achado = re.match(r"(.{40,190}?[.!?])(\s|$)", descricao)
            abertura, resto = (achado.group(1), descricao[achado.end():]) if achado else (descricao[:160], descricao[160:])
            yt = self.bloco(x2, yt + 12, abertura, l2, "AC-SerifIt" if self.serifa else "AC-Semi", 14.5 if self.serifa else 11, 19, self.tinta, 4)
            if resto.strip():
                yt = self.bloco(x2, yt + 8, resto.strip(), l2, "AC-Reg", 8.8, 13.6, self.tinta, max(1, int((limite - yt - 60) // 13.6)))
        itens = (im.get("caracteristicas") or []) + (im.get("extras") or [])
        if cfg["mostrar_caracteristicas"] and itens and yt < limite - 60:
            yt += 10
            yt = self.bloco(x2, yt + 4, "Características  " + ", ".join(str(i) for i in itens[:12]), l2, "AC-Med", 8.2, 12.5, self.suave, 3)
        if cfg["mostrar_endereco"]:
            e = im.get("endereco") or {}
            rua = " ".join(str(p) for p in ((e.get("logradouro") or e.get("endereco")), e.get("numero")) if p) if isinstance(e, dict) else ""
            if rua and yt < limite - 14:
                yt = self.bloco(x2, yt + 10, "Endereço  " + rua, l2, "AC-Med", 8.2, 12, self.suave, 2)
        if cfg["mostrar_link"] and im.get("link"):
            self.link(x2, max(yt, fim_esq - 4) + 14 if not extras else min(max(yt, fim_esq - 4) + 14, limite), im["link"], self.sec, 8.5)
        # tira de fotos
        if extras:
            n = len(extras)
            gap = 6
            lado = (LARG - 2 * M - gap * (n - 1)) / n
            for i, f in enumerate(extras):
                self.foto(f, M + i * (lado + gap), 702, lado, 84)
        self.fio(M, 806, LARG - M)
        self.txt(M, 822, f"{self.empresa.get('nome') or ''}   ·   Cód. {im.get('codigo')}", "AC-Med", 7, self.suave, "e", 0.3)
        self.pagina += 1
        self.txt(LARG - M, 823, f"{self.pagina}", "AC-SerifIt", 11, self.tinta, "d")
        self.proxima()

    def contracapa(self) -> None:
        self.pintar(self.pri, 0, 0, LARG, ALT)
        claro = _luma(self.pri) < 0.5
        cor = HexColor("#f6f2ea") if claro else self.tinta
        suave = _mistura(self.pri, cor, 0.7)
        self.logo(M, M, 30, sobre_foto=True)
        y = 330
        if self.cfg.get("mensagem_final"):
            for linha in self.quebrar(self.cfg["mensagem_final"], self.D, 34 if self.serifa else 24, LARG - 2 * M - 60)[:6]:
                self.txt(M, y, linha, self.D, 34 if self.serifa else 24, cor)
                y += 36 if self.serifa else 29
        self.pintar(self.sec, M, y + 8, 46, 4)
        yb = ALT - 160
        if self.cfg.get("mostrar_contato"):
            self.txt(M, yb, self.empresa.get("nome") or "", "AC-Bold", 10.5, cor)
            for i, l in enumerate(self.contato_linhas()):
                self.txt(M, yb + 18 + i * 15, l, "AC-Reg", 9, suave)
        for i, l in enumerate(self.corretor_linhas()):
            self.txt(LARG - M, yb + i * 15, l, "AC-Semi" if i == 0 else "AC-Reg", 9.5 if i == 0 else 9, cor if i == 0 else suave, "d")
        self.proxima()


# ======================================================================================
# VITRINE
# ======================================================================================

class Vitrine(_Base):
    def __init__(self, *a):
        super().__init__(*a)
        escuro = _luma(self.pri) < 0.45
        self.fundo = self.pri if escuro else HexColor("#101114")
        self.tinta = HexColor("#f4f1ea")
        self.suave = _mistura(self.fundo, self.tinta, 0.62)
        self.linha = _mistura(self.fundo, self.tinta, 0.18)

    def capa(self, imoveis) -> None:
        self.fundo_pagina()
        hero = (imoveis[0].get("_fotos") or [None])[0] if imoveis else None
        self.foto(hero, 0, 0, LARG, ALT, (self.fundo, "baixo", 0.72, 0.96))
        self.logo(M, M, 30, sobre_foto=True)
        n = len(imoveis)
        self.txt(LARG - M, M + 14, f"{n} {'imóvel' if n == 1 else 'imóveis'}  ·  {datetime.now().strftime('%m/%Y')}", "AC-Semi", 8, white, "d", 1.2)
        y = 560
        for linha in self.quebrar(self.titulo or self.cfg.get("titulo_capa") or "Seleção de imóveis", "AC-Black", 50, LARG - 2 * M)[:3]:
            self.txt(M, y, linha, "AC-Black", 50, self.tinta)
            y += 50
        self.pintar(self.sec, M, y - 18, 52, 4)
        if self.cfg.get("subtitulo_capa"):
            self.bloco(M, y + 14, self.cfg["subtitulo_capa"], 380, "AC-Med", 12.5, 18, _mistura(self.fundo, self.tinta, 0.85), 2)
        for i, l in enumerate(self.corretor_linhas()):
            self.txt(LARG - M, ALT - 62 + i * 14, l, "AC-Bold" if i == 0 else "AC-Reg", 9.5, self.tinta if i == 0 else self.suave, "d")
        self.proxima()

    def pagina_imovel(self, im) -> None:
        cfg = self.cfg
        self.fundo_pagina()
        fotos = (im.get("_fotos") or [])[: cfg["fotos_por_imovel"]]
        extras = fotos[1:6]
        alt_hero = 408 if extras else 540
        self.foto(fotos[0] if fotos else None, 0, 0, LARG, alt_hero, (self.fundo, "baixo", 0.5, 0.94))
        principal, complemento = titulo_do_imovel(im)
        valor, sufixo = self.preco_texto(im)
        base = alt_hero - 24
        linhas = self.quebrar(principal, "AC-Black", 23, 330)[:2]
        yy = base - (len(linhas) - 1) * 26 - 22
        for linha in linhas:
            self.txt(M, yy, linha, "AC-Black", 23, self.tinta)
            yy += 26
        self.txt(M, base, local_do_imovel(im), "AC-Med", 9, self.suave, "e", 0.3)
        if valor:
            larg = self.txt(LARG - M, base, valor, "AC-Black", 27, self.sec, "d")
            self.txt(LARG - M - larg - 6, base, "R$", "AC-Bold", 10, self.sec, "d")
            self.txt(LARG - M, base - 36, sufixo.upper(), "AC-Bold", 7, self.suave, "d", 1.4)
        y = alt_hero + 3
        if extras:
            if len(extras) <= 3:
                fileiras = [extras]
            else:
                fileiras = [extras[:3], extras[3:]]
            for k, fileira in enumerate(fileiras):
                h = 128 if k == 0 else 104
                n = len(fileira)
                gap = 3
                lado = (LARG - gap * (n - 1)) / n
                for i, f in enumerate(fileira):
                    self.foto(f, i * (lado + gap), y, lado, h)
                y += h + 3
        y += 26
        dados = [f"{v} {r.lower()}" if r in ("Quartos", "Suítes", "Banheiros", "Vagas") else v for r, v in linhas_de_dados(im, False)]
        x = M
        for i, d in enumerate(dados):
            x += self.txt(x, y, d, "AC-Semi", 10, self.tinta)
            if i < len(dados) - 1:
                self.pintar(self.sec, x + 10, y - 4, 3, 3)
                x += 23
        y += 20
        if cfg["mostrar_custos"]:
            partes = [f"{r} {v}" for r, v in linhas_de_dados(im, True) if r in ("Condomínio", "IPTU")]
            if im.get("aceita_financiamento"):
                partes.append("Aceita financiamento")
            if partes:
                self.txt(M, y, "   ·   ".join(partes), "AC-Reg", 8.5, self.suave)
                y += 18
        if cfg["mostrar_descricao"] and im.get("descricao") and y < 700:
            y = self.bloco(M, y + 6, " ".join(str(im["descricao"]).split()), LARG - 2 * M - 70, "AC-Reg", 9.2, 14, _mistura(self.fundo, self.tinta, 0.76), max(1, min(5, int((780 - y) // 14))))
        if cfg["mostrar_link"] and im.get("link"):
            self.link(M, 800, im["link"], self.sec, 8.5)
        self.pagina += 1
        self.txt(LARG - M, 817, f"{self.pagina:02d}  /  CÓD. {im.get('codigo')}", "AC-Semi", 7, self.suave, "d", 1)
        self.proxima()

    def contracapa(self) -> None:
        self.fundo_pagina()
        self.logo(M, M, 30, sobre_foto=True)
        y = 340
        if self.cfg.get("mensagem_final"):
            for linha in self.quebrar(self.cfg["mensagem_final"], "AC-Black", 30, LARG - 2 * M - 40)[:6]:
                self.txt(M, y, linha, "AC-Black", 30, self.tinta)
                y += 34
        self.pintar(self.sec, M, y + 6, 52, 4)
        yb = ALT - 160
        if self.cfg.get("mostrar_contato"):
            self.txt(M, yb, self.empresa.get("nome") or "", "AC-Bold", 10.5, self.tinta)
            for i, l in enumerate(self.contato_linhas()):
                self.txt(M, yb + 18 + i * 15, l, "AC-Reg", 9, self.suave)
        for i, l in enumerate(self.corretor_linhas()):
            self.txt(LARG - M, yb + i * 15, l, "AC-Bold" if i == 0 else "AC-Reg", 9.5, self.tinta if i == 0 else self.suave, "d")
        self.proxima()


# ======================================================================================
# FICHA
# ======================================================================================

class Ficha(_Base):
    def __init__(self, *a):
        super().__init__(*a)
        self.fundo = white
        self.tinta = _mistura(HexColor("#0c0d10"), self.pri, 0.35)
        self.suave = _mistura(HexColor("#6f737a"), self.pri, 0.1)
        self.linha = HexColor("#d9dadd")

    def _cabecalho(self) -> None:
        self.logo(M, 26, 18)
        self.txt(LARG - M, 38, (self.titulo or self.cfg.get("titulo_capa") or "")[:50], "AC-Semi", 7.5, self.suave, "d", 0.4)
        self.fio(M, 56, LARG - M, self.tinta, 0.8)

    def capa(self, imoveis) -> None:
        """Índice da seleção: título grande e uma linha por imóvel."""
        self.fundo_pagina()
        self.logo(M, M, 22)
        y = 128
        for linha in self.quebrar(self.titulo or self.cfg.get("titulo_capa") or "Seleção de imóveis", "AC-Black", 44, LARG - 2 * M)[:2]:
            self.txt(M, y, linha, "AC-Black", 44, self.tinta)
            y += 44
        if self.cfg.get("subtitulo_capa"):
            y = self.bloco(M, y - 6, self.cfg["subtitulo_capa"], 420, "AC-Med", 11.5, 16, self.suave, 2)
        y = max(y + 22, 236)
        self.pintar(self.sec, M, y - 10, LARG - 2 * M, 3)
        cab = [(M, "e", "CÓD."), (M + 130, "e", "IMÓVEL"), (M + 340, "d", "ÁREA"), (LARG - M - 100, "d", "VAGAS"), (LARG - M, "d", "VALOR")]
        for x, al, rot in cab:
            self.txt(x, y + 12, rot, "AC-Bold", 6.5, self.suave, al, 1.1)
        y += 22
        for im in imoveis[:12]:
            self.fio(M, y, LARG - M)
            self.foto((im.get("_fotos") or [None])[0], M, y + 6, 62, 38)
            self.txt(M + 74, y + 29, im.get("codigo"), "AC-Black", 11, self.sec)
            principal, _ = titulo_do_imovel(im)
            self.txt(M + 130, y + 22, principal[:38], "AC-Bold", 9, self.tinta)
            self.txt(M + 130, y + 35, local_do_imovel(im)[:44], "AC-Reg", 8, self.suave)
            self.txt(M + 340, y + 29, _area(im.get("area_m2")) or "—", "AC-Med", 9, self.tinta, "d")
            self.txt(LARG - M - 100, y + 29, str(im.get("vagas") or "—"), "AC-Med", 9, self.tinta, "d")
            self.txt(LARG - M, y + 29, reais(im.get("valor")) or "Sob consulta", "AC-Bold", 10, self.tinta, "d")
            y += 50
        self.fio(M, y, LARG - M, self.tinta, 0.8)
        for i, l in enumerate(self.corretor_linhas()):
            self.txt(M, ALT - 52 + i * 13, l, "AC-Bold" if i == 0 else "AC-Reg", 9, self.tinta if i == 0 else self.suave)
        self.txt(LARG - M, ALT - 40, datetime.now().strftime("%d/%m/%Y"), "AC-Semi", 8, self.suave, "d")
        self.proxima()

    def pagina_duas(self, lote: List[Dict[str, Any]]) -> None:
        cfg = self.cfg
        self.fundo_pagina()
        self._cabecalho()
        altura = (ALT - 56 - 40) / 2
        for i, im in enumerate(lote):
            topo = 56 + i * altura + 18
            fotos = (im.get("_fotos") or [])[: min(3, cfg["fotos_por_imovel"])]
            miniaturas = fotos[1:3]
            alt_foto = altura - 36 - (62 if miniaturas else 0)
            self.foto(fotos[0] if fotos else None, M, topo, 262, alt_foto)
            if miniaturas:
                lado = (262 - 6 * (len(miniaturas) - 1)) / len(miniaturas)
                for k, f in enumerate(miniaturas):
                    self.foto(f, M + k * (lado + 6), topo + alt_foto + 6, lado, 56)
            x = M + 262 + 26
            larg = LARG - M - x
            self.txt(x, topo + 30, im.get("codigo"), "AC-Black", 34, self.sec)
            principal, complemento = titulo_do_imovel(im)
            y = self.bloco(x, topo + 54, principal, larg, "AC-Bold", 11.5, 15, self.tinta, 3)
            y = self.bloco(x, y + 1, local_do_imovel(im), larg, "AC-Reg", 8.5, 12, self.suave, 1)
            y += 16
            valor, sufixo = self.preco_texto(im)
            if valor:
                self.txt(x, y + 6, sufixo.upper(), "AC-Bold", 6.5, self.suave, "e", 1.3)
                larg_rs = self.txt(x, y + 32, "R$", "AC-Bold", 9.5, self.suave)
                self.txt(x + larg_rs + 4, y + 32, valor, "AC-Black", 22, self.tinta)
            else:
                self.txt(x, y + 30, "Valor sob consulta", "AC-Bold", 12, self.tinta)
            y += 52
            for rotulo, v in linhas_de_dados(im, cfg["mostrar_custos"])[:7]:
                self.fio(x, y, x + larg)
                self.txt(x, y + 15, rotulo, "AC-Reg", 8.3, self.suave)
                self.txt(x + larg, y + 15, v, "AC-Bold", 9.3, self.tinta, "d")
                y += 22
            self.fio(x, y, x + larg)
            if cfg["mostrar_link"] and im.get("link"):
                self.link(x, topo + altura - 40, im["link"], self.sec, 7.5)
            if i == 0 and len(lote) > 1:
                self.fio(M, 56 + altura, LARG - M)
        self.pagina += 1
        self.txt(M, ALT - 24, (self.empresa.get("nome") or "")[:60], "AC-Med", 7, self.suave, "e", 0.3)
        self.txt(LARG - M, ALT - 24, f"{self.pagina:02d}", "AC-Semi", 9, self.tinta, "d")
        self.proxima()

    def contracapa(self) -> None:
        self.pintar(self.tinta, 0, 0, LARG, ALT)
        cor = HexColor("#f4f4f2")
        suave = _mistura(self.tinta, cor, 0.62)
        self.logo(M, M, 26, sobre_foto=True)
        y = 330
        if self.cfg.get("mensagem_final"):
            for linha in self.quebrar(self.cfg["mensagem_final"], "AC-Black", 27, LARG - 2 * M - 60)[:6]:
                self.txt(M, y, linha, "AC-Black", 27, cor)
                y += 31
        self.pintar(self.sec, M, y + 6, LARG - 2 * M, 3)
        yb = ALT - 150
        if self.cfg.get("mostrar_contato"):
            self.txt(M, yb, self.empresa.get("nome") or "", "AC-Bold", 10.5, cor)
            for i, l in enumerate(self.contato_linhas()):
                self.txt(M, yb + 18 + i * 15, l, "AC-Reg", 9, suave)
        for i, l in enumerate(self.corretor_linhas()):
            self.txt(LARG - M, yb + i * 15, l, "AC-Bold" if i == 0 else "AC-Reg", 9.5, cor if i == 0 else suave, "d")
        self.proxima()


def renderizar(
    config: Dict[str, Any], imoveis: List[Dict[str, Any]], empresa: Dict[str, Any],
    corretor: Optional[Dict[str, Any]] = None, titulo: Optional[str] = None,
) -> bytes:
    """Gera o PDF. Cada imóvel pode trazer `_fotos` (bytes JPEG/PNG, a principal primeiro)."""
    classe = {"classico": Editorial, "galeria": Vitrine, "compacto": Ficha}[config["layout"]]
    d = classe(config, empresa, corretor, titulo)
    if config["mostrar_capa"]:
        d.capa(imoveis)
    if config["layout"] == "compacto":
        for i in range(0, len(imoveis), 2):
            d.pagina_duas(imoveis[i:i + 2])
    else:
        for im in imoveis:
            d.pagina_imovel(im)
    if d.contracapa_base():
        d.contracapa()
    d.c.save()
    return d.buf.getvalue()
