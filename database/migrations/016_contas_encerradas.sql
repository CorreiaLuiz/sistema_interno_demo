-- Conferência bancária: contas de banco que a equipe marcou como encerradas.
-- No Domínio quase nenhuma conta é inativada no plano, então o encerramento
-- fica registrado aqui (conta do plano da empresa + último mês de movimento).
-- Depois desse mês a conferência para de pedir extrato e confere se o saldo
-- da conta foi zerado no Domínio.

CREATE TABLE IF NOT EXISTS cb_contas_encerradas (
    cb_empresa_id INTEGER NOT NULL REFERENCES cb_empresas(id) ON DELETE CASCADE,
    codi_cta INTEGER NOT NULL,
    encerrada_em DATE NOT NULL,                -- 1º dia do último mês com movimento
    usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (cb_empresa_id, codi_cta)
);
