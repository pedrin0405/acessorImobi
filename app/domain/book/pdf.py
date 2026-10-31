"""
Desenho do book em PDF (reportlab). Sem acesso a rede nem banco: recebe imóveis, fotos já baixadas e os
dados da imobiliária, e devolve os bytes do arquivo. Três layouts: classico, galeria e compacto.
"""
import io
from datetime import datetime
from typing import Any, Dict, List, Optional

from PIL import Image
from reportlab.lib.colors import Color, HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfgen import canvas

LARG, ALT = A4
MARGEM = 36
FONTES = {"moderna": ("Helvetica", "Helvetica-Bold"), "classica": ("Times-Roman", "Times-Bold")}
RODAPE_ALT = 34


def _t(valor: Any) -> str:
    """Texto seguro para as fontes padrão do PDF (Latin-1/cp1252): o que não cabe vira '?'."""
    return str(valor or "").encode("cp1252", "replace").decode("cp1252")


def reais(valor: Any) -> str:
    try:
        n = float(valor)
    except (TypeError, ValueError):
        return ""
    return "R$ " + f"{n:,.0f}".replace(",", ".") if n else ""


def _recortar(dados: bytes, largura: float, altura: float) -> Optional[io.BytesIO]:
    """Corta a foto para a proporção da caixa (como 'cover' do CSS) e a reduz a ~170 dpi."""
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
    saida = io.BytesIO()
    img.save(saida, "JPEG", quality=82)
    saida.seek(0)
    return saida


