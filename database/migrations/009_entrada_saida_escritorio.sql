-- Entrada e saída de empresas do escritório.
--
-- Entrada: dados do "informativo interno" enviado a todos quando uma
-- empresa nova chega (competência de início, fator R, pró-labore).
-- Saída: data em que a responsabilidade do escritório se encerrou,
-- registrada pelo botão "Registrar saída do escritório" (administrador).
-- A situação 'saiu_escritorio' se soma às já existentes
-- (ativa, suspensa, baixada, em_legalizacao).

ALTER TABLE empresas
    ADD COLUMN IF NOT EXISTS competencia_inicio DATE,          -- sempre o dia 1º do mês de início
    ADD COLUMN IF NOT EXISTS fator_r BOOLEAN,                   -- NULL = não informado
    ADD COLUMN IF NOT EXISTS pro_labore VARCHAR(255),           -- ex: "Iniciar retirada assim que aberta, um salário mínimo"
    ADD COLUMN IF NOT EXISTS data_saida DATE,                   -- último dia de responsabilidade do escritório
    ADD COLUMN IF NOT EXISTS observacao_saida TEXT;
