-- Assistente de ajuda (manuais + IA): cada pergunta feita no sistema ou na
-- Área do Cliente fica registrada, com a resposta e se ajudou ou não — para
-- o escritório ver o que as pessoas perguntam e melhorar os manuais.

CREATE TABLE IF NOT EXISTS ajuda_perguntas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    publico VARCHAR(10) NOT NULL CHECK (publico IN ('equipe', 'cliente')),
    usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    cliente_id UUID REFERENCES clientes_portal(id) ON DELETE SET NULL,
    pagina VARCHAR(120),
    pergunta TEXT NOT NULL,
    resposta TEXT,
    secoes TEXT[] NOT NULL DEFAULT '{}',
    modo VARCHAR(10) NOT NULL CHECK (modo IN ('ia', 'busca')),   -- ia = respondida pela IA; busca = só achou trechos do manual
    util BOOLEAN,                                                -- "Ajudou?" (null = não respondeu)
    tokens_entrada INTEGER,
    tokens_saida INTEGER,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ajuda_perguntas_data ON ajuda_perguntas(criado_em DESC);
