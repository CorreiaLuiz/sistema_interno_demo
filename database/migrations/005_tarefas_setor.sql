-- Migração 005: módulo de Tarefas por Setor (Fiscal, Contabilidade,
-- Folha de Pagamento) + papéis de supervisor de cada setor.
--
-- Como rodar:
--   psql -U postgres -d legalizacao_db -f database/migrations/005_tarefas_setor.sql

-- Novos papéis — um supervisor por setor, além do administrador que já
-- enxerga tudo. Os analistas de legalização/certidões/licenças
-- continuam sem acesso a este módulo (não é a área deles).
INSERT INTO roles (nome, descricao) VALUES
  ('supervisor_fiscal', 'Supervisor do setor fiscal — cadastra e acompanha tarefas fiscais por empresa'),
  ('supervisor_contabilidade', 'Supervisor do setor contábil — cadastra e acompanha tarefas contábeis por empresa'),
  ('supervisor_folha_pagamento', 'Supervisor do setor de folha de pagamento — cadastra e acompanha tarefas de folha por empresa')
ON CONFLICT (nome) DO NOTHING;

-- Tarefas atribuídas por um supervisor de setor a um responsável (via
-- e-mail — não precisa ser um usuário cadastrado no sistema, já que o
-- responsável pode ser alguém que só recebe e-mail, sem login).
CREATE TABLE IF NOT EXISTS tarefas_setor (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    setor VARCHAR(30) NOT NULL CHECK (setor IN ('fiscal', 'contabilidade', 'folha_pagamento')),
    descricao TEXT NOT NULL,                    -- quais atividades serão feitas
    responsavel_nome VARCHAR(150),
    responsavel_email VARCHAR(150) NOT NULL,     -- e-mail (Outlook) do responsável pela empresa
    status VARCHAR(20) NOT NULL DEFAULT 'pendente'
        CHECK (status IN ('pendente', 'em_andamento', 'concluido')),
    criado_por UUID REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    concluido_em TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tarefas_setor_empresa ON tarefas_setor(empresa_id);
CREATE INDEX IF NOT EXISTS idx_tarefas_setor_setor ON tarefas_setor(setor);
CREATE INDEX IF NOT EXISTS idx_tarefas_setor_status ON tarefas_setor(status);

-- Mantém concluido_em coerente com o status, do mesmo jeito que já
-- fizemos para etapas_processo na migração 004.
CREATE OR REPLACE FUNCTION sincronizar_concluido_em_tarefa()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'concluido' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.concluido_em := COALESCE(NEW.concluido_em, NOW());
    ELSIF OLD.status IS DISTINCT FROM 'concluido' THEN
      NEW.concluido_em := NOW();
    ELSE
      NEW.concluido_em := COALESCE(NEW.concluido_em, NOW());
    END IF;
  ELSE
    NEW.concluido_em := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sincronizar_concluido_em_tarefa ON tarefas_setor;
CREATE TRIGGER trg_sincronizar_concluido_em_tarefa
  BEFORE INSERT OR UPDATE OF status ON tarefas_setor
  FOR EACH ROW EXECUTE FUNCTION sincronizar_concluido_em_tarefa();

-- Nova categoria de documento para o certificado digital salvo na
-- abertura da empresa (reaproveita a tabela `documentos` que já existe
-- — não precisa de tabela nova, só documentar a categoria no app).
-- Nenhuma alteração de schema necessária aqui: `categoria` já é texto livre.
