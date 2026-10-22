-- Conector do Claude (MCP): chaves pessoais para o Claude CONSULTAR o sistema
-- em nome de uma pessoa da equipe (com as permissões dela). Só leitura.
-- Guarda só o "hash" da chave: a chave inteira aparece uma vez, ao criar.

CREATE TABLE IF NOT EXISTS conector_chaves (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    nome VARCHAR(80) NOT NULL,                 -- ex: "Claude do meu computador"
    hash CHAR(64) NOT NULL UNIQUE,             -- sha256 da chave
    inicio VARCHAR(12) NOT NULL,               -- começo da chave, para reconhecer na lista
    usos INTEGER NOT NULL DEFAULT 0,
    ultimo_uso TIMESTAMP,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    revogada_em TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_conector_chaves_usuario ON conector_chaves(usuario_id);
