-- Avisos dentro do sistema (o "sininho" no topo) e pedidos de Legalização
-- na Área do Cliente.
--
-- - notificacoes: um aviso por colaborador (ex: "Nova tarefa para você",
--   "Pedido do cliente: Regerar DAS"). Funciona mesmo sem e-mail configurado.
-- - tarefas_setor passa a aceitar o setor 'legalizacao', usado pelos pedidos
--   que o cliente faz à Legalização (alvará, alteração contratual...).

CREATE TABLE IF NOT EXISTS notificacoes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo VARCHAR(40) NOT NULL,             -- tarefa_nova, pedido_cliente, processo_exigencia...
    titulo VARCHAR(200) NOT NULL,
    mensagem TEXT,
    link VARCHAR(300),                     -- tela que o aviso abre (ex: /pages/fiscal.html)
    lida BOOLEAN NOT NULL DEFAULT FALSE,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notificacoes_usuario ON notificacoes(usuario_id, lida, criado_em DESC);

ALTER TABLE tarefas_setor DROP CONSTRAINT IF EXISTS tarefas_setor_setor_check;
ALTER TABLE tarefas_setor ADD CONSTRAINT tarefas_setor_setor_check
    CHECK (setor IN ('fiscal', 'contabilidade', 'folha_pagamento', 'legalizacao'));
