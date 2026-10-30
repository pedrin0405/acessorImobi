"""
Configuração central da aplicação via pydantic-settings.
Lê variáveis de ambiente definidas no .env ou injetadas pelo Docker.
"""
from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Geral
    environment: str = "production"
    log_level: str = "info"
    base_domain: str = "acessorimobi.com.br"

    # Banco de dados
    database_url: str
    # Redis
    redis_url: str

    # MinIO
    minio_endpoint: str
    minio_access_key: str
    minio_secret_key: str
    minio_bucket_audios: str = "audios"
    minio_secure: bool = False

    # LLM: "gemini" (nuvem, principal) ou "ollama" (local)
    llm_provider: str = "ollama"

    # Ollama
    ollama_base_url: str = "http://ollama:11434"
    ollama_default_model: str = "qwen3:8b"
    ollama_timeout_seconds: int = 240

    # Gemini (chat + TTS)
    gemini_api_key: Optional[str] = None
    gemini_model: str = "gemini-flash-lite-latest"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    gemini_timeout_seconds: int = 60
    gemini_tts_model: str = "gemini-3.8-flash-tts"
    gemini_tts_fallback_model: Optional[str] = "gemini-3.8-flash-lite-tts"
    gemini_tts_voice: str = "Kore"
    gemini_tts_max_chars: int = 1800
    # Resposta em áudio: mirror (só quando o corretor manda áudio), always ou never
    voice_reply_mode: str = "mirror"
    # Em modo mirror, chance de responder em áudio também a mensagens de texto (0 a 1)
    voice_reply_audio_chance: float = 0.2

    # TTS: "auto" (Qwen3 local e, se falhar, Gemini), "qwen3" ou "gemini"
    tts_provider: str = "auto"
    # Servidor local do Qwen3-TTS (scripts/qwen3_tts_server.py) rodando no host.
    qwen3_tts_url: str = "http://host.docker.internal:8010"
    qwen3_tts_speaker: str = "Serena"
    qwen3_tts_language: str = "Portuguese"
    # Instrução de estilo (ritmo, emoção) enviada ao modelo.
    qwen3_tts_instruct: Optional[str] = None  # None = padrão de vozes.py; "" = sem instrução
    qwen3_tts_timeout_seconds: int = 300
    qwen3_tts_token: Optional[str] = None
    # Falas curtas: o modelo local gera ~5x mais devagar que o tempo real no M4.
    qwen3_tts_max_chars: int = 500

    # Consumo de APIs externas (painel do dev). 0 = sem limite configurado.
    # Use os valores do seu plano em https://aistudio.google.com/rate-limit
    gemini_chat_daily_limit: int = 200
    gemini_tts_daily_limit: int = 10
    gemini_chat_rpm_limit: int = 15
    gemini_tts_rpm_limit: int = 3
    # Percentual a partir do qual o painel sinaliza "perto do limite".
    usage_alert_percent: int = 80
    usage_timezone: str = "America/Sao_Paulo"

    # Whisper
    whisper_base_url: str = "http://whisper:9000"
    whisper_timeout_seconds: int = 180
    whisper_max_audio_seconds: int = 180  # 3 minutos

    # Evolution (WhatsApp gateway)
    evolution_base_url: str = "http://evolution:8080"
    evolution_api_key: str

    # Segurança
    secret_key: str                 # JWT signing
    encryption_key: str             # AES-256 para credenciais Imoview
    access_token_expire_minutes: int = 60 * 8  # 8 horas
    dev_panel_password: str = "admin123"      # Senha de acesso ao painel do desenvolvedor

    # Worker
    worker_concurrency: int = 8
    worker_max_per_tenant: int = 3
    # Assistente pessoal: minutos sem mensagem nova antes de analisar o atendimento
    assistente_analise_atraso_min: int = 5

    # Contexto da conversa
    context_window_messages: int = 12
    context_window_tokens: int = 2500

    # Cache TTLs (segundos)
    cache_imovel_ttl: int = 1800    # 30 min
    cache_cliente_ttl: int = 900    # 15 min
    cache_taxas_ttl: int = 3600     # 1h
    cache_noticias_ttl: int = 900   # 15 min

    # Imoview: máximo de resultados por consulta do agente
    imoview_max_results: int = 5
    imoview_sync_interval_minutes: int = 30

    # LGPD
    retencao_mensagens_dias: int = 180
    retencao_auditoria_dias: int = 365


@lru_cache
def get_settings() -> Settings:
    return Settings()
