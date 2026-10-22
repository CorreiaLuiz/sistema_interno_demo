-- Migração 006: papel "colaborador" — trabalhador do escritório que
-- pode visualizar tarefas de todos os setores (útil pra buscar um
-- arquivo, por exemplo), mas só pode alterar o status das tarefas em
-- que ele mesmo é o responsável (identificado pelo e-mail de login
-- batendo com o e-mail do responsável da tarefa).
--
-- Como rodar:
--   psql -U postgres -d legalizacao_db -f database/migrations/006_papel_colaborador.sql

INSERT INTO roles (nome, descricao) VALUES
  ('colaborador', 'Colaborador do escritório — visualiza tarefas de todos os setores, mas só edita o status das próprias tarefas')
ON CONFLICT (nome) DO NOTHING;
