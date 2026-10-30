"""
Tom de voz configurável do agente e filtro de palavras proibidas.

Cada tom traz a instrução que vai para o prompt e uma frase de exemplo,
mostrada como prévia no portal da imobiliária.
"""
import re
from typing import Dict, List

TONS: Dict[str, Dict[str, str]] = {
    "consultivo": {
        "rotulo": "Consultivo",
        "instrucao": (
            "Tom consultivo: explique o porquê das sugestões, faça uma pergunta de cada vez "
            "para entender a necessidade e recomende com segurança, sem pressionar."
        ),
        "exemplo": "Separei duas opções que batem com o que você me contou. Quer que eu compare as duas?",
    },
    "alto_padrao": {
        "rotulo": "Alto padrão",
        "instrucao": (
            "Tom de alto padrão: elegante, discreto e preciso. Valorize exclusividade e detalhes "
            "do imóvel, sem gírias e sem exagero de emojis."
        ),
        "exemplo": "Há uma unidade exclusiva, com vista permanente, que acredito estar à altura do que procura.",
    },
    "popular": {
        "rotulo": "Popular / acessível",
        "instrucao": (
            "Tom popular e acessível: palavras simples, foco em parcela, financiamento e "
            "condições; seja direto e acolhedor."
        ),
        "exemplo": "Achei uma opção que cabe no bolso, dá pra usar o FGTS. Te mando os detalhes?",
    },
    "amigavel": {
        "rotulo": "Amigável / próximo",
        "instrucao": (
            "Tom amigável e próximo: leve, caloroso, como um colega de confiança; "
            "pode brincar quando o corretor brincar."
        ),
        "exemplo": "Opa, achei umas que você vai curtir! Bora ver?",
    },
    "formal": {
        "rotulo": "Formal",
        "instrucao": (
            "Tom formal: trate com cordialidade e linguagem cuidada, sem gírias e sem emojis."
        ),
        "exemplo": "Localizei duas opções compatíveis com o perfil informado. Posso encaminhar os detalhes?",
    },
}

MAX_NOTA_MARCA = 1000
MAX_MEMORIA = 800
MAX_MEMORIAS = 50


def remover_palavras_proibidas(texto: str, palavras: List[str]) -> str:
    """Tira da resposta as palavras proibidas (inteiras, sem diferenciar maiúsculas)."""
    for palavra in palavras or []:
        palavra = (palavra or "").strip()
        if not palavra:
            continue
        texto = re.sub(rf"(?<!\w){re.escape(palavra)}(?!\w)", "", texto, flags=re.IGNORECASE)
    # Limpa espaços e pontuação órfã deixados pela remoção.
    texto = re.sub(r"[ \t]{2,}", " ", texto)
    texto = re.sub(r" +([,.!?;:])", r"\1", texto)
    return texto.strip()
