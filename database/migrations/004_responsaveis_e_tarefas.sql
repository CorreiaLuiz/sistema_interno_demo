-- Migração 004: adiciona responsável por etapa e um status mais rico
-- (pendente / em_andamento / exigencia / concluido), substituindo o
-- booleano simples "concluida" que existia até aqui.
--
-- Como rodar:
--   psql -U postgres -d legalizacao_db -f database/migrations/004_responsaveis_e_tarefas.sql

-- Responsável pela etapa (analista de legalização ou administrador)
ALTER TABLE etapas_processo
  ADD COLUMN IF NOT EXISTS responsavel_id UUID REFERENCES usuarios(id) ON DELETE SET NULL;

-- Novo campo de status, mais expressivo que o booleano antigo
ALTER TABLE etapas_processo
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pendente';

-- Garante que só os 4 valores esperados sejam aceitos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_etapas_processo_status'
  ) THEN
    ALTER TABLE etapas_processo
      ADD CONSTRAINT chk_etapas_processo_status
      CHECK (status IN ('pendente', 'em_andamento', 'exigencia', 'concluido'));
  END IF;
END $$;

-- Migra os dados existentes do booleano "concluida" para o novo status
UPDATE etapas_processo
SET status = CASE WHEN concluida THEN 'concluido' ELSE 'pendente' END
WHERE status = 'pendente'; -- só afeta linhas ainda não migradas (idempotente)

-- Mantém a coluna "concluida" (booleana) sincronizada automaticamente a
-- partir de agora, via trigger — assim qualquer código antigo que ainda
-- leia "concluida" continua funcionando sem precisar ser tocado.
CREATE OR REPLACE FUNCTION sincronizar_concluida_etapa()
RETURNS TRIGGER AS $$
BEGIN
  NEW.concluida := (NEW.status = 'concluido');

  IF NEW.status = 'concluido' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.concluida_em := COALESCE(NEW.concluida_em, NOW());
    ELSIF OLD.status IS DISTINCT FROM 'concluido' THEN
      NEW.concluida_em := NOW();
    ELSE
      NEW.concluida_em := COALESCE(NEW.concluida_em, NOW());
    END IF;
  ELSE
    NEW.concluida_em := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sincronizar_concluida_etapa ON etapas_processo;
CREATE TRIGGER trg_sincronizar_concluida_etapa
  BEFORE INSERT OR UPDATE OF status ON etapas_processo
  FOR EACH ROW EXECUTE FUNCTION sincronizar_concluida_etapa();

CREATE INDEX IF NOT EXISTS idx_etapas_processo_responsavel ON etapas_processo(responsavel_id);
