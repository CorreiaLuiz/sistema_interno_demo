-- Migração 001: adiciona coluna de descrição livre em documentos.
-- Usada principalmente quando a categoria selecionada é "outro", para
-- o usuário explicar do que se trata o arquivo.
--
-- Como rodar (bancos já existentes, sem precisar recriar nada):
--   psql -U postgres -d legalizacao_db -f database/migrations/001_add_descricao_documentos.sql

ALTER TABLE documentos ADD COLUMN IF NOT EXISTS descricao VARCHAR(255);
