-- Planejamento tributário: qual regime (Simples, Presumido, Real; Simples
-- puro x híbrido em 2027) é mais econômico para cada cliente.
--
-- - pt_analises: cada cálculo feito (dados do Domínio + questionário), com
--   o PDF interno (rascunho) e, depois de aprovado, o PDF do cliente.
--   A empresa é identificada pelo CNPJ (a carteira inteira está no Domínio;
--   empresa_id só quando ela também existe no cadastro do sistema).
-- - pt_questionarios: link individual (token) enviado ao cliente para
--   responder o questionário, sem precisar de login.

CREATE TABLE IF NOT EXISTS pt_analises (
    id SERIAL PRIMARY KEY,
    cnpj VARCHAR(14) NOT NULL,                     -- só números/letras (CNPJ alfanumérico)
    empresa_id UUID REFERENCES empresas(id) ON DELETE SET NULL,
    codigo_dominio INTEGER,
    nome VARCHAR(200),
    periodo_fim VARCHAR(7),                        -- 'AAAA-MM' (último mês dos 12 analisados)
    origem VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'radar', 'questionario')),
    status VARCHAR(20) NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'aprovado', 'enviado', 'erro')),
    erro TEXT,
    resultado JSONB,                               -- saída completa do motor
    respostas JSONB,                               -- questionário usado no cálculo (cópia)
    regime_atual_total NUMERIC(14,2),
    melhor_regime VARCHAR(40),
    economia NUMERIC(14,2),                        -- regime atual - mais barato (R$/ano)
    pdf_interno VARCHAR(300),
    pdf_cliente VARCHAR(300),
    gerado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    gerado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    aprovado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    aprovado_em TIMESTAMP,
    enviado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    enviado_em TIMESTAMP,
    envio JSONB                                    -- para quem foi e por quais canais
);
CREATE INDEX IF NOT EXISTS idx_pt_analises_cnpj ON pt_analises(cnpj, gerado_em DESC);

CREATE TABLE IF NOT EXISTS pt_questionarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token VARCHAR(64) UNIQUE NOT NULL,
    cnpj VARCHAR(14) NOT NULL,
    empresa_id UUID REFERENCES empresas(id) ON DELETE SET NULL,
    nome_empresa VARCHAR(200),
    criado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    expira_em TIMESTAMP NOT NULL,
    envio JSONB,                                   -- e-mail/WhatsApp para onde o link foi mandado
    respondido_em TIMESTAMP,
    respostas JSONB,
    analise_id INTEGER REFERENCES pt_analises(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_pt_questionarios_cnpj ON pt_questionarios(cnpj, criado_em DESC);
