-- Conferência bancária (Contabilidade): extratos da pasta de cada empresa
-- x o que está lançado no Domínio. O cadastro vem da planilha
-- "Controle Extratos CC"; o resultado de cada conferência fica
-- guardado por empresa e ano para a lista e a ficha abrirem na hora.

CREATE TABLE IF NOT EXISTS cb_empresas (
    id SERIAL PRIMARY KEY,
    chave VARCHAR(60) UNIQUE NOT NULL,        -- CNPJ (só números) ou nome normalizado
    nome VARCHAR(200) NOT NULL,
    cnpj VARCHAR(14),
    codigo_dominio INTEGER,
    codigo_origem VARCHAR(10),                -- planilha | cnpj | manual
    nome_dominio VARCHAR(200),
    responsavel VARCHAR(10),
    regime VARCHAR(10),
    situacao VARCHAR(10),
    contato VARCHAR(200),
    malote VARCHAR(40),
    bancos VARCHAR(300),
    formato VARCHAR(40),
    extratos VARCHAR(40),
    solicitado VARCHAR(200),
    na_pasta VARCHAR(200),
    obs TEXT,
    pasta VARCHAR(300),                       -- nome da pasta em "01 - Empresas Ativas"
    pasta_manual BOOLEAN NOT NULL DEFAULT FALSE,
    na_planilha BOOLEAN NOT NULL DEFAULT TRUE,
    empresa_id UUID REFERENCES empresas(id) ON DELETE SET NULL,
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cb_empresas_codigo ON cb_empresas(codigo_dominio);

-- Conta do extrato (banco + número da conta do OFX) ligada à mão a uma
-- conta do Domínio. codi_cta NULL = "ignorar este extrato".
CREATE TABLE IF NOT EXISTS cb_vinculos_conta (
    id SERIAL PRIMARY KEY,
    cb_empresa_id INTEGER NOT NULL REFERENCES cb_empresas(id) ON DELETE CASCADE,
    chave_ofx VARCHAR(80) NOT NULL,
    codi_cta INTEGER,
    usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (cb_empresa_id, chave_ofx)
);

CREATE TABLE IF NOT EXISTS cb_conferencias (
    cb_empresa_id INTEGER NOT NULL REFERENCES cb_empresas(id) ON DELETE CASCADE,
    ano INTEGER NOT NULL,
    resultado JSONB,
    meses JSONB,                              -- situação de cada mês (para a lista)
    pendencias INTEGER NOT NULL DEFAULT 0,
    erro TEXT,
    conferido_em TIMESTAMP NOT NULL DEFAULT NOW(),
    conferido_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    PRIMARY KEY (cb_empresa_id, ano)
);
