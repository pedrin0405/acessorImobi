"""Testes do assistente pessoal: análise de atendimentos e textos ao corretor."""
from datetime import datetime, timezone
from uuid import UUID
from zoneinfo import ZoneInfo

from app.domain.atendimento.analise import montar_transcricao, texto_aviso, texto_resumo
from app.domain.whatsapp.corretor import config_assistente, instance_id_corretor

SP = ZoneInfo("America/Sao_Paulo")

ANALISE = {
    "imobiliario": True,
    "resumo": "Ana quer comprar um apartamento na Orla e perguntou sobre financiamento.",
    "perfil": {"interesse": ["comprar"], "tipos": ["apartamento"], "bairros": ["Orla"], "quartos_min": 2},
    "temperatura": "quente",
    "objecoes": ["valor do condomínio"],
    "alertas": ["prometeu enviar a planta"],
    "proximo_passo": "Mandar a planta e propor visita no sábado.",
    "sugestao_resposta": "Oi Ana! Te mando a planta agora. Sábado às 10h fica bom para a visita?",
}


def test_config_assistente_padrao_e_parcial():
    assert config_assistente(None) == {"ativo": True, "avisos": True, "carteira_auto": True}
    assert config_assistente({"avisos": False}) == {"ativo": True, "avisos": False, "carteira_auto": True}


def test_instance_id_corretor_estavel():
    cid = UUID("12345678-1234-5678-1234-567812345678")
    assert instance_id_corretor(cid) == "corretor_12345678123456781234"


def test_transcricao_marca_autor_audio_e_corta_inicio():
    agora = datetime(2026, 10, 30, 13, 0, tzinfo=timezone.utc)
    mensagens = [
        {"autor": "cliente", "tipo": "text", "conteudo": "Oi, vi o apê", "transcricao": None, "created_at": agora},
        {"autor": "corretor", "tipo": "text", "conteudo": "Oi! Qual?", "transcricao": None, "created_at": agora},
        {"autor": "cliente", "tipo": "audio", "conteudo": None, "transcricao": "o da Orla", "created_at": agora},
        {"autor": "cliente", "tipo": "audio", "conteudo": None, "transcricao": "", "created_at": agora},
    ]
    texto = montar_transcricao(mensagens, SP)
    assert texto.splitlines() == [
        "[30/10 10:00] Cliente: Oi, vi o apê",
        "[30/10 10:00] Corretor: Oi! Qual?",
        "[30/10 10:00] Cliente: [áudio] o da Orla",
        "[30/10 10:00] Cliente: [áudio sem transcrição]",
    ]
    longas = [{**mensagens[0], "conteudo": "x" * 500} for _ in range(40)]
    assert len(montar_transcricao(longas, SP)) <= 9000


def test_aviso_ao_corretor_traz_sugestao_para_copiar():
    texto = texto_aviso("Ana", ANALISE, minutos=12, n_matches=3)
    assert texto.startswith("💬 *Ana* está esperando sua resposta (há 12 min).")
    assert "🎯 Procura: compra · apartamento · 2+ quartos · Orla" in texto
    assert "⚠️ prometeu enviar a planta" in texto
    assert "💡 Sugestão de resposta (é só copiar):\nOi Ana!" in texto
    assert "🏠 3 imóveis da carteira combinam" in texto
    assert "(há 3 h)" in texto_aviso("Ana", ANALISE, minutos=190, n_matches=0)


def test_resumo_de_conversa_nao_imobiliaria():
    assert "não parece ser um atendimento imobiliário" in texto_resumo("Mãe", {"imobiliario": False}, False)


def test_resumo_completo():
    texto = texto_resumo("Ana", ANALISE, aguardando=True)
    assert texto.startswith("📋 *Ana* — esperando sua resposta")
    for trecho in ("Objeções: valor do condomínio", "Pendências: prometeu enviar a planta",
                   "Temperatura: quente", "Próximo passo: Mandar a planta"):
        assert trecho in texto


def test_numero_confere_aceita_jid_sem_nono_digito():
    from app.domain.whatsapp.corretor import numero_confere

    assert numero_confere("5563992185349", "+5563992185349")
    assert numero_confere("556392185349", "+5563992185349")  # JID antigo, sem o 9
    assert not numero_confere("5563991110000", "+5563992185349")
    assert not numero_confere("abc", "+5563992185349")
