"""
Padrões e validação das configurações guardadas em `tenants.dados`.

Tudo aqui é função pura (sem banco), para ser testada e reaproveitada pelo
scheduler (lembretes) e pelo CRM (tipos de atividade, roleta).
"""
import re
import uuid
from typing import Any, Dict, List, Optional

LIMITE_ITENS = 100
LIMITE_NOME = 60
RE_COR = re.compile(r"^#[0-9a-fA-F]{6}$")


class ConfigErro(ValueError):
    """Dado inválido numa configuração; a mensagem vai direto para o usuário."""


# --- Listas (Campos & Opções) ------------------------------------------------

_PALETA = ("#65D072", "#4E80EE", "#CF416D", "#3B5BDB", "#D85140", "#E9A23B", "#ED782F", "#2F9E6B", "#6A57C8", "#8A9597")

LISTAS_PADRAO: Dict[str, Dict[str, Any]] = {
    "origem_lead": {
        "titulo": "Origem do lead",
        "descricao": "Canais por onde o lead chegou. O custo mensal alimenta CPL e ROI dos relatórios.",
        "custo": True,
        "itens": ["WhatsApp", "Site", "Instagram", "Facebook", "Google", "Indicação", "Portal ZAP", "Portal VivaReal", "Portal OLX", "Cadastro manual"],
    },
    "motivo_perda": {
        "titulo": "Motivos de perda",
        "descricao": "Por que um negócio foi perdido. Aparece ao marcar um negócio como perdido.",
        "custo": False,
        "itens": ["Preço acima do orçamento", "Fechou com outro corretor", "Desistiu da compra", "Sem retorno do cliente", "Financiamento negado", "Imóvel indisponível", "Outro"],
    },
    "etiqueta_conversa": {
        "titulo": "Etiquetas de conversa",
        "descricao": "Marcadores para organizar as conversas.",
        "custo": False,
        "itens": [],
    },
    "forma_pagamento": {
        "titulo": "Forma de pagamento",
        "descricao": "Como o cliente pretende pagar.",
        "custo": False,
        "itens": ["À vista", "Financiamento bancário", "FGTS", "Consórcio", "Permuta", "Parcelamento direto", "Carta de crédito"],
    },
    "tipo_imovel": {
        "titulo": "Tipos de imóvel",
        "descricao": "Os tipos que viram escolha em leads, negócios e perfis de busca.",
        "custo": False,
        "itens": ["Apartamento", "Casa", "Casa em condomínio", "Cobertura", "Terreno", "Sala comercial", "Galpão", "Chácara", "Kitnet"],
    },
    "portal": {
        "titulo": "Portais",
        "descricao": "Portais em que os imóveis são anunciados.",
        "custo": False,
        "itens": ["ZAP Imóveis", "VivaReal", "OLX"],
    },
}


def listas_padrao() -> Dict[str, List[Dict[str, Any]]]:
    saida: Dict[str, List[Dict[str, Any]]] = {}
    for chave, meta in LISTAS_PADRAO.items():
        itens = []
        for i, nome in enumerate(meta["itens"]):
            item: Dict[str, Any] = {"id": uuid.uuid4().hex[:12], "nome": nome, "cor": _PALETA[i % len(_PALETA)]}
            if meta["custo"]:
                item["custo_mensal"] = 0
            itens.append(item)
        saida[chave] = itens
    return saida


def validar_lista(chave: str, itens: Any) -> List[Dict[str, Any]]:
    """Normaliza uma lista: nomes únicos e curtos, cores válidas, custo só onde existe."""
    if chave not in LISTAS_PADRAO:
        raise ConfigErro("Lista desconhecida.")
    if not isinstance(itens, list):
        raise ConfigErro("A lista precisa ser uma sequência de opções.")
    if len(itens) > LIMITE_ITENS:
        raise ConfigErro(f"No máximo {LIMITE_ITENS} opções por lista.")
    com_custo = LISTAS_PADRAO[chave]["custo"]
    vistos = set()
    saida = []
    for i, bruto in enumerate(itens):
        nome = re.sub(r"\s+", " ", str((bruto or {}).get("nome") or "")).strip()
        if not nome:
            raise ConfigErro("Toda opção precisa de um nome.")
        if len(nome) > LIMITE_NOME:
            raise ConfigErro(f"O nome \"{nome[:20]}…\" passa de {LIMITE_NOME} caracteres.")
        if nome.lower() in vistos:
            raise ConfigErro(f"\"{nome}\" aparece duas vezes.")
        vistos.add(nome.lower())
        cor = (bruto or {}).get("cor") or _PALETA[i % len(_PALETA)]
        if not RE_COR.match(cor):
            raise ConfigErro(f"Cor inválida em \"{nome}\".")
        item: Dict[str, Any] = {"id": str((bruto or {}).get("id") or uuid.uuid4().hex[:12])[:32], "nome": nome, "cor": cor}
        if com_custo:
            try:
                custo = float((bruto or {}).get("custo_mensal") or 0)
            except (TypeError, ValueError):
                raise ConfigErro(f"Custo inválido em \"{nome}\".")
            if custo < 0 or custo > 10_000_000:
                raise ConfigErro(f"Custo inválido em \"{nome}\".")
            item["custo_mensal"] = round(custo, 2)
        saida.append(item)
    return saida


