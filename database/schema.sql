-- =====================================================================
-- SISTEMA DE GESTÃO DE LEGALIZAÇÃO, CNDs E LICENÇAS
-- Banco de Dados: PostgreSQL 14+
-- =====================================================================

-- Extensão para geração de UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================================
-- 1. USUÁRIOS E CONTROLE DE ACESSO
-- =====================================================================

CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(50) UNIQUE NOT NULL,        -- Ex: administrador, analista_legalizacao, analista_fiscal
    descricao VARCHAR(255)
);

INSERT INTO roles (nome, descricao) VALUES
    ('administrador', 'Acesso total ao sistema, incluindo gestão de usuários'),
    ('analista_legalizacao', 'Gerencia processos de abertura, alteração e baixa de empresas'),
    ('analista_certidoes', 'Gerencia CNDs e controla vencimentos'),
    ('analista_licencas', 'Gerencia licenças e alvarás'),
    ('visualizador', 'Acesso somente leitura'),
    ('supervisor_fiscal', 'Supervisor do setor fiscal — cadastra e acompanha tarefas fiscais por empresa'),
    ('supervisor_contabilidade', 'Supervisor do setor contábil — cadastra e acompanha tarefas contábeis por empresa'),
    ('supervisor_folha_pagamento', 'Supervisor do setor de folha de pagamento — cadastra e acompanha tarefas de folha por empresa'),
    ('colaborador_fiscal', 'Colaborador do setor Fiscal — vê e marca status só das próprias tarefas nesse setor'),
    ('colaborador_contabilidade', 'Colaborador do setor Contábil — vê e marca status só das próprias tarefas nesse setor'),
    ('colaborador_folha_pagamento', 'Colaborador de Folha de Pagamento — vê e marca status só das próprias tarefas nesse setor');

CREATE TABLE usuarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    senha_hash VARCHAR(255) NOT NULL,        -- bcrypt hash
    role_id INTEGER NOT NULL REFERENCES roles(id),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    ultimo_login TIMESTAMP,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_usuarios_email ON usuarios(email);

-- =====================================================================
-- 2. EMPRESAS (CLIENTES DO ESCRITÓRIO)
-- =====================================================================

CREATE TABLE empresas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    razao_social VARCHAR(200) NOT NULL,
    nome_fantasia VARCHAR(200),
    cnpj VARCHAR(18) UNIQUE NOT NULL,        -- formato 00.000.000/0000-00
    inscricao_estadual VARCHAR(30),
    inscricao_municipal VARCHAR(30),
    regime_tributario VARCHAR(30) NOT NULL DEFAULT 'simples_nacional',
        -- valores esperados: simples_nacional, lucro_presumido, lucro_real, mei
    data_abertura DATE,
    situacao VARCHAR(30) NOT NULL DEFAULT 'ativa',
        -- valores esperados: ativa, suspensa, baixada, em_legalizacao

    -- Endereço
    cep VARCHAR(9),
    logradouro VARCHAR(200),
    numero VARCHAR(20),
    complemento VARCHAR(100),
    bairro VARCHAR(100),
    cidade VARCHAR(100),
    uf CHAR(2),

    -- Contato principal
    telefone VARCHAR(20),
    email VARCHAR(150),
    responsavel_interno UUID REFERENCES usuarios(id), -- colaborador responsável pela conta

    observacoes TEXT,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_empresas_cnpj ON empresas(cnpj);
CREATE INDEX idx_empresas_situacao ON empresas(situacao);

-- Sócios da empresa (1:N)
CREATE TABLE socios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nome VARCHAR(200) NOT NULL,
    cpf VARCHAR(14),
    percentual_participacao NUMERIC(5,2),   -- ex: 50.00
    administrador BOOLEAN NOT NULL DEFAULT FALSE,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_socios_empresa ON socios(empresa_id);

-- =====================================================================
-- 3. PROCESSOS DE LEGALIZAÇÃO
-- =====================================================================

