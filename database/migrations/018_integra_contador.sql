-- Integra Contador (SERPRO): situação fiscal e Caixa Postal da Receita.
-- (O número 017 está reservado para o ramo do planejamento tributário.)

-- Relatório de Situação Fiscal (SITFIS) de cada empresa — histórico das consultas.
-- O PDF fica em documentos (só para a equipe); aqui guardamos o que o sistema leu dele.
CREATE TABLE IF NOT EXISTS situacao_fiscal (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    situacao VARCHAR(20) NOT NULL CHECK (situacao IN ('regular', 'pendencia', 'indefinida')),
    resumo JSONB NOT NULL DEFAULT '{}',      -- certidão emitida, pendências da Receita e da PGFN
    documento_id UUID REFERENCES documentos(id) ON DELETE SET NULL,
    usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_situacao_fiscal_empresa ON situacao_fiscal(empresa_id, criado_em DESC);

-- Caixa Postal do e-CAC: última verificação de cada empresa.
-- Guarda só os ASSUNTOS das mensagens não lidas (a lista não marca nada como lido na Receita).
CREATE TABLE IF NOT EXISTS caixa_postal (
    empresa_id UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
    indicador SMALLINT,                      -- 0 sem novas, 1 uma nova, 2 várias novas (SERPRO)
    nao_lidas INTEGER,
    mensagens JSONB NOT NULL DEFAULT '[]',
    erro VARCHAR(400),
    verificado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    verificado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL
);
