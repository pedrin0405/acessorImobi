"""
Conteúdo dos atendimentos do Imoview para o Fluxo do portal (funções puras, sem banco).

A API de atendimentos devolve no mesmo item a origem, o perfil de interesse, o carrinho, as visitas, as propostas,
os negócios e as interações. O estágio no Fluxo é deduzido desse conteúdo, na ordem do funil de leads do CRM:
lead -> contato -> qualificado -> visita_agendada -> visita_realizada -> proposta -> negociacao. Negócio realizado
e descartado não são etapas: fecham o negócio (ganho/perdido).
"""
import html
import re
from typing import Any, Dict, List, Optional, Tuple

from app.domain.imovel.sync import inteiro, numero_br, sem_acento

ESTAGIOS = ("lead", "contato", "qualificado", "visita_agendada", "visita_realizada", "proposta", "negociacao")
# Nome da etapa do portal que recebe cada estágio (comparado sem acento e em minúsculas).
ETAPA_DO_ESTAGIO = {
    "lead": "lead", "contato": "contato feito", "qualificado": "qualificado", "visita_agendada": "visita agendada",
    "visita_realizada": "visita realizada", "proposta": "proposta", "negociacao": "negociacao",
}
ROTULO_ESTAGIO = {
    "lead": "Lead", "contato": "Contato feito", "qualificado": "Qualificado", "visita_agendada": "Visita agendada",
    "visita_realizada": "Visita realizada", "proposta": "Proposta", "negociacao": "Negociação",
}
MAX_INTERACOES = 40
MAX_IMOVEIS = 20
MAX_TEXTO = 600
_ROBO = ("inclusao do atendimento", "integracao midia")
_EXTRAS = {
    "areaprivativa": "Área privativa", "varanda": "Varanda", "areaservico": "Área de serviço", "boxbanheiro": "Box no banheiro",
    "interfone": "Interfone", "portaria24hrs": "Portaria 24h", "piscina": "Piscina", "playground": "Playground",
    "salaofestas": "Salão de festas", "quadratenis": "Quadra de tênis", "mobiliado": "Mobiliado",
    "armarioquarto": "Armário no quarto", "armariocozinha": "Armário na cozinha", "boxdespejo": "Box de despejo",
}


def _lista(valor: Any) -> List[Dict[str, Any]]:
    return [x for x in valor if isinstance(x, dict)] if isinstance(valor, list) else []


def _texto(valor: Any, limite: int = 200) -> Optional[str]:
    t = re.sub(r"\s+", " ", str(valor or "")).strip()
    return t[:limite] or None


def limpar_html(bruto: Any) -> str:
    """'<p>Cliente&nbsp;ligou</p>' -> 'Cliente ligou'."""
    sem_tags = re.sub(r"<[^>]+>", " ", str(bruto or ""))
    return re.sub(r"\s+", " ", html.unescape(sem_tags).replace("\xa0", " ")).strip()


def _so_robo(descricao: str) -> bool:
    d = sem_acento(descricao)
    return not d or any(d.startswith(p) for p in _ROBO)


def interacao_humana(i: Dict[str, Any]) -> bool:
    return not _so_robo(limpar_html(i.get("descricao"))) and "robo" not in sem_acento(i.get("usuario"))


def deduzir_estagio(bruto: Dict[str, Any]) -> str:
    """Estágio do atendimento no funil de leads, só pelo que o Imoview registrou."""
    propostas = _lista(bruto.get("imoveisproposta"))
    if _lista(bruto.get("imoveisnegocio")):
        return "negociacao"
    if propostas:
        ativas = [
            p for p in propostas
            if any("cancel" not in sem_acento(n.get("situacaonegociacao")) and "recus" not in sem_acento(n.get("situacaonegociacao"))
                   for n in _lista(p.get("negociacoes")))
        ]
        return "negociacao" if ativas else "proposta"
    visitas = _lista(bruto.get("imoveisvisita"))
    if any("realiz" in sem_acento(v.get("situacaovisita")) for v in visitas):
        return "visita_realizada"
    if visitas:
        return "visita_agendada"
    if _lista(bruto.get("imoveiscarrinho")) or bruto.get("leadqualificado") is True:
        return "qualificado"
    if bruto.get("datahora1Resposta") or any(interacao_humana(i) for i in _lista(bruto.get("interacoes"))):
        return "contato"
    return "lead"


def _imovel(im: Dict[str, Any]) -> Dict[str, Any]:
    foto = im.get("urlfotoprincipal")
    return {
        "codigo": inteiro(im.get("codigo")), "titulo": _texto(im.get("titulo"), 140), "tipo": _texto(im.get("tipo"), 40),
        "valor": _texto(im.get("valor"), 30), "bairro": _texto(im.get("bairro"), 60), "cidade": _texto(im.get("cidade"), 60),
        "quartos": inteiro(im.get("numeroquartos")) or 0, "vagas": inteiro(im.get("numerovagas")) or 0,
        "area": _texto(im.get("areaprincipal"), 20),
        "foto": foto if isinstance(foto, str) and foto.startswith("https://") else None,
    }


def _nomes(valor: Any) -> List[str]:
    return [n for n in (_texto(x.get("nome"), 60) for x in _lista(valor)) if n]