CREATE TABLE processos_legalizacao (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    tipo VARCHAR(30) NOT NULL,               -- abertura, alteracao, baixa
    descricao VARCHAR(255),
    status VARCHAR(30) NOT NULL DEFAULT 'em_andamento',
        -- valores esperados: em_andamento, exigencia, concluido, cancelado
    orgao VARCHAR(100),                      -- ex: Junta Comercial, Receita Federal, Prefeitura
    protocolo VARCHAR(100),
    data_abertura_processo DATE NOT NULL DEFAULT CURRENT_DATE,
    data_prevista_conclusao DATE,
    data_conclusao DATE,
    responsavel_id UUID REFERENCES usuarios(id),
    observacoes TEXT,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_processos_empresa ON processos_legalizacao(empresa_id);
CREATE INDEX idx_processos_status ON processos_legalizacao(status);

-- Histórico de andamento de cada processo (linha do tempo)
CREATE TABLE processos_legalizacao_historico (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    processo_id UUID NOT NULL REFERENCES processos_legalizacao(id) ON DELETE CASCADE,
    status_anterior VARCHAR(30),
    status_novo VARCHAR(30) NOT NULL,
    comentario TEXT,
    usuario_id UUID REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- 4. CNDs (CERTIDÕES NEGATIVAS DE DÉBITO)
-- =====================================================================

CREATE TABLE certidoes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    tipo VARCHAR(30) NOT NULL,
        -- valores esperados: federal, estadual, municipal, trabalhista, fgts, outra
    orgao_emissor VARCHAR(150),
    numero_certidao VARCHAR(100),
    status VARCHAR(30) NOT NULL DEFAULT 'emissao_pendente',
        -- valores esperados: emissao_pendente, valida, a_vencer, vencida
    data_emissao DATE,
    data_validade DATE,
    responsavel_id UUID REFERENCES usuarios(id),
    observacoes TEXT,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_certidoes_empresa ON certidoes(empresa_id);
CREATE INDEX idx_certidoes_validade ON certidoes(data_validade);
CREATE INDEX idx_certidoes_status ON certidoes(status);

-- Histórico de renovações de certidões
CREATE TABLE certidoes_renovacoes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    certidao_id UUID NOT NULL REFERENCES certidoes(id) ON DELETE CASCADE,
    data_emissao_anterior DATE,
    data_validade_anterior DATE,
    data_renovacao DATE NOT NULL DEFAULT CURRENT_DATE,
    usuario_id UUID REFERENCES usuarios(id),
    observacoes TEXT
);

-- =====================================================================
-- 5. LICENÇAS E ALVARÁS
-- =====================================================================

CREATE TABLE licencas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    tipo VARCHAR(50) NOT NULL,
        -- valores esperados: vigilancia_sanitaria, bombeiros, ambiental, funcionamento, outra
    orgao_emissor VARCHAR(150),
    numero_licenca VARCHAR(100),
    status VARCHAR(30) NOT NULL DEFAULT 'emissao_pendente',
        -- valores esperados: emissao_pendente, valida, a_vencer, vencida
    data_emissao DATE,
    data_validade DATE,
    responsavel_id UUID REFERENCES usuarios(id),
    observacoes TEXT,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_licencas_empresa ON licencas(empresa_id);
CREATE INDEX idx_licencas_validade ON licencas(data_validade);
CREATE INDEX idx_licencas_status ON licencas(status);

CREATE TABLE licencas_renovacoes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    licenca_id UUID NOT NULL REFERENCES licencas(id) ON DELETE CASCADE,
    data_emissao_anterior DATE,
    data_validade_anterior DATE,
    data_renovacao DATE NOT NULL DEFAULT CURRENT_DATE,
    usuario_id UUID REFERENCES usuarios(id),
    observacoes TEXT
);

-- =====================================================================
-- 6. DOCUMENTOS (ARMAZENAMENTO DE ARQUIVOS)
-- =====================================================================
-- Tabela genérica de documentos, associável a empresa, processo, certidão ou licença
-- via colunas de referência opcionais (apenas uma delas deve ser preenchida).

CREATE TABLE documentos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
    processo_id UUID REFERENCES processos_legalizacao(id) ON DELETE CASCADE,
    certidao_id UUID REFERENCES certidoes(id) ON DELETE CASCADE,
    licenca_id UUID REFERENCES licencas(id) ON DELETE CASCADE,

    nome_original VARCHAR(255) NOT NULL,     -- nome do arquivo enviado pelo usuário
    nome_armazenado VARCHAR(255) NOT NULL,   -- nome único gerado no servidor (evita colisão)
    caminho VARCHAR(500) NOT NULL,           -- caminho relativo no storage
    tipo_mime VARCHAR(100),
    tamanho_bytes BIGINT,
    categoria VARCHAR(50),                   -- ex: contrato_social, certidao, alvara, comprovante
    descricao VARCHAR(255),                  -- usado principalmente quando categoria = 'outro'

    enviado_por UUID REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Garante que o documento está associado a exatamente uma entidade
    CONSTRAINT chk_documento_associacao CHECK (
        (CASE WHEN empresa_id IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN processo_id IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN certidao_id IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN licenca_id IS NOT NULL THEN 1 ELSE 0 END) = 1
    )
);