class _Desenho:
    def __init__(self, config: Dict[str, Any], empresa: Dict[str, Any], corretor: Optional[Dict[str, Any]]):
        self.cfg, self.empresa, self.corretor = config, empresa, corretor
        self.buf = io.BytesIO()
        self.c = canvas.Canvas(self.buf, pagesize=A4)
        self.c.setTitle(_t(f"{config.get('titulo_capa') or 'Book de imóveis'}"))
        self.c.setAuthor(_t(empresa.get("nome") or ""))
        self.pri, self.sec = HexColor(config["cor_primaria"]), HexColor(config["cor_secundaria"])
        self.f, self.fb = FONTES[config["fonte"]]
        self.pagina = 0

    # --- Primitivas ----------------------------------------------------------
    def foto(self, dados: Optional[bytes], x: float, y: float, w: float, h: float) -> None:
        recorte = _recortar(dados, w, h) if dados else None
        if recorte:
            self.c.drawImage(ImageReader(recorte), x, y, w, h)
        else:
            self.c.setFillColor(Color(self.pri.red, self.pri.green, self.pri.blue, alpha=0.12))
            self.c.rect(x, y, w, h, stroke=0, fill=1)
            self.c.setFillColor(Color(0.45, 0.45, 0.45))
            self.c.setFont(self.f, 9)
            self.c.drawCentredString(x + w / 2, y + h / 2 - 3, "Sem foto")

    def texto(self, x: float, y: float, s: Any, tam: float = 10, negrito: bool = False, cor=None, alinhar: str = "e") -> None:
        self.c.setFillColor(cor or HexColor("#1f2933"))
        self.c.setFont(self.fb if negrito else self.f, tam)
        s = _t(s)
        {"e": self.c.drawString, "c": self.c.drawCentredString, "d": self.c.drawRightString}[alinhar](x, y, s)

    def paragrafo(self, x: float, y: float, s: Any, largura: float, tam: float = 10, max_linhas: int = 99, cor=None, espaco: float = 1.35, negrito: bool = False) -> float:
        """Escreve com quebra de linha a partir de y (topo) e devolve o y logo abaixo."""
        fonte = self.fb if negrito else self.f
        linhas = simpleSplit(_t(s), fonte, tam, largura)
        if len(linhas) > max_linhas:
            linhas = linhas[:max_linhas]
            linhas[-1] = linhas[-1].rstrip(" .,;") + "…".encode("cp1252").decode("cp1252")
        for linha in linhas:
            y -= tam * espaco
            self.texto(x, y, linha, tam, negrito, cor)
        return y

    def chip(self, x: float, y: float, rotulo: str, valor: str) -> float:
        """Caixinha 'valor + rótulo'; devolve a largura usada."""
        w = max(58, self.c.stringWidth(_t(valor), self.fb, 13) + 20, self.c.stringWidth(_t(rotulo), self.f, 7.5) + 16)
        self.c.setFillColor(Color(self.pri.red, self.pri.green, self.pri.blue, alpha=0.08))
        self.c.roundRect(x, y, w, 36, 6, stroke=0, fill=1)
        self.texto(x + w / 2, y + 20, valor, 13, True, self.pri, "c")
        self.texto(x + w / 2, y + 8, rotulo, 7.5, False, HexColor("#52606d"), "c")
        return w + 6

    def rodape(self, link: Optional[str] = None) -> None:
        self.pagina += 1
        self.c.setStrokeColor(HexColor("#d9dee3"))
        self.c.line(MARGEM, RODAPE_ALT, LARG - MARGEM, RODAPE_ALT)
        esquerda = self.cfg.get("rodape") or (self.empresa.get("nome") or "")
        self.texto(MARGEM, 20, esquerda[:90], 8, False, HexColor("#52606d"))
        self.texto(LARG - MARGEM, 20, f"{self.pagina}", 8, False, HexColor("#52606d"), "d")

    def proxima(self) -> None:
        self.c.showPage()

    def logo(self, x: float, y: float, w: float, h: float, claro: bool = False) -> None:
        dados = self.empresa.get("logo")
        if self.cfg.get("mostrar_logo") and dados:
            try:
                img = Image.open(io.BytesIO(dados)).convert("RGBA")
                fundo = Image.new("RGBA", img.size, (255, 255, 255, 255) if not claro else (0, 0, 0, 0))
                fundo.alpha_composite(img)
                saida = io.BytesIO()
                (fundo.convert("RGB") if not claro else img).save(saida, "PNG")
                saida.seek(0)
                self.c.drawImage(ImageReader(saida), x, y, w, h, preserveAspectRatio=True, anchor="sw", mask="auto")
                return
            except Exception:  # noqa: BLE001
                pass
        if self.cfg.get("mostrar_logo") and self.empresa.get("nome"):
            self.texto(x, y + h / 2 - 5, self.empresa["nome"][:34], 13, True, white if claro else self.pri)

    # --- Capa e contracapa -----------------------------------------------------
    def capa(self, imoveis: List[Dict[str, Any]], titulo: Optional[str]) -> None:
        c = self.c
        c.setFillColor(self.pri)
        c.rect(0, 0, LARG, ALT, stroke=0, fill=1)
        hero = (imoveis[0].get("_fotos") or [None])[0] if imoveis else None
        if hero:
            self.foto(hero, 0, ALT * 0.42, LARG, ALT * 0.58)
            c.setFillColor(Color(self.pri.red, self.pri.green, self.pri.blue, alpha=0.35))
            c.rect(0, ALT * 0.42, LARG, ALT * 0.58, stroke=0, fill=1)
        c.setFillColor(self.sec)
        c.rect(MARGEM, ALT * 0.42 - 5, 90, 5, stroke=0, fill=1)
        self.logo(MARGEM, ALT - 90, 170, 54, claro=True)
        y = ALT * 0.42 - 50
        for linha in simpleSplit(_t(titulo or self.cfg.get("titulo_capa") or "Seleção de imóveis"), self.fb, 34, LARG - 2 * MARGEM)[:3]:
            self.texto(MARGEM, y, linha, 34, True, white)
            y -= 40
        if self.cfg.get("subtitulo_capa"):
            y = self.paragrafo(MARGEM, y + 14, self.cfg["subtitulo_capa"], LARG - 2 * MARGEM, 14, 2, Color(1, 1, 1, alpha=0.85))
        n = len(imoveis)
        self.texto(MARGEM, 96, f"{n} {'imóvel' if n == 1 else 'imóveis'} selecionado{'' if n == 1 else 's'}", 12, True, self.sec)
        self.texto(MARGEM, 78, datetime.now().strftime("%d/%m/%Y"), 10, False, Color(1, 1, 1, alpha=0.8))
        if self.cfg.get("mostrar_corretor") and self.corretor and self.corretor.get("nome"):
            self.texto(LARG - MARGEM, 96, self.corretor["nome"], 12, True, white, "d")
            if self.corretor.get("telefone"):
                self.texto(LARG - MARGEM, 78, self.corretor["telefone"], 10, False, Color(1, 1, 1, alpha=0.85), "d")
        self.proxima()

    def contracapa(self) -> None:
        c = self.c
        c.setFillColor(self.pri)
        c.rect(0, 0, LARG, ALT, stroke=0, fill=1)
        c.setFillColor(self.sec)
        c.rect(LARG / 2 - 30, ALT * 0.62, 60, 4, stroke=0, fill=1)
        self.logo(LARG / 2 - 100, ALT * 0.68, 200, 60, claro=True)
        y = ALT * 0.58
        if self.cfg.get("mensagem_final"):
            for linha in simpleSplit(_t(self.cfg["mensagem_final"]), self.f, 15, LARG - 150):
                self.texto(LARG / 2, y, linha, 15, False, white, "c")
                y -= 22
        y -= 18
        if self.cfg.get("mostrar_contato"):
            e = self.empresa
            for linha in (e.get("nome"), e.get("telefone"), e.get("email"), e.get("site"), f"CRECI {e['creci']}" if e.get("creci") else None):
                if linha:
                    self.texto(LARG / 2, y, linha, 11, linha == e.get("nome"), self.sec if linha == e.get("nome") else white, "c")
                    y -= 17
        if self.cfg.get("mostrar_corretor") and self.corretor and self.corretor.get("nome"):
            y -= 10
            self.texto(LARG / 2, y, f"Seu corretor: {self.corretor['nome']}" + (f" · {self.corretor['telefone']}" if self.corretor.get("telefone") else ""), 11, True, white, "c")
        self.proxima()

    # --- Peças comuns de um imóvel -------------------------------------------
    @staticmethod
    def titulo_imovel(im: Dict[str, Any]) -> str:
        return im.get("titulo") or f"{im.get('tipo') or 'Imóvel'} em {im.get('bairro') or 'local não informado'}"

    @staticmethod
    def local(im: Dict[str, Any]) -> str:
        return " · ".join(p for p in (im.get("bairro"), im.get("cidade"), im.get("estado")) if p)

    def preco(self, im: Dict[str, Any]) -> str:
        v = reais(im.get("valor"))
        if not v:
            return "Valor sob consulta"
        return v + (" /mês" if im.get("finalidade") == "aluguel" else "")

    def fichas(self, x: float, y: float, im: Dict[str, Any]) -> None:
        itens = [("Quartos", im.get("quartos")), ("Suítes", im.get("suites")), ("Banheiros", im.get("banheiros")), ("Vagas", im.get("vagas")),
                 ("Área", f"{float(im['area_m2']):.0f} m²" if im.get("area_m2") else None)]
        for rotulo, valor in itens:
            if valor:
                x += self.chip(x, y, rotulo, str(valor))

    def custos(self, im: Dict[str, Any]) -> str:
        partes = []
        if im.get("valor_condominio"):
            partes.append(f"Condomínio {reais(im['valor_condominio'])}")
        if im.get("valor_iptu"):
            partes.append(f"IPTU {reais(im['valor_iptu'])}")
        if im.get("aceita_financiamento"):
            partes.append("Aceita financiamento")
        return "  ·  ".join(partes)

    def endereco(self, im: Dict[str, Any]) -> str:
        e = im.get("endereco") or {}
        if not isinstance(e, dict):
            return ""
        rua = " ".join(str(p) for p in (e.get("logradouro") or e.get("endereco"), e.get("numero")) if p)
        return ", ".join(p for p in (rua, e.get("bairro") or im.get("bairro"), e.get("cidade") or im.get("cidade")) if p)

    def lista_fotos(self, im: Dict[str, Any], n: int) -> List[bytes]:
        return (im.get("_fotos") or [])[:n]

    # --- Layouts ---------------------------------------------------------------
    def pagina_classica(self, im: Dict[str, Any]) -> None:
        c, cfg = self.c, self.cfg
        c.setFillColor(self.pri)
        c.rect(0, ALT - 34, LARG, 34, stroke=0, fill=1)
        self.texto(MARGEM, ALT - 22, f"{(im.get('finalidade') or '').upper()}  ·  CÓD. {im.get('codigo')}", 10, True, white)
        self.texto(LARG - MARGEM, ALT - 22, (im.get("tipo") or "").upper(), 10, False, self.sec, "d")
        fotos = self.lista_fotos(im, cfg["fotos_por_imovel"])
        larg = LARG - 2 * MARGEM
        topo = ALT - 34 - 14
        alt_hero = 268
        self.foto(fotos[0] if fotos else None, MARGEM, topo - alt_hero, larg, alt_hero)
        y = topo - alt_hero - 26
        for linha in simpleSplit(_t(self.titulo_imovel(im)), self.fb, 18, larg)[:2]:
            self.texto(MARGEM, y, linha, 18, True)
            y -= 22
        self.texto(MARGEM, y, self.local(im), 10, False, HexColor("#52606d"))
        self.texto(LARG - MARGEM, y + 2, self.preco(im), 17, True, self.sec if False else self.pri, "d")
        y -= 14
        c.setFillColor(self.sec)
        c.rect(MARGEM, y, 54, 3, stroke=0, fill=1)
        y -= 48
        self.fichas(MARGEM, y, im)
        y -= 10
        if cfg["mostrar_custos"] and self.custos(im):
            self.texto(MARGEM, y, self.custos(im), 9.5, False, HexColor("#3e4c59"))
            y -= 15
        if cfg["mostrar_endereco"] and self.endereco(im):
            self.texto(MARGEM, y, "Endereço: " + self.endereco(im)[:95], 9.5, False, HexColor("#3e4c59"))
            y -= 15
        extras = fotos[1:]
        linhas_extras = -(-len(extras) // 3)
        reservado = linhas_extras * 96 + (10 if extras else 0) + RODAPE_ALT + (16 if cfg["mostrar_link"] and im.get("link") else 0)
        y -= 6
        if cfg["mostrar_descricao"] and im.get("descricao"):
            livre = int((y - reservado - 18) // 13.5)
            if livre >= 2:
                y = self.paragrafo(MARGEM, y, " ".join(str(im["descricao"]).split()), larg, 10, livre - (2 if cfg["mostrar_caracteristicas"] and (im.get("caracteristicas") or im.get("extras")) else 0))
                y -= 4
        itens = (im.get("caracteristicas") or []) + (im.get("extras") or [])
        if cfg["mostrar_caracteristicas"] and itens and y - reservado > 30:
            y = self.paragrafo(MARGEM, y - 4, "Características: " + ", ".join(str(i) for i in itens[:14]), larg, 9, max(1, int((y - reservado - 4) // 12.5)), HexColor("#3e4c59"))
        # Fotos extras ancoradas embaixo
        if extras:
            lado = (larg - 2 * 8) / 3
            for i, f in enumerate(extras[:6]):
                col, lin = i % 3, i // 3
                self.foto(f, MARGEM + col * (lado + 8), RODAPE_ALT + (16 if cfg["mostrar_link"] and im.get("link") else 0) + 8 + (linhas_extras - 1 - lin) * 96, lado, 88)
        if cfg["mostrar_link"] and im.get("link"):
            self.texto(MARGEM, RODAPE_ALT + 6, "Mais fotos e detalhes: " + str(im["link"])[:90], 8.5, False, self.pri)
        self.rodape()
        self.proxima()

    def pagina_galeria(self, im: Dict[str, Any]) -> None:
        c, cfg = self.c, self.cfg
        fotos = self.lista_fotos(im, cfg["fotos_por_imovel"])
        alt_hero = 400
        self.foto(fotos[0] if fotos else None, 0, ALT - alt_hero, LARG, alt_hero)
        c.setFillColor(Color(self.pri.red, self.pri.green, self.pri.blue, alpha=0.88))
        c.rect(0, ALT - alt_hero, LARG, 74, stroke=0, fill=1)
        for i, linha in enumerate(simpleSplit(_t(self.titulo_imovel(im)), self.fb, 17, LARG - 190)[:2]):
            self.texto(MARGEM, ALT - alt_hero + 48 - i * 20, linha, 17, True, white)
        self.texto(MARGEM, ALT - alt_hero + 10, f"{self.local(im)}  ·  CÓD. {im.get('codigo')}", 9.5, False, Color(1, 1, 1, alpha=0.85))
        self.texto(LARG - MARGEM, ALT - alt_hero + 36, self.preco(im), 18, True, self.sec, "d")
        larg = LARG - 2 * MARGEM
        y = ALT - alt_hero - 52
        self.fichas(MARGEM, y, im)
        y -= 14
        if cfg["mostrar_custos"] and self.custos(im):
            self.texto(MARGEM, y, self.custos(im), 9.5, False, HexColor("#3e4c59"))
            y -= 14
        extras = fotos[1:]
        if extras:
            colunas = 2 if len(extras) <= 4 else 3
            lado = (larg - (colunas - 1) * 8) / colunas
            alt_cel = 118 if colunas == 3 else 150
            linhas = -(-len(extras) // colunas)
            for i, f in enumerate(extras[:6]):
                col, lin = i % colunas, i // colunas
                self.foto(f, MARGEM + col * (lado + 8), RODAPE_ALT + 24 + (linhas - 1 - lin) * (alt_cel + 8), lado, alt_cel)
        if cfg["mostrar_link"] and im.get("link"):
            self.texto(MARGEM, RODAPE_ALT + 8, "Mais fotos e detalhes: " + str(im["link"])[:90], 8.5, False, self.pri)
        self.rodape()
        self.proxima()

    def paginas_compactas(self, lote: List[Dict[str, Any]]) -> None:
        c, cfg = self.c, self.cfg
        c.setFillColor(self.pri)
        c.rect(0, ALT - 30, LARG, 30, stroke=0, fill=1)
        self.logo(MARGEM, ALT - 26, 110, 22, claro=True)
        self.texto(LARG - MARGEM, ALT - 20, (cfg.get("titulo_capa") or "")[:50], 9.5, True, self.sec, "d")
        altura = (ALT - 30 - RODAPE_ALT) / 2
        for i, im in enumerate(lote):
            topo = ALT - 30 - i * altura
            x0, larg_foto = MARGEM, 224
            self.foto((im.get("_fotos") or [None])[0], x0, topo - altura + 22, larg_foto, altura - 44)
            x = x0 + larg_foto + 18
            largura_t = LARG - MARGEM - x
            y = topo - 36
            for linha in simpleSplit(_t(self.titulo_imovel(im)), self.fb, 13, largura_t)[:3]:
                self.texto(x, y, linha, 13, True)
                y -= 16
            self.texto(x, y, self.local(im)[:46], 9, False, HexColor("#52606d"))
            y -= 24
            self.texto(x, y, self.preco(im), 16, True, self.pri)
            y -= 20
            ficha = [f"{im['quartos']} quartos" if im.get("quartos") else None, f"{im['suites']} suítes" if im.get("suites") else None,
                     f"{im['banheiros']} banheiros" if im.get("banheiros") else None, f"{im['vagas']} vagas" if im.get("vagas") else None,
                     f"{float(im['area_m2']):.0f} m²" if im.get("area_m2") else None]
            for item in [f for f in ficha if f]:
                self.texto(x, y, "•  " + item, 10)
                y -= 14
            if cfg["mostrar_custos"] and self.custos(im):
                y = self.paragrafo(x, y - 2, self.custos(im), largura_t, 8.5, 2, HexColor("#3e4c59"))
            self.texto(x, topo - altura + 28, f"Cód. {im.get('codigo')}", 9, True, self.sec)
            if cfg["mostrar_link"] and im.get("link"):
                self.texto(x, topo - altura + 14, str(im["link"])[:60], 7.5, False, self.pri)
            if i == 0 and len(lote) > 1:
                c.setStrokeColor(HexColor("#d9dee3"))
                c.line(MARGEM, topo - altura, LARG - MARGEM, topo - altura)
        self.rodape()
        self.proxima()


def renderizar(
    config: Dict[str, Any], imoveis: List[Dict[str, Any]], empresa: Dict[str, Any],
    corretor: Optional[Dict[str, Any]] = None, titulo: Optional[str] = None,
) -> bytes:
    """Gera o PDF. Cada imóvel pode trazer `_fotos` (bytes JPEG/PNG, a principal primeiro)."""
    d = _Desenho(config, empresa, corretor)
    if config["mostrar_capa"]:
        d.capa(imoveis, titulo)
    if config["layout"] == "compacto":
        for i in range(0, len(imoveis), 2):
            d.paginas_compactas(imoveis[i:i + 2])
    else:
        for im in imoveis:
            (d.pagina_galeria if config["layout"] == "galeria" else d.pagina_classica)(im)
    if config["mostrar_capa"] or config["mostrar_contato"] or config["mensagem_final"]:
        d.contracapa()
    d.c.save()
    return d.buf.getvalue()
