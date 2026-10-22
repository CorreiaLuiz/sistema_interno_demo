-- Pedidos de diagnóstico feitos no formulário da página "Sobre" (site do
-- escritório, sem login). Ficam numa lista para o administrador acompanhar
-- o atendimento (novo → em contato → virou cliente / descartado).

CREATE TABLE IF NOT EXISTS contatos_site (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome VARCHAR(120) NOT NULL,
    email VARCHAR(160) NOT NULL,
    whatsapp VARCHAR(30),
    faturamento VARCHAR(60),
    objetivo VARCHAR(80),
    ip VARCHAR(64),
    status VARCHAR(20) NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'em_contato', 'cliente', 'descartado')),
    observacao TEXT,
    atualizado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    atualizado_em TIMESTAMP,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contatos_site_data ON contatos_site(criado_em DESC);
