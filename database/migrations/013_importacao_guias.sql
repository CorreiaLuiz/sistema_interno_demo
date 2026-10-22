-- Importação de guias em lote (DAS, DARF, FGTS, estaduais/municipais).
-- Cada PDF enviado vira um item "pendente" com o que o sistema leu dele
-- (CNPJ, competência, vencimento, valor). Depois da conferência, os itens
-- confirmados viram documentos da empresa (categoria "guia") e o cliente
-- recebe por e-mail. Itens pendentes esquecidos são apagados em 2 dias.

CREATE TABLE IF NOT EXISTS guias_importacao (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lote_id UUID NOT NULL,
    usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    nome_original VARCHAR(255) NOT NULL,
    nome_armazenado VARCHAR(255) NOT NULL,
    tamanho_bytes BIGINT,
    tipo_guia VARCHAR(20),                 -- DAS, DARF, FGTS, Estadual, Municipal, Guia
    cnpj_lido VARCHAR(14),
    razao_social_lida VARCHAR(150),
    empresa_id UUID REFERENCES empresas(id) ON DELETE SET NULL,   -- sugerida pelo CNPJ ou escolhida
    competencia VARCHAR(7),                -- AAAA-MM
    vencimento DATE,
    pagar_ate DATE,
    valor NUMERIC(14, 2),
    numero_documento VARCHAR(40),
    erro_leitura VARCHAR(200),
    status VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'importado', 'descartado')),
    documento_id UUID REFERENCES documentos(id) ON DELETE SET NULL,
    email_status VARCHAR(20),              -- enviado, falhou, sem_email, simulado
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    importado_em TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_guias_importacao_lote ON guias_importacao(lote_id);
CREATE INDEX IF NOT EXISTS idx_guias_importacao_numero ON guias_importacao(numero_documento) WHERE status = 'importado';