CREATE INDEX idx_documentos_empresa ON documentos(empresa_id);
CREATE INDEX idx_documentos_processo ON documentos(processo_id);
CREATE INDEX idx_documentos_certidao ON documentos(certidao_id);
CREATE INDEX idx_documentos_licenca ON documentos(licenca_id);

-- =====================================================================
-- 7. LOG DE AUDITORIA (opcional, mas recomendado para escritório de contabilidade)
-- =====================================================================

CREATE TABLE logs_auditoria (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id UUID REFERENCES usuarios(id),
    acao VARCHAR(50) NOT NULL,               -- ex: CREATE, UPDATE, DELETE, LOGIN
    entidade VARCHAR(50) NOT NULL,           -- ex: empresa, certidao, licenca, usuario
    entidade_id UUID,
    detalhes JSONB,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_logs_entidade ON logs_auditoria(entidade, entidade_id);

-- =====================================================================
-- 8. ETAPAS DE PROCESSOS DE LEGALIZAÇÃO (checklist por processo)
-- =====================================================================

CREATE TABLE etapas_processo (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    processo_id UUID NOT NULL REFERENCES processos_legalizacao(id) ON DELETE CASCADE,
    nome VARCHAR(100) NOT NULL,              -- ex: Junta Comercial, Receita Federal (DBE), Alvará, Inscrição Estadual
    ordem INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pendente'
        CHECK (status IN ('pendente', 'em_andamento', 'exigencia', 'concluido')),
    responsavel_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    concluida BOOLEAN NOT NULL DEFAULT FALSE, -- mantido em sincronia via trigger, para compatibilidade
    concluida_em TIMESTAMP,
    observacoes TEXT,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_etapas_processo ON etapas_processo(processo_id);
CREATE INDEX idx_etapas_processo_responsavel ON etapas_processo(responsavel_id);

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

CREATE TRIGGER trg_sincronizar_concluida_etapa
  BEFORE INSERT OR UPDATE OF status ON etapas_processo
  FOR EACH ROW EXECUTE FUNCTION sincronizar_concluida_etapa();

-- =====================================================================
-- 9. HISTÓRICO DE COMUNICAÇÃO (e-mail / WhatsApp)
-- =====================================================================

CREATE TABLE historico_comunicacao (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    processo_id UUID REFERENCES processos_legalizacao(id) ON DELETE SET NULL,
    canal VARCHAR(20) NOT NULL,              -- email, whatsapp
    destinatario VARCHAR(150) NOT NULL,      -- e-mail ou telefone
    assunto VARCHAR(200),
    mensagem TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'enviado', -- enviado, falhou
    erro TEXT,
    enviado_por UUID REFERENCES usuarios(id), -- NULL quando disparo automático
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_historico_comunicacao_empresa ON historico_comunicacao(empresa_id);

-- =====================================================================
-- 10. TOKENS DE ACESSO À ÁREA DO CLIENTE
-- =====================================================================
-- Autenticação simplificada por link único (sem senha) — o colaborador
-- gera um link para o cliente, que pode ser revogado a qualquer momento.

CREATE TABLE tokens_area_cliente (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    token VARCHAR(64) UNIQUE NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    expira_em TIMESTAMP,                     -- NULL = sem expiração
    criado_por UUID REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    ultimo_acesso TIMESTAMP
);

CREATE INDEX idx_tokens_area_cliente_token ON tokens_area_cliente(token);
CREATE INDEX idx_tokens_area_cliente_empresa ON tokens_area_cliente(empresa_id);

-- =====================================================================
-- 11. RECUPERAÇÃO DE SENHA
-- =====================================================================

CREATE TABLE tokens_recuperacao_senha (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    token VARCHAR(64) UNIQUE NOT NULL,
    usado BOOLEAN NOT NULL DEFAULT FALSE,
    expira_em TIMESTAMP NOT NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tokens_recuperacao_token ON tokens_recuperacao_senha(token);

-- =====================================================================
-- 12. CONTROLE DE ALERTAS AUTOMÁTICOS DE VENCIMENTO
-- =====================================================================
-- Evita reenviar o mesmo alerta de "a vencer" todo dia para a mesma
-- certidão/licença — uma linha por (registro, data_validade) já avisada.

CREATE TABLE alertas_vencimento_enviados (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tipo_registro VARCHAR(20) NOT NULL,
    registro_id UUID NOT NULL,
    data_validade DATE NOT NULL,
    enviado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (tipo_registro, registro_id, data_validade)
);

-- =====================================================================
-- 13. TAREFAS POR SETOR (Fiscal, Contabilidade, Folha de Pagamento)
-- =====================================================================
-- Depois que a Legalização conclui a abertura da empresa, cada
-- supervisor de setor cadastra as tarefas necessárias e atribui a um
-- responsável via e-mail (não precisa ser um usuário do sistema).

CREATE TABLE onboarding_empresa (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL UNIQUE REFERENCES empresas(id) ON DELETE CASCADE,
    estagio VARCHAR(30) NOT NULL
        CHECK (estagio IN ('legalizacao', 'cadastro_dominio', 'fechamento_setorial')),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE onboarding_historico (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    estagio VARCHAR(30) NOT NULL,
    concluido_por UUID REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_onboarding_empresa_empresa ON onboarding_empresa(empresa_id);
CREATE INDEX idx_onboarding_historico_empresa ON onboarding_historico(empresa_id);

CREATE TABLE tarefas_setor (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    setor VARCHAR(30) NOT NULL CHECK (setor IN ('fiscal', 'contabilidade', 'folha_pagamento')),
    descricao TEXT NOT NULL,
    responsavel_nome VARCHAR(150),
    responsavel_email VARCHAR(150) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pendente'
        CHECK (status IN ('pendente', 'em_andamento', 'concluido')),
    prazo TIMESTAMP,
    criado_por UUID REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    concluido_em TIMESTAMP
);

CREATE INDEX idx_tarefas_setor_empresa ON tarefas_setor(empresa_id);
CREATE INDEX idx_tarefas_setor_setor ON tarefas_setor(setor);
CREATE INDEX idx_tarefas_setor_status ON tarefas_setor(status);

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

CREATE TRIGGER trg_sincronizar_concluido_em_tarefa
  BEFORE INSERT OR UPDATE OF status ON tarefas_setor
  FOR EACH ROW EXECUTE FUNCTION sincronizar_concluido_em_tarefa();

-- =====================================================================
-- 14. CERTIFICADOS DIGITAIS (controle de vencimento)
-- =====================================================================
-- Mesmo padrão de status usado em certidões/licenças — aparece no
-- Dashboard e é recalculado automaticamente pelo job diário.

CREATE TABLE certificados_digitais (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    tipo VARCHAR(30) NOT NULL DEFAULT 'e-cnpj',
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

CREATE INDEX idx_certificados_digitais_empresa ON certificados_digitais(empresa_id);
CREATE INDEX idx_certificados_digitais_validade ON certificados_digitais(data_validade);
CREATE INDEX idx_certificados_digitais_status ON certificados_digitais(status);

-- =====================================================================
-- FUNÇÃO E TRIGGERS PARA ATUALIZAR "atualizado_em" AUTOMATICAMENTE
-- =====================================================================

CREATE OR REPLACE FUNCTION atualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_usuarios_atualizado BEFORE UPDATE ON usuarios
    FOR EACH ROW EXECUTE FUNCTION atualizar_timestamp();
CREATE TRIGGER trg_empresas_atualizado BEFORE UPDATE ON empresas
    FOR EACH ROW EXECUTE FUNCTION atualizar_timestamp();
CREATE TRIGGER trg_processos_atualizado BEFORE UPDATE ON processos_legalizacao
    FOR EACH ROW EXECUTE FUNCTION atualizar_timestamp();
CREATE TRIGGER trg_certidoes_atualizado BEFORE UPDATE ON certidoes
    FOR EACH ROW EXECUTE FUNCTION atualizar_timestamp();
CREATE TRIGGER trg_licencas_atualizado BEFORE UPDATE ON licencas
    FOR EACH ROW EXECUTE FUNCTION atualizar_timestamp();
CREATE TRIGGER trg_certificados_digitais_atualizado BEFORE UPDATE ON certificados_digitais
    FOR EACH ROW EXECUTE FUNCTION atualizar_timestamp();

-- =====================================================================
-- FUNÇÃO PARA ATUALIZAR STATUS DE CNDs/LICENÇAS COM BASE NA DATA (a_vencer/vencida)
-- Pode ser chamada via cron job/job agendado no back-end (ver src/utils/statusJob.js)
-- =====================================================================

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

-- =====================================================================
-- USUÁRIO ADMINISTRADOR PADRÃO
-- A senha vem do .env (ADMIN_SENHA) na instalação real; na demonstração, ver backend/demo/preparar.js
-- Hash gerado com bcrypt, custo 10 (ver backend/src/utils/seedAdmin.js para gerar novo hash)
-- =====================================================================
-- O INSERT do usuário admin é feito via script Node (seedAdmin.js), não aqui,
-- para garantir que o hash bcrypt seja gerado corretamente no momento da instalação.
