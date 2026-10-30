-- =============================================================================
-- acessorImobi — Inicialização do banco de dados
-- Executa uma única vez na criação do container postgres
-- =============================================================================

-- Extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Banco separado para o Evolution API (idempotente)
SELECT 'CREATE DATABASE evolution'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'evolution')\gexec

-- =============================================================================
-- Schema principal
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TENANTS — cada imobiliária é um tenant isolado
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug            VARCHAR(63) UNIQUE NOT NULL,       -- subdomínio
    nome            VARCHAR(255) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','suspended','deleted')),
    fuso            VARCHAR(50) NOT NULL DEFAULT 'America/Sao_Paulo',
    horario_inicio  TIME NOT NULL DEFAULT '08:00:00',
    horario_fim     TIME NOT NULL DEFAULT '20:00:00',
    retencao_dias   INT NOT NULL DEFAULT 180,
    retencao_audit  INT NOT NULL DEFAULT 365,
    -- Configuração do agente (persona, vocabulário)
    agent_config    JSONB NOT NULL DEFAULT '{}',
    -- Credenciais Imoview cifradas com ENCRYPTION_KEY
    imoview_creds   BYTEA,
    -- Modelo Ollama selecionado para este tenant
    ollama_model    VARCHAR(100) NOT NULL DEFAULT 'qwen3:8b',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- ADMINS DE TENANT — administradores da imobiliária
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_admins (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    nome        VARCHAR(255) NOT NULL,
    email       VARCHAR(255) NOT NULL,
    senha_hash  TEXT NOT NULL,
    ativo       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, email)
);
CREATE INDEX idx_tenant_admins_tenant ON tenant_admins(tenant_id);

-- -----------------------------------------------------------------------------
-- WHATSAPP SESSIONS — uma instância Evolution por número de agente
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    instance_id     VARCHAR(100) UNIQUE NOT NULL,   -- ID no Evolution API
    numero          VARCHAR(20) UNIQUE NOT NULL,    -- E.164
    status          VARCHAR(20) NOT NULL DEFAULT 'disconnected'
                        CHECK (status IN ('connected','disconnected','qr_pending','banned')),
    qr_code         TEXT,
    last_seen       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ws_tenant ON whatsapp_sessions(tenant_id);
CREATE INDEX idx_ws_instance ON whatsapp_sessions(instance_id);

-- -----------------------------------------------------------------------------
-- CORRETORES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS corretores (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    telefone    VARCHAR(20) NOT NULL,               -- E.164
    nome        VARCHAR(255),
    email       VARCHAR(255),
    status      VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','active','rejected','blocked')),
    recusa_motivo   TEXT,
    aprovado_por    UUID REFERENCES tenant_admins(id),
    aprovado_em     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, telefone)
);
CREATE INDEX idx_corretores_tenant ON corretores(tenant_id);
CREATE INDEX idx_corretores_status ON corretores(tenant_id, status);

