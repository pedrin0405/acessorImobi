"""
Configuração central da aplicação via pydantic-settings.
Lê variáveis de ambiente definidas no .env ou injetadas pelo Docker.
"""
from functools import lru_cache
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

    # Ollama
    ollama_base_url: str = "http://ollama:11434"
    ollama_default_model: str = "llama3.1:8b-instruct-q4_K_M"

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

    # Worker
    worker_concurrency: int = 8
    worker_max_per_tenant: int = 3
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
