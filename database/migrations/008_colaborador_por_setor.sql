-- Migração 008: o papel genérico "colaborador" dava acesso de leitura a
-- QUALQUER setor (Fiscal/Contabilidade/Folha). Substituído por três
-- papéis específicos — cada colaborador só acessa o próprio setor,
-- igual já acontece com os supervisores.
--
-- Como rodar:
--   psql -U postgres -d legalizacao_db -f database/migrations/008_colaborador_por_setor.sql

INSERT INTO roles (nome, descricao) VALUES
  ('colaborador_fiscal', 'Colaborador do setor Fiscal — vê e marca status só das próprias tarefas nesse setor'),
  ('colaborador_contabilidade', 'Colaborador do setor Contábil — vê e marca status só das próprias tarefas nesse setor'),
  ('colaborador_folha_pagamento', 'Colaborador de Folha de Pagamento — vê e marca status só das próprias tarefas nesse setor')
ON CONFLICT (nome) DO NOTHING;

-- Usuários que já estavam com o papel genérico "colaborador" 
-- passam a ser colaborador_fiscal por padrão — ajuste manualmente na
-- tela de Usuários se algum deles for de outro setor.
UPDATE usuarios
SET role_id = (SELECT id FROM roles WHERE nome = 'colaborador_fiscal')
WHERE role_id = (SELECT id FROM roles WHERE nome = 'colaborador');