# --- Tipos de atividade ---------------------------------------------------------

ICONES_ATIVIDADE = ("calendar", "users", "phone", "clock", "message", "list", "mail", "file", "home", "key", "star", "flag")

TIPOS_SISTEMA: List[Dict[str, Any]] = [
    {"chave": "visita", "nome": "Visita", "icone": "calendar", "cor": "#E9A23B"},
    {"chave": "reuniao", "nome": "Reunião", "icone": "users", "cor": "#7B8FB5"},
    {"chave": "ligacao", "nome": "Ligação", "icone": "phone", "cor": "#4E80EE"},
    {"chave": "follow_up", "nome": "Follow-up", "icone": "clock", "cor": "#C58BD9"},
    {"chave": "whatsapp", "nome": "WhatsApp", "icone": "message", "cor": "#65D072"},
    {"chave": "tarefa", "nome": "Tarefa", "icone": "list", "cor": "#8A9597"},
    {"chave": "email", "nome": "E-mail", "icone": "mail", "cor": "#D88A5A"},
    {"chave": "documento", "nome": "Documento", "icone": "file", "cor": "#5FB3B3"},
]
CHAVES_SISTEMA = tuple(t["chave"] for t in TIPOS_SISTEMA)
RE_CHAVE_CUSTOM = re.compile(r"^custom_[0-9a-f]{8}$")


def tipos_atividade_padrao() -> List[Dict[str, Any]]:
    return [{**t, "visivel": True, "sistema": True} for t in TIPOS_SISTEMA]


def validar_tipos_atividade(itens: Any, existentes_em_uso: Optional[Dict[str, int]] = None) -> List[Dict[str, Any]]:
    """
    Os oito tipos de sistema nunca somem (o histórico aponta para eles): só mudam nome,
    ícone, cor, visibilidade e ordem. Tipos novos ganham a chave `custom_xxxxxxxx`.
    `existentes_em_uso` (chave -> atividades) impede apagar um tipo personalizado em uso.
    """
    if not isinstance(itens, list) or not itens:
        raise ConfigErro("Envie a lista de tipos.")
    if len(itens) > 40:
        raise ConfigErro("No máximo 40 tipos de atividade.")
    em_uso = existentes_em_uso or {}
    recebidos = {str((i or {}).get("chave") or ""): i for i in itens}
    for chave in CHAVES_SISTEMA:
        if chave not in recebidos:
            raise ConfigErro("Os tipos originais não podem ser removidos.")
    nomes = set()
    saida = []
    for bruto in itens:
        chave = str(bruto.get("chave") or "")
        sistema = chave in CHAVES_SISTEMA
        if not sistema:
            if not chave:
                chave = f"custom_{uuid.uuid4().hex[:8]}"
            elif not RE_CHAVE_CUSTOM.match(chave):
                raise ConfigErro("Chave de tipo inválida.")
        nome = re.sub(r"\s+", " ", str(bruto.get("nome") or "")).strip()
        if not nome or len(nome) > 40:
            raise ConfigErro("Cada tipo precisa de um nome de até 40 caracteres.")
        if nome.lower() in nomes:
            raise ConfigErro(f"\"{nome}\" aparece duas vezes.")
        nomes.add(nome.lower())
        cor = bruto.get("cor") or "#8A9597"
        if not RE_COR.match(cor):
            raise ConfigErro(f"Cor inválida em \"{nome}\".")
        icone = bruto.get("icone") or "list"
        if icone not in ICONES_ATIVIDADE:
            raise ConfigErro(f"Ícone inválido em \"{nome}\".")
        saida.append({"chave": chave, "nome": nome, "icone": icone, "cor": cor, "visivel": bool(bruto.get("visivel", True)), "sistema": sistema})
    # Tipo personalizado em uso não pode ser apagado (as atividades perderiam o rótulo).
    mantidas = {t["chave"] for t in saida}
    for chave, qtd in em_uso.items():
        if chave.startswith("custom_") and qtd and chave not in mantidas:
            raise ConfigErro("Há atividades usando um tipo que você tentou excluir. Esconda-o em vez de excluir.")
    return saida


