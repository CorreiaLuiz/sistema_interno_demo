-- Área do Cliente com login (e-mail + senha), substituindo o antigo
-- acesso por link sem senha (tokens_area_cliente).
--
-- - clientes_portal: pessoa que acessa o portal (sócio, financeiro...).
--   Um mesmo login pode enxergar várias empresas (clientes_portal_empresas).
-- - tokens_senha_cliente: links de "criar minha senha" (primeiro acesso)
--   e "esqueci minha senha", de uso único.
-- - documentos.visivel_cliente: só o que a equipe marcar aparece no portal.
-- - tarefas_setor ganha os campos das solicitações feitas pelo cliente
--   (ex: "Regerar guia do DAS") e da resposta com a guia anexada.
-- - downloads_portal: histórico de quem baixou o quê e quando.

CREATE TABLE IF NOT EXISTS clientes_portal (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome VARCHAR(150),
    email VARCHAR(150) UNIQUE NOT NULL,      -- sempre minúsculo
    telefone VARCHAR(20),                    -- para o WhatsApp
    senha_hash VARCHAR(255),                 -- NULL até o cliente criar a senha
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    ultimo_login TIMESTAMP,
    criado_por UUID REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clientes_portal_empresas (
    cliente_id UUID NOT NULL REFERENCES clientes_portal(id) ON DELETE CASCADE,
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    liberado_por UUID REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (cliente_id, empresa_id)
);
CREATE INDEX IF NOT EXISTS idx_clientes_portal_empresas_empresa ON clientes_portal_empresas(empresa_id);

CREATE TABLE IF NOT EXISTS tokens_senha_cliente (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cliente_id UUID NOT NULL REFERENCES clientes_portal(id) ON DELETE CASCADE,
    token VARCHAR(64) UNIQUE NOT NULL,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('primeiro_acesso', 'recuperacao')),
    expira_em TIMESTAMP NOT NULL,
    usado BOOLEAN NOT NULL DEFAULT FALSE,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE documentos
    ADD COLUMN IF NOT EXISTS visivel_cliente BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS enviado_por_cliente UUID REFERENCES clientes_portal(id) ON DELETE SET NULL;

-- Documentos que o próprio cliente mandou pelo portal antigo (os únicos
-- sem colaborador em enviado_por) continuam visíveis para ele
UPDATE documentos SET visivel_cliente = TRUE WHERE enviado_por IS NULL AND empresa_id IS NOT NULL;

ALTER TABLE tarefas_setor
    ADD COLUMN IF NOT EXISTS solicitado_por_cliente UUID REFERENCES clientes_portal(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS tipo_solicitacao VARCHAR(50),
    ADD COLUMN IF NOT EXISTS competencia VARCHAR(7),               -- 'AAAA-MM'
    ADD COLUMN IF NOT EXISTS resposta_cliente TEXT,
    ADD COLUMN IF NOT EXISTS documento_resposta_id UUID REFERENCES documentos(id) ON DELETE SET NULL;

-- Pedido do cliente pode chegar antes de haver um responsável definido no .env
ALTER TABLE tarefas_setor ALTER COLUMN responsavel_email DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tarefas_setor_cliente ON tarefas_setor(solicitado_por_cliente);

CREATE TABLE IF NOT EXISTS downloads_portal (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    documento_id UUID REFERENCES documentos(id) ON DELETE SET NULL,
    documento_nome VARCHAR(255),             -- guardado para o histórico sobreviver à exclusão do arquivo
    cliente_id UUID REFERENCES clientes_portal(id) ON DELETE SET NULL,
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    ip VARCHAR(64),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_downloads_portal_empresa ON downloads_portal(empresa_id, criado_em DESC);

DROP TRIGGER IF EXISTS trg_clientes_portal_atualizado_em ON clientes_portal;
CREATE TRIGGER trg_clientes_portal_atualizado_em
  BEFORE UPDATE ON clientes_portal
  FOR EACH ROW EXECUTE FUNCTION atualizar_timestamp();

-- O acesso por link sem senha deixa de existir: desativa todos os links antigos.
UPDATE tokens_area_cliente SET ativo = FALSE WHERE ativo = TRUE;
