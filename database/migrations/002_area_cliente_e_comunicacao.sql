-- Migração 002: adiciona os módulos de Etapas de Processo, Histórico de
-- Comunicação (e-mail/WhatsApp) e Tokens da Área do Cliente.
--
-- Como rodar:
--   psql -U postgres -d legalizacao_db -f database/migrations/002_area_cliente_e_comunicacao.sql

CREATE TABLE IF NOT EXISTS etapas_processo (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    processo_id UUID NOT NULL REFERENCES processos_legalizacao(id) ON DELETE CASCADE,
    nome VARCHAR(100) NOT NULL,
    ordem INTEGER NOT NULL DEFAULT 0,
    concluida BOOLEAN NOT NULL DEFAULT FALSE,
    concluida_em TIMESTAMP,
    observacoes TEXT,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_etapas_processo ON etapas_processo(processo_id);

CREATE TABLE IF NOT EXISTS historico_comunicacao (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    processo_id UUID REFERENCES processos_legalizacao(id) ON DELETE SET NULL,
    canal VARCHAR(20) NOT NULL,
    destinatario VARCHAR(150) NOT NULL,
    assunto VARCHAR(200),
    mensagem TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'enviado',
    erro TEXT,
    enviado_por UUID REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_historico_comunicacao_empresa ON historico_comunicacao(empresa_id);

CREATE TABLE IF NOT EXISTS tokens_area_cliente (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    token VARCHAR(64) UNIQUE NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    expira_em TIMESTAMP,
    criado_por UUID REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    ultimo_acesso TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tokens_area_cliente_token ON tokens_area_cliente(token);
CREATE INDEX IF NOT EXISTS idx_tokens_area_cliente_empresa ON tokens_area_cliente(empresa_id);
