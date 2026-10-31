"""Configuração dos modelos de book: padrões, validação e os modelos de fábrica."""
import re
from typing import Any, Dict, List

LAYOUTS = [
    {"id": "classico", "nome": "Editorial", "descricao": "Revista de arquitetura: foto de abertura, título em serifa sobre a imagem, tabela de dados e texto em duas colunas."},
    {"id": "galeria", "nome": "Vitrine", "descricao": "Cinema: fundo escuro, fotos de sangria total com título e valor sobre a imagem e mosaico de fotos."},
    {"id": "compacto", "nome": "Ficha", "descricao": "Folha técnica: índice da seleção e dois imóveis por página, com os dados em tabela."},
]
LAYOUT_IDS = {l["id"] for l in LAYOUTS}
FONTES = ("moderna", "classica")
RE_COR = re.compile(r"^#[0-9a-fA-F]{6}$")

PADRAO: Dict[str, Any] = {
    "layout": "classico", "cor_primaria": "#1f3a2e", "cor_secundaria": "#b4532a", "fonte": "classica",
    "mostrar_capa": True, "titulo_capa": "Seleção de imóveis", "subtitulo_capa": "Preparada especialmente para você",
    "mostrar_logo": True, "fotos_por_imovel": 4,
    "mostrar_descricao": True, "mostrar_caracteristicas": True, "mostrar_custos": True, "mostrar_endereco": True,
    "mostrar_link": True, "mostrar_contato": True, "mostrar_corretor": True,
    "rodape": "", "mensagem_final": "Ficou com alguma dúvida? Fale com a gente, será um prazer ajudar.",
}
_BOOLS = [k for k, v in PADRAO.items() if isinstance(v, bool)]
_TEXTOS = {"titulo_capa": 80, "subtitulo_capa": 120, "rodape": 160, "mensagem_final": 300}

FABRICA: List[Dict[str, Any]] = [
    {"nome": "Editorial", "padrao": True, "config": {}},
    {"nome": "Vitrine", "padrao": False, "config": {
        "layout": "galeria", "cor_primaria": "#0f1115", "cor_secundaria": "#e8b04a", "fonte": "moderna", "fotos_por_imovel": 6,
        "mostrar_capa": True, "mostrar_descricao": True, "mostrar_caracteristicas": False}},
    {"nome": "Ficha", "padrao": False, "config": {
        "layout": "compacto", "cor_primaria": "#14213d", "cor_secundaria": "#ff5a36", "fonte": "moderna", "fotos_por_imovel": 3,
        "mostrar_capa": True, "mostrar_descricao": False, "mostrar_caracteristicas": False}},
]


class ConfigErro(ValueError):
    pass


def normalizar(bruto: Any, base: Dict[str, Any] = PADRAO) -> Dict[str, Any]:
    """Config completa e válida a partir de um dict parcial (chaves desconhecidas somem; valores ruins levantam ConfigErro)."""
    bruto = bruto if isinstance(bruto, dict) else {}
    saida = dict(base)
    if "layout" in bruto:
        if bruto["layout"] not in LAYOUT_IDS:
            raise ConfigErro("Layout inválido.")
        saida["layout"] = bruto["layout"]
    if "fonte" in bruto:
        if bruto["fonte"] not in FONTES:
            raise ConfigErro("Fonte inválida.")
        saida["fonte"] = bruto["fonte"]
    for cor in ("cor_primaria", "cor_secundaria"):
        if cor in bruto:
            if not isinstance(bruto[cor], str) or not RE_COR.match(bruto[cor]):
                raise ConfigErro("Cor inválida. Use o formato #rrggbb.")
            saida[cor] = bruto[cor].lower()
    if "fotos_por_imovel" in bruto:
        try:
            n = int(bruto["fotos_por_imovel"])
        except (TypeError, ValueError):
            raise ConfigErro("Fotos por imóvel deve ser um número de 1 a 6.")
        if not 1 <= n <= 6:
            raise ConfigErro("Fotos por imóvel deve ser de 1 a 6.")
        saida["fotos_por_imovel"] = n
    for chave in _BOOLS:
        if chave in bruto:
            saida[chave] = bool(bruto[chave])
    for chave, limite in _TEXTOS.items():
        if chave in bruto:
            texto = re.sub(r"\s+", " ", str(bruto[chave] or "")).strip()
            if len(texto) > limite:
                raise ConfigErro(f"Texto longo demais (máximo {limite} caracteres).")
            saida[chave] = texto
    return saida
