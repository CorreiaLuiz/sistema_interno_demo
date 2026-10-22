-- Migração 003: recuperação de senha, log de auditoria e controle de
-- alertas automáticos de vencimento (evita notificar a mesma CND/licença
-- todo dia).
--
-- Como rodar:
--   psql -U postgres -d legalizacao_db -f database/migrations/003_seguranca_auditoria_alertas.sql

CREATE TABLE IF NOT EXISTS tokens_recuperacao_senha (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    token VARCHAR(64) UNIQUE NOT NULL,
    usado BOOLEAN NOT NULL DEFAULT FALSE,
    expira_em TIMESTAMP NOT NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tokens_recuperacao_token ON tokens_recuperacao_senha(token);

-- logs_auditoria já existe desde o schema inicial; nada a criar aqui,
-- só passamos a gravar nela a partir de agora (ver controllers).

CREATE TABLE IF NOT EXISTS alertas_vencimento_enviados (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tipo_registro VARCHAR(20) NOT NULL,      -- certidao | licenca
    registro_id UUID NOT NULL,
    data_validade DATE NOT NULL,
    enviado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (tipo_registro, registro_id, data_validade)
);
