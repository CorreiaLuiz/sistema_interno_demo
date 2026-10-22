-- Checklist de documentos de cada processo de legalização: o que precisa
-- para o processo andar, em qual etapa cada documento é usado e o que já
-- chegou ao escritório (com o arquivo anexado, quando houver).
-- A lista padrão por tipo de processo fica em
-- backend/src/config/checklistLegalizacao.js e é criada automaticamente.

CREATE TABLE IF NOT EXISTS checklist_documentos_processo (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    processo_id UUID NOT NULL REFERENCES processos_legalizacao(id) ON DELETE CASCADE,
    nome VARCHAR(150) NOT NULL,
    etapa_nome VARCHAR(100),                  -- etapa em que o documento é usado (ex: Junta Comercial)
    obrigatorio BOOLEAN NOT NULL DEFAULT TRUE,
    recebido BOOLEAN NOT NULL DEFAULT FALSE,
    recebido_em TIMESTAMP,
    recebido_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    documento_id UUID REFERENCES documentos(id) ON DELETE SET NULL,
    ordem INTEGER NOT NULL DEFAULT 0,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checklist_processo ON checklist_documentos_processo(processo_id);

-- Marca se o processo já recebeu a lista padrão (para não recriá-la se a
-- equipe apagar todos os itens de propósito).
ALTER TABLE processos_legalizacao
    ADD COLUMN IF NOT EXISTS checklist_iniciado BOOLEAN NOT NULL DEFAULT FALSE;