# --- Roleta de leads --------------------------------------------------------------

ROLETA_PADRAO = {"ativa": False, "modo": "rodizio", "participantes": [], "ultimo": None}


def validar_roleta(dados: Any) -> Dict[str, Any]:
    d = dados or {}
    if d.get("modo", "rodizio") != "rodizio":
        raise ConfigErro("Modo de distribuição desconhecido.")
    participantes = d.get("participantes") or []
    if not isinstance(participantes, list) or len(participantes) > 200:
        raise ConfigErro("Lista de participantes inválida.")
    return {"ativa": bool(d.get("ativa")), "modo": "rodizio", "participantes": [str(p) for p in participantes], "ultimo": d.get("ultimo")}


def proximo_da_fila(elegiveis: List[str], ultimo: Optional[str]) -> Optional[str]:
    """Rodízio: o próximo depois de `ultimo` na ordem fixa dos elegíveis (ou o primeiro)."""
    if not elegiveis:
        return None
    ordem = sorted(elegiveis)
    if ultimo in ordem:
        return ordem[(ordem.index(ultimo) + 1) % len(ordem)]
    return ordem[0]


# --- Lembretes da agenda ------------------------------------------------------------

VARIAVEIS_LEMBRETE = ("corretor.primeiro_nome", "cliente", "titulo", "tipo", "tipo_minusculo", "data", "hora", "local")

MENSAGEM_PADRAO = "Oi, {{corretor.primeiro_nome}}! Lembrete: {{tipo_minusculo}} \"{{titulo}}\" em {{data}} às {{hora}}{{local_frase}}."


def lembretes_padrao() -> List[Dict[str, Any]]:
    return [
        {"id": "padrao-1h", "ligada": True, "nome": "Qualquer atividade — 1 hora antes", "tipo": "todos", "antecedencia_min": 60,
         "mensagem": MENSAGEM_PADRAO, "janela_inicio": "08:00", "janela_fim": "20:00"},
        {"id": "padrao-visita-1d", "ligada": False, "nome": "Visita — 1 dia antes", "tipo": "visita", "antecedencia_min": 1440,
         "mensagem": MENSAGEM_PADRAO, "janela_inicio": "08:00", "janela_fim": "20:00"},
        {"id": "padrao-reuniao-1d", "ligada": False, "nome": "Reunião — 1 dia antes", "tipo": "reuniao", "antecedencia_min": 1440,
         "mensagem": MENSAGEM_PADRAO, "janela_inicio": "08:00", "janela_fim": "20:00"},
    ]


def _hhmm(valor: Any, rotulo: str) -> str:
    texto = str(valor or "")
    if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", texto):
        raise ConfigErro(f"Horário inválido em {rotulo}. Use HH:MM.")
    return texto


def rotulo_antecedencia(minutos: int) -> str:
    if minutos % 1440 == 0:
        d = minutos // 1440
        return f"{d} dia antes" if d == 1 else f"{d} dias antes"
    if minutos % 60 == 0:
        h = minutos // 60
        return f"{h} hora antes" if h == 1 else f"{h} horas antes"
    return f"{minutos} minutos antes"