def _perfil(p: Any) -> Dict[str, Any]:
    p = p if isinstance(p, dict) else {}
    return {
        "tipos": _nomes(p.get("tiposimoveis")), "cidades": _nomes(p.get("cidades")), "bairros": _nomes(p.get("bairros")),
        "regioes": _nomes(p.get("regioes")),
        "quartos": inteiro(p.get("numeroquarto")) or 0, "banheiros": inteiro(p.get("numerobanheiro")) or 0,
        "suites": inteiro(p.get("numerosuite")) or 0, "vagas": inteiro(p.get("numerovaga")) or 0,
        "valor_de": numero_br(p.get("valorde")) or 0, "valor_ate": numero_br(p.get("valorate")) or 0,
        "area_de": numero_br(p.get("areainternade")) or 0, "area_ate": numero_br(p.get("areainternaate")) or 0,
        "financiamento": bool(p.get("aceitafinanciamento")), "permuta": bool(p.get("aceitapermuta")),
        "destinacao": _texto(p.get("destinacao"), 40),
        "extras": [rotulo for chave, rotulo in _EXTRAS.items() if p.get(chave) is True],
    }


def montar_detalhes(bruto: Dict[str, Any], data) -> Dict[str, Any]:
    """Versão enxuta e estável do atendimento para o portal. `data` converte 'dd/mm/aaaa hh:mm' em datetime."""
    iso = lambda v: (lambda d: d.isoformat() if d else None)(data(v))  # noqa: E731
    carrinho = [_imovel(i) for i in _lista(bruto.get("imoveiscarrinho"))[:MAX_IMOVEIS]]
    visitas = [
        {"codigo": inteiro(v.get("codigovisita")), "em": iso(v.get("datavisita")), "tipo": _texto(v.get("tipovisita"), 30),
         "situacao": _texto(v.get("situacaovisita"), 30), "parecer": _texto(v.get("parecer"), 40),
         "motivo": _texto(v.get("parecermotivo"), 120), "complemento": _texto(v.get("parecermotivocomplemento"), 300),
         "imovel": _imovel(v)}
        for v in _lista(bruto.get("imoveisvisita"))[:MAX_IMOVEIS]
    ]
    propostas = []
    for p in _lista(bruto.get("imoveisproposta"))[:MAX_IMOVEIS]:
        ultima = (_lista(p.get("negociacoes")) or [{}])[-1]
        propostas.append({
            "codigo": inteiro(p.get("codigoproposta")), "situacao": _texto(ultima.get("situacaonegociacao"), 40),
            "valor": numero_br(ultima.get("valorproposta")) or 0, "em": iso(ultima.get("datanegociacao")), "imovel": _imovel(p),
        })
    negocios = [
        {"codigo": inteiro(n.get("codigonegocio")), "situacao": _texto(n.get("situacaonegocio"), 40),
         "valor": numero_br(n.get("valornegocio")) or 0, "comissao": numero_br(n.get("valorcomissao")) or 0,
         "em": iso(n.get("datanegocio")), "imovel": _imovel(n)}
        for n in _lista(bruto.get("imoveisnegocio"))[:MAX_IMOVEIS]
    ]
    interacoes = []
    for i in _lista(bruto.get("interacoes")):
        descricao = limpar_html(i.get("descricao"))
        if descricao:
            interacoes.append({"em": iso(i.get("datahora")), "descricao": descricao[:MAX_TEXTO], "usuario": _texto(i.get("usuario"), 80)})
    interacoes.sort(key=lambda x: x["em"] or "", reverse=True)
    return {
        "perfil": _perfil(bruto.get("perfil")), "carrinho": carrinho, "visitas": visitas, "propostas": propostas,
        "negocios": negocios, "interacoes": interacoes[:MAX_INTERACOES],
    }


def valor_do_atendimento(detalhes: Dict[str, Any]) -> Tuple[Optional[float], Optional[str], Optional[float]]:
    """
    Valor do negócio vindo do CRM, do mais firme ao mais fraco: negócio fechado (valor e comissão), proposta ativa,
    imóvel da visita mais recente ou do carrinho e, por fim, o orçamento máximo do perfil. Devolve (valor, tipo, comissão).
    """
    negocios = [n for n in detalhes.get("negocios") or [] if (n.get("valor") or 0) > 0]
    if negocios:
        feitos = [n for n in negocios if "realiz" in sem_acento(n.get("situacao"))] or negocios
        comissao = sum(n.get("comissao") or 0 for n in feitos)
        return round(sum(n["valor"] for n in feitos), 2), "negocio", round(comissao, 2) if comissao else None
    ativas = [
        p for p in detalhes.get("propostas") or []
        if (p.get("valor") or 0) > 0 and not any(t in sem_acento(p.get("situacao")) for t in ("cancel", "recus", "reprov"))
    ]
    if ativas:
        return round(max(p["valor"] for p in ativas), 2), "proposta", None
    visitas = sorted(detalhes.get("visitas") or [], key=lambda v: v.get("em") or "", reverse=True)
    candidatos = [v.get("imovel") or {} for v in visitas] + list(detalhes.get("carrinho") or [])
    for im in candidatos:
        valor = numero_br(im.get("valor"))
        if valor and valor > 0:
            return round(valor, 2), "imovel", None
    orcamento = (detalhes.get("perfil") or {}).get("valor_ate") or 0
    if orcamento > 0:
        return round(float(orcamento), 2), "orcamento", None
    return None, None, None
