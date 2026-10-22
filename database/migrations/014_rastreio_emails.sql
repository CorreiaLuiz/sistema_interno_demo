-- =====================================================================
-- 014 — Controle dos e-mails enviados aos clientes
-- =====================================================================
-- - emails_enviados: um registro por destinatário (cada um recebe o seu
--   e-mail, com um código próprio). Guarda se o envio deu certo e quando
--   o e-mail foi aberto (imagem invisível carregada pelo programa de e-mail).
-- - emails_enviados_documentos: quais documentos (guias) foram no e-mail.
-- - downloads_portal ganha "origem": 'portal' (Área do Cliente) ou 'email'
--   (botão "Baixar" do e-mail), e o e-mail de onde veio o download.
-- Idempotente: pode rodar de novo sem erro.

CREATE TABLE IF NOT EXISTS emails_enviados (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token VARCHAR(64) NOT NULL UNIQUE,          -- código aleatório usado nos links do e-mail
    empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
    destinatario VARCHAR(150) NOT NULL,
    assunto VARCHAR(200),
    tipo VARCHAR(20) NOT NULL DEFAULT 'outro',  -- guias, documento, pedido, outro
    status VARCHAR(20) NOT NULL DEFAULT 'enviando', -- enviando, enviado, simulado, falhou
    erro TEXT,
    enviado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    enviado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    aberto_em TIMESTAMP,                        -- primeira abertura
    ultima_abertura_em TIMESTAMP,
    aberturas INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_emails_enviados_data ON emails_enviados(enviado_em DESC);
CREATE INDEX IF NOT EXISTS idx_emails_enviados_empresa ON emails_enviados(empresa_id, enviado_em DESC);

CREATE TABLE IF NOT EXISTS emails_enviados_documentos (
    email_id UUID NOT NULL REFERENCES emails_enviados(id) ON DELETE CASCADE,
    documento_id UUID NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
    PRIMARY KEY (email_id, documento_id)
);
CREATE INDEX IF NOT EXISTS idx_emails_enviados_documentos_doc ON emails_enviados_documentos(documento_id);

ALTER TABLE downloads_portal ADD COLUMN IF NOT EXISTS origem VARCHAR(10) NOT NULL DEFAULT 'portal';
ALTER TABLE downloads_portal ADD COLUMN IF NOT EXISTS email_id UUID REFERENCES emails_enviados(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_downloads_portal_documento ON downloads_portal(documento_id);
