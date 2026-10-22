-- Memória do assistente "Dúvidas?": respostas ensinadas pelo administrador.
-- Quando alguém pergunta algo parecido, o assistente usa a resposta ensinada
-- (com ou sem IA). Com IA, elas também vão junto do manual.

CREATE TABLE IF NOT EXISTS ajuda_memoria (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    publico VARCHAR(10) NOT NULL CHECK (publico IN ('equipe', 'cliente')),
    pergunta TEXT NOT NULL,                 -- a pergunta como as pessoas fazem
    resposta TEXT NOT NULL,                 -- a resposta certa, escrita pelo administrador
    secoes TEXT[] NOT NULL DEFAULT '{}',    -- passo a passo do manual que acompanha a resposta
    usos INTEGER NOT NULL DEFAULT 0,        -- quantas vezes o assistente já usou
    origem_pergunta_id UUID REFERENCES ajuda_perguntas(id) ON DELETE SET NULL,
    criado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    atualizado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ajuda_memoria_publico ON ajuda_memoria(publico);

-- Pergunta respondida pela memória
ALTER TABLE ajuda_perguntas DROP CONSTRAINT IF EXISTS ajuda_perguntas_modo_check;
ALTER TABLE ajuda_perguntas ADD CONSTRAINT ajuda_perguntas_modo_check CHECK (modo IN ('ia', 'busca', 'memoria'));
ALTER TABLE ajuda_perguntas ADD COLUMN IF NOT EXISTS memoria_id UUID REFERENCES ajuda_memoria(id) ON DELETE SET NULL;
