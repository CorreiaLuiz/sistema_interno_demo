-- Migração 007:
--   1) Controle de vencimento de Certificados Digitais (mesmo padrão de
--      status usado em certidões/licenças), pra aparecer no Dashboard.
--   2) Handoff automático: ao concluir um processo de legalização, cria
--      tarefas automaticamente nos setores indicados (ex: Folha de
--      Pagamento) sem precisar mudar de tela.
--
-- Como rodar:
--   psql -U postgres -d legalizacao_db -f database/migrations/007_certificados_digitais_e_handoff.sql

CREATE TABLE IF NOT EXISTS certificados_digitais (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    tipo VARCHAR(30) NOT NULL DEFAULT 'e-cnpj',   -- e-cnpj, e-cpf, outro
    numero_serie VARCHAR(100),
    data_emissao DATE,
    data_validade DATE,
    status VARCHAR(30) NOT NULL DEFAULT 'emissao_pendente'
        CHECK (status IN ('emissao_pendente', 'valida', 'a_vencer', 'vencida')),
    documento_id UUID REFERENCES documentos(id) ON DELETE SET NULL,
    responsavel_id UUID REFERENCES usuarios(id),
    observacoes TEXT,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_certificados_digitais_empresa ON certificados_digitais(empresa_id);
CREATE INDEX IF NOT EXISTS idx_certificados_digitais_validade ON certificados_digitais(data_validade);
CREATE INDEX IF NOT EXISTS idx_certificados_digitais_status ON certificados_digitais(status);

CREATE TRIGGER trg_certificados_digitais_atualizado BEFORE UPDATE ON certificados_digitais
    FOR EACH ROW EXECUTE FUNCTION atualizar_timestamp();

-- Amplia a função que já roda todo dia no job de vencimentos, para
-- também recalcular o status dos certificados digitais junto com
-- certidões e licenças.
CREATE OR REPLACE FUNCTION atualizar_status_vencimentos()
RETURNS void AS $$
BEGIN
    UPDATE certidoes
    SET status = CASE
        WHEN data_validade IS NULL THEN 'emissao_pendente'
        WHEN data_validade < CURRENT_DATE THEN 'vencida'
        WHEN data_validade <= CURRENT_DATE + INTERVAL '30 days' THEN 'a_vencer'
        ELSE 'valida'
    END
    WHERE data_validade IS NOT NULL OR status <> 'emissao_pendente';

    UPDATE licencas
    SET status = CASE
        WHEN data_validade IS NULL THEN 'emissao_pendente'
        WHEN data_validade < CURRENT_DATE THEN 'vencida'
        WHEN data_validade <= CURRENT_DATE + INTERVAL '30 days' THEN 'a_vencer'
        ELSE 'valida'
    END
    WHERE data_validade IS NOT NULL OR status <> 'emissao_pendente';

    UPDATE certificados_digitais
    SET status = CASE
        WHEN data_validade IS NULL THEN 'emissao_pendente'
        WHEN data_validade < CURRENT_DATE THEN 'vencida'
        WHEN data_validade <= CURRENT_DATE + INTERVAL '30 days' THEN 'a_vencer'
        ELSE 'valida'
    END
    WHERE data_validade IS NOT NULL OR status <> 'emissao_pendente';
END;
$$ LANGUAGE plpgsql;