-- -----------------------------------------------------------------------------
-- MENSAGENS — histórico completo de conversas
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mensagens (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    corretor_id     UUID NOT NULL REFERENCES corretores(id) ON DELETE CASCADE,
    message_id      VARCHAR(255) NOT NULL,          -- ID original WhatsApp (dedup)
    direcao         VARCHAR(10) NOT NULL CHECK (direcao IN ('inbound','outbound')),
    tipo            VARCHAR(20) NOT NULL DEFAULT 'text'
                        CHECK (tipo IN ('text','audio','image','document')),
    conteudo        TEXT,
    audio_url       TEXT,                           -- URL MinIO assinada
    transcricao     TEXT,                           -- resultado Whisper
    status          VARCHAR(20) NOT NULL DEFAULT 'received'
                        CHECK (status IN ('received','queued','processing','sent','delivered','read','error')),
    trace           JSONB NOT NULL DEFAULT '{}',    -- tempo por etapa
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, message_id)
);
CREATE INDEX idx_mensagens_tenant_corretor ON mensagens(tenant_id, corretor_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- PENDENCIAS DE ESCRITA — operações no Imoview que falharam
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pendencias_crm (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    corretor_id     UUID NOT NULL REFERENCES corretores(id) ON DELETE CASCADE,
    tipo            VARCHAR(50) NOT NULL,           -- 'criar_cliente', 'atualizar_cliente'
    payload         JSONB NOT NULL,
    tentativas      INT NOT NULL DEFAULT 0,
    ultimo_erro     TEXT,
    resolvido       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pendencias_tenant ON pendencias_crm(tenant_id, resolvido);

-- -----------------------------------------------------------------------------
-- CACHE DE IMÓVEIS — sincronização incremental do Imoview
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS imoveis_cache (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    codigo_imoview  INT NOT NULL,
    finalidade      VARCHAR(10) NOT NULL CHECK (finalidade IN ('aluguel','venda')),
    tipo            VARCHAR(100),
    bairro          VARCHAR(150),
    cidade          VARCHAR(150),
    area_m2         NUMERIC(10,2),
    quartos         INT,
    vagas           INT,
    valor           NUMERIC(14,2),
    situacao        VARCHAR(50),
    link_anuncio    TEXT,
    dados_extras    JSONB NOT NULL DEFAULT '{}',
    -- pgvector embedding da descrição para busca semântica
    embedding       VECTOR(1536),
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, codigo_imoview)
);
CREATE INDEX idx_imoveis_tenant ON imoveis_cache(tenant_id, situacao);
CREATE INDEX idx_imoveis_busca ON imoveis_cache(tenant_id, finalidade, bairro, quartos, valor);
CREATE INDEX idx_imoveis_embedding ON imoveis_cache USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- -----------------------------------------------------------------------------
-- AUDITORIA — append-only, sem UPDATE nem DELETE jamais
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auditoria (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    corretor_id     UUID REFERENCES corretores(id),
    acao            VARCHAR(100) NOT NULL,
    entidade        VARCHAR(100),
    entidade_id     VARCHAR(255),
    payload_antes   JSONB,
    payload_depois  JSONB,
    aprovado_por    UUID REFERENCES corretores(id),
    origem          VARCHAR(20) NOT NULL DEFAULT 'agent'
                        CHECK (origem IN ('agent','portal','scheduler','system')),
    ip_hash         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_auditoria_tenant ON auditoria(tenant_id, created_at DESC);
CREATE INDEX idx_auditoria_corretor ON auditoria(tenant_id, corretor_id, created_at DESC);

-- Regra que impede qualquer UPDATE ou DELETE na auditoria
CREATE OR REPLACE RULE auditoria_no_update AS ON UPDATE TO auditoria DO INSTEAD NOTHING;
CREATE OR REPLACE RULE auditoria_no_delete AS ON DELETE TO auditoria DO INSTEAD NOTHING;

-- -----------------------------------------------------------------------------
-- CONSUMO DE APIS EXTERNAS — métricas diárias por modelo (painel do dev)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_usage (
    dia             DATE NOT NULL,
    provider        VARCHAR(30) NOT NULL,
    operation       VARCHAR(30) NOT NULL,
    model           VARCHAR(120) NOT NULL,
    requests        INTEGER NOT NULL DEFAULT 0,
    errors          INTEGER NOT NULL DEFAULT 0,
    input_tokens    BIGINT NOT NULL DEFAULT 0,
    output_tokens   BIGINT NOT NULL DEFAULT 0,
    characters      BIGINT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (dia, provider, operation, model)
);
CREATE INDEX IF NOT EXISTS idx_api_usage_dia ON api_usage (dia DESC);

-- -----------------------------------------------------------------------------
-- ESTADOS DE ONBOARDING — controla fluxo de cadastro do corretor
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onboarding_states (
    corretor_id     UUID PRIMARY KEY REFERENCES corretores(id) ON DELETE CASCADE,
    etapa           VARCHAR(50) NOT NULL DEFAULT 'aguardando_nome'
                        CHECK (etapa IN ('aguardando_nome','aguardando_email','notificado','concluido')),
    tentativas      INT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- CONFIRMACOES DE ESCRITA PENDENTES — aguardando confirmação do corretor
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS confirmacoes_pendentes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    corretor_id     UUID NOT NULL REFERENCES corretores(id) ON DELETE CASCADE,
    tipo            VARCHAR(50) NOT NULL,
    payload_hash    TEXT NOT NULL,  -- SHA-256 do payload; se mudar → conflito
    payload         JSONB NOT NULL,
    expirado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes',
    respondido      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_confirmacoes_corretor ON confirmacoes_pendentes(tenant_id, corretor_id, respondido);

-- =============================================================================
-- ROW LEVEL SECURITY
-- Defesa em profundidade: mesmo um WHERE esquecido não vaza dado de outro tenant
-- =============================================================================

ALTER TABLE corretores ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE pendencias_crm ENABLE ROW LEVEL SECURITY;
ALTER TABLE imoveis_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE confirmacoes_pendentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_admins ENABLE ROW LEVEL SECURITY;

-- Políticas RLS: usa variável de sessão app.tenant_id definida em cada conexão
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'corretores','mensagens','pendencias_crm','imoveis_cache',
        'auditoria','confirmacoes_pendentes',
        'whatsapp_sessions','tenant_admins'
    ] LOOP
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I
             USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
            tbl
        );
    END LOOP;
END;
$$;

-- onboarding_states não possui tenant_id: isola pelo corretor do tenant
CREATE POLICY tenant_isolation ON onboarding_states
USING (
    corretor_id IN (
        SELECT id FROM corretores
        WHERE tenant_id = current_setting('app.tenant_id', true)::uuid
    )
);

-- Super-user da aplicação bypassa RLS apenas via SET LOCAL (nunca globalmente)
-- O papel 'acessor' usa RLS por padrão
ALTER ROLE acessor SET row_security = on;

-- =============================================================================
-- Trigger: updated_at automático
-- =============================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DO $$
DECLARE tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'tenants','corretores','imoveis_cache','pendencias_crm',
        'whatsapp_sessions'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_updated_at BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION set_updated_at()', tbl
        );
    END LOOP;
END;
$$;
