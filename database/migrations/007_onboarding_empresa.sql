-- Esteira de integração de empresa nova (cadastro → legalização →
-- cadastro no Domínio → fechamento setorial). Cada empresa tem UM
-- registro de onboarding, que avança por estágios fixos conforme os
-- responsáveis vão concluindo a própria parte.
CREATE TABLE onboarding_empresa (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL UNIQUE REFERENCES empresas(id) ON DELETE CASCADE,
    estagio VARCHAR(30) NOT NULL
        CHECK (estagio IN ('legalizacao', 'cadastro_dominio', 'fechamento_setorial')),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Histórico de transições, para auditoria ("quem passou a bola pra quem e quando").
CREATE TABLE onboarding_historico (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    estagio VARCHAR(30) NOT NULL,
    concluido_por UUID REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_onboarding_empresa_empresa ON onboarding_empresa(empresa_id);
CREATE INDEX idx_onboarding_historico_empresa ON onboarding_historico(empresa_id);