def validar_lembretes(regras: Any, tipos_validos: List[str]) -> List[Dict[str, Any]]:
    if not isinstance(regras, list):
        raise ConfigErro("Envie a lista de regras.")
    if len(regras) > 30:
        raise ConfigErro("No máximo 30 regras.")
    saida = []
    for bruto in regras:
        nome = re.sub(r"\s+", " ", str(bruto.get("nome") or "")).strip()
        if not nome or len(nome) > 80:
            raise ConfigErro("Cada regra precisa de um nome de até 80 caracteres.")
        tipo = str(bruto.get("tipo") or "todos")
        if tipo != "todos" and tipo not in tipos_validos:
            raise ConfigErro(f"Tipo de atividade inválido na regra \"{nome}\".")
        try:
            antecedencia = int(bruto.get("antecedencia_min"))
        except (TypeError, ValueError):
            raise ConfigErro(f"Antecedência inválida na regra \"{nome}\".")
        if not 5 <= antecedencia <= 60 * 24 * 14:
            raise ConfigErro(f"A antecedência da regra \"{nome}\" deve ficar entre 5 minutos e 14 dias.")
        mensagem = str(bruto.get("mensagem") or "").strip()
        if not mensagem or len(mensagem) > 600:
            raise ConfigErro(f"A mensagem da regra \"{nome}\" precisa ter de 1 a 600 caracteres.")
        for variavel in re.findall(r"\{\{\s*([^}]+?)\s*\}\}", mensagem):
            if variavel not in VARIAVEIS_LEMBRETE and variavel != "local_frase":
                raise ConfigErro(f"Variável desconhecida {{{{{variavel}}}}} na regra \"{nome}\".")
        ini = _hhmm(bruto.get("janela_inicio"), f"\"{nome}\"")
        fim = _hhmm(bruto.get("janela_fim"), f"\"{nome}\"")
        if ini >= fim:
            raise ConfigErro(f"Na regra \"{nome}\", o início da janela deve ser antes do fim.")
        saida.append({
            "id": str(bruto.get("id") or uuid.uuid4().hex[:12])[:32], "ligada": bool(bruto.get("ligada")), "nome": nome,
            "tipo": tipo, "antecedencia_min": antecedencia, "mensagem": mensagem, "janela_inicio": ini, "janela_fim": fim,
        })
    return saida


def renderizar_lembrete(regra: Dict[str, Any], valores: Dict[str, str]) -> str:
    """Troca as {{variáveis}}; variável sem valor some e `local_frase` só existe com local."""
    valores = dict(valores)
    valores["local_frase"] = f", em {valores['local']}" if valores.get("local") else ""

    def trocar(m: "re.Match[str]") -> str:
        return valores.get(m.group(1).strip(), "")

    texto = re.sub(r"\{\{\s*([^}]+?)\s*\}\}", trocar, regra["mensagem"])
    return re.sub(r"\s+([,.!?])", r"\1", re.sub(r"[ \t]{2,}", " ", texto)).strip()


def regra_do_lembrete(regras: List[Dict[str, Any]], tipo: str, antecedencia_min: int) -> Optional[Dict[str, Any]]:
    """Regra ligada que gerou o lembrete: a do tipo exato ganha da genérica ("todos")."""
    candidatas = [r for r in regras if r.get("ligada") and r.get("antecedencia_min") == antecedencia_min and r.get("tipo") in (tipo, "todos")]
    candidatas.sort(key=lambda r: r["tipo"] == "todos")
    return candidatas[0] if candidatas else None


def antecedencias_para(regras: List[Dict[str, Any]], tipo: str) -> List[int]:
    """Antecedências (min) das regras ligadas que valem para o tipo, da maior para a menor."""
    return sorted({r["antecedencia_min"] for r in regras if r.get("ligada") and r.get("tipo") in (tipo, "todos")}, reverse=True)


# --- Dados da imobiliária ------------------------------------------------------------

RE_UF = re.compile(r"^[A-Za-z]{2}$")
LOGO_MAX_BYTES = 400 * 1024
RE_DATA_URL = re.compile(r"^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$")


def validar_imagem(data_url: Optional[str]) -> Optional[str]:
    """Foto/logo guardada como data URL pequeno (o navegador reduz antes de enviar)."""
    if not data_url:
        return None
    if not RE_DATA_URL.match(data_url):
        raise ConfigErro("Imagem inválida. Use PNG, JPG ou WebP.")
    if len(data_url) * 3 // 4 > LOGO_MAX_BYTES:
        raise ConfigErro("A imagem passa de 400 KB. Use uma menor.")
    return data_url


def somente_digitos(texto: Any) -> str:
    return re.sub(r"\D", "", str(texto or ""))


def validar_documento(valor: Any, tipo_conta: str) -> str:
    """CNPJ (imobiliária) ou CPF (autônomo) só com dígitos; vazio é permitido."""
    digitos = somente_digitos(valor)
    if not digitos:
        return ""
    esperado = 14 if tipo_conta == "imobiliaria" else 11
    if len(digitos) != esperado:
        raise ConfigErro("CNPJ deve ter 14 dígitos." if esperado == 14 else "CPF deve ter 11 dígitos.")
    return digitos
